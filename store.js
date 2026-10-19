// Livello dati: Firebase (reale) oppure DEMO (solo browser).
// L'interfaccia (app.js) usa sempre le stesse funzioni.
import { firebaseConfig, LOGIN_EMAIL } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const CHUNK = 700000;                 // caratteri base64 per "pezzo" (< 1 MB per documento Firestore)
export const MAX_FILE = 15 * 1024 * 1024; // 15 MB per PDF

export const isDemo =
  !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("INSERISCI");

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

function base64ToBlob(b64, type = "application/pdf") {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

async function sha256(txt) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createStore() {
  return isDemo ? demoStore() : firebaseStore();
}

// ------------------------------------------------------------------ FIREBASE
async function firebaseStore() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FB + "firebase-app.js"),
    import(FB + "firebase-auth.js"),
    import(FB + "firebase-firestore.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  // la sessione dura finché la scheda/browser resta aperto
  await A.setPersistence(auth, A.browserSessionPersistence);
  const col = F.collection(db, "trasformatori");
  const filesCol = (id) => F.collection(db, "trasformatori", id, "allegati");
  const partsCol = (id, fid) => F.collection(db, "trasformatori", id, "allegati", fid, "parti");

  const api = {
    mode: "firebase",
    onAuth(cb) {
      return A.onAuthStateChanged(auth, (u) => cb(!!u));
    },
    async login(pin) {
      try {
        await A.signInWithEmailAndPassword(auth, LOGIN_EMAIL, pin);
        return true;
      } catch (e) {
        if (e.code === "auth/too-many-requests")
          throw new Error("Troppi tentativi. Riprova tra qualche minuto.");
        if (e.code === "auth/network-request-failed")
          throw new Error("Nessuna connessione a Internet.");
        return false;
      }
    },
    logout() {
      return A.signOut(auth);
    },
    subscribe(cb, onErr) {
      return F.onSnapshot(
        col,
        (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        onErr
      );
    },
    async create(data) {
      const anno = (data.dataEntrata || "").slice(0, 4) || String(new Date().getFullYear());
      const ref = F.doc(col);
      const cRef = F.doc(db, "contatori", anno);
      const numero = await F.runTransaction(db, async (tx) => {
        const c = await tx.get(cRef);
        const n = (c.exists() ? c.data().ultimo || 0 : 0) + 1;
        const numero = `${anno}/${String(n).padStart(3, "0")}`;
        tx.set(cRef, { ultimo: n });
        tx.set(ref, {
          ...data,
          numero,
          nAllegati: 0,
          creatoMs: Date.now(),
          creatoIl: F.serverTimestamp(),
          aggiornatoIl: F.serverTimestamp(),
        });
        return numero;
      });
      return { id: ref.id, numero };
    },
    update(id, data) {
      return F.updateDoc(F.doc(col, id), { ...data, aggiornatoIl: F.serverTimestamp() });
    },
    async remove(id) {
      for (const f of await api.listFiles(id)) await api.deleteFile(id, f.id, true);
      await F.deleteDoc(F.doc(col, id));
    },
    async listFiles(id) {
      const s = await F.getDocs(filesCol(id));
      return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.caricatoMs - b.caricatoMs);
    },
    async uploadFile(id, file, categoria, onProgress) {
      const b64 = await fileToBase64(file);
      const parts = Math.max(1, Math.ceil(b64.length / CHUNK));
      const fRef = F.doc(filesCol(id));
      for (let i = 0; i < parts; i++) {
        await F.setDoc(F.doc(fRef, "parti", String(i)), { i, dati: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
        onProgress && onProgress((i + 1) / parts);
      }
      await F.setDoc(fRef, {
        nome: file.name,
        categoria,
        dimensione: file.size,
        tipo: file.type || "application/pdf",
        nParti: parts,
        caricatoMs: Date.now(),
      });
      await F.updateDoc(F.doc(col, id), { nAllegati: F.increment(1) });
    },
    async getFileBlob(id, f) {
      const s = await F.getDocs(partsCol(id, f.id));
      const parts = s.docs.map((d) => d.data()).sort((a, b) => a.i - b.i);
      return base64ToBlob(parts.map((p) => p.dati).join(""), f.tipo);
    },
    async deleteFile(id, fid, skipCounter) {
      const s = await F.getDocs(partsCol(id, fid));
      const b = F.writeBatch(db);
      s.docs.forEach((d) => b.delete(d.ref));
      b.delete(F.doc(filesCol(id), fid));
      await b.commit();
      if (!skipCounter) await F.updateDoc(F.doc(col, id), { nAllegati: F.increment(-1) });
    },
  };
  return api;
}

// ------------------------------------------------------------------ DEMO
function demoStore() {
  const PIN_HASH = "926b776ddfc5b81a21769e5beec7e6b8848bdf4b9e33ac18cf27e61609a7e300";
  const KEY = "demo-registro-trasformatori";
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { rec: [], cont: {} }; }
    catch { return { rec: [], cont: {} }; }
  };
  let data = load();
  const files = {}; // id -> [ {id, nome, ..., blob} ]  (solo in memoria)
  const subs = new Set();
  let authCb = null;
  let logged = false;
  try { logged = sessionStorage.getItem(KEY + "-auth") === "1"; } catch {}

  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
    subs.forEach((cb) => cb(data.rec.map((r) => ({ ...r }))));
  };
  const find = (id) => data.rec.find((r) => r.id === id);
  const uid = () => Math.random().toString(36).slice(2, 10);

  return {
    mode: "demo",
    onAuth(cb) { authCb = cb; cb(logged); },
    async login(pin) {
      const ok = (await sha256(pin)) === PIN_HASH;
      if (ok) {
        logged = true;
        try { sessionStorage.setItem(KEY + "-auth", "1"); } catch {}
        setTimeout(() => authCb && authCb(true));
      }
      return ok;
    },
    async logout() {
      logged = false;
      try { sessionStorage.removeItem(KEY + "-auth"); } catch {}
      authCb && authCb(false);
    },
    subscribe(cb) {
      subs.add(cb);
      cb(data.rec.map((r) => ({ ...r })));
      return () => subs.delete(cb);
    },
    async create(d) {
      const anno = (d.dataEntrata || "").slice(0, 4) || String(new Date().getFullYear());
      const n = (data.cont[anno] || 0) + 1;
      data.cont[anno] = n;
      const rec = { ...d, id: uid(), numero: `${anno}/${String(n).padStart(3, "0")}`, nAllegati: 0, creatoMs: Date.now() };
      data.rec.push(rec);
      save();
      return { id: rec.id, numero: rec.numero };
    },
    async update(id, d) { Object.assign(find(id), d); save(); },
    async remove(id) { data.rec = data.rec.filter((r) => r.id !== id); delete files[id]; save(); },
    async listFiles(id) { return (files[id] || []).map(({ blob, ...m }) => m); },
    async uploadFile(id, file, categoria, onProgress) {
      (files[id] ||= []).push({ id: uid(), nome: file.name, categoria, dimensione: file.size, tipo: file.type || "application/pdf", caricatoMs: Date.now(), blob: file });
      onProgress && onProgress(1);
      find(id).nAllegati = (find(id).nAllegati || 0) + 1;
      save();
    },
    async getFileBlob(id, f) { return (files[id] || []).find((x) => x.id === f.id).blob; },
    async deleteFile(id, fid) {
      files[id] = (files[id] || []).filter((x) => x.id !== fid);
      find(id).nAllegati = Math.max(0, (find(id).nAllegati || 1) - 1);
      save();
    },
  };
}
