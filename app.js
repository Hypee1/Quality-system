import { createStore, MAX_FILE } from "./store.js";

// ------------------------------------------------------------------ utility
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (d) => (d ? d.split("-").reverse().join("/") : "—");
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

const STATI = [
  { k: "attesa", label: "In attesa preventivo" },
  { k: "preventivato", label: "Preventivato" },
  { k: "riparazione", label: "In riparazione" },
  { k: "riparato", label: "Riparato, da consegnare" },
  { k: "consegnato", label: "Consegnato" },
];
const statoLabel = (k) => STATI.find((s) => s.k === k).label;
function stato(r) {
  if (r.dataConsegna) return "consegnato";
  if (r.dataFine) return "riparato";
  if (r.dataInizio) return "riparazione";
  if (r.dataPreventivo) return "preventivato";
  return "attesa";
}
function giorni(r) {
  if (!r.dataEntrata) return "";
  const end = new Date(r.dataConsegna || today());
  return Math.max(0, Math.round((end - new Date(r.dataEntrata)) / 86400000));
}
const DATE_FIELDS = [
  ["dataEntrata", "entrata"],
  ["dataPreventivo", "preventivazione"],
  ["dataInizio", "inizio riparazione"],
  ["dataFine", "conclusione riparazione"],
  ["dataConsegna", "consegna"],
];
const TEXT_FIELDS = ["cliente", "matricola", "potenza", "tensioni", "difetto", "note"];
const CAT_LABEL = { accettazione: "Accettazione", trasporto: "Trasporto" };

// ------------------------------------------------------------------ stato app
let store;
let records = [];
let unsub = null;
const st = {
  azienda: null,
  editId: null,
  pending: { accettazione: [], trasporto: [] },
  existing: [],
  filters: { q: "", az: "", stato: "", gar: "", anno: "" },
};

// ------------------------------------------------------------------ toast & modal
function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.classList.add("out"), 3200);
  setTimeout(() => el.remove(), 3700);
}
function openModal(html, wide = false) {
  $("#modalBody").innerHTML = html;
  $(".modal-box").classList.toggle("wide", wide);
  $("#modal").hidden = false;
}
function closeModal() {
  $("#modal").hidden = true;
  $("#modalBody").innerHTML = "";
  $("#modalBody").onclick = null;
}
function confirmBox(msg, okLabel = "Conferma") {
  return new Promise((res) => {
    openModal(`<h3>Sei sicuro?</h3><p>${esc(msg)}</p>
      <div class="modal-actions"><button class="btn ghost" data-a="no">Annulla</button>
      <button class="btn danger" data-a="ok">${esc(okLabel)}</button></div>`);
    $("#modalBody").onclick = (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (!a) return;
      closeModal();
      res(a === "ok");
    };
  });
}
$("#modal").addEventListener("mousedown", (e) => {
  if (e.target.id === "modal" && !$("#modal").dataset.lock) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modal").hidden && !$("#modal").dataset.lock) closeModal();
});

// ------------------------------------------------------------------ avvio
(async () => {
  try {
    store = await createStore();
  } catch (e) {
    $("#boot").textContent = "Impossibile collegarsi a Firebase: " + e.message;
    return;
  }
  $("#boot").hidden = true;
  if (store.mode === "demo") {
    $("#demoNote").hidden = false;
    $("#demoBanner").hidden = false;
  }
  store.onAuth((logged) => (logged ? enterApp() : showLogin()));
})();

// ------------------------------------------------------------------ login
function showLogin() {
  if (unsub) { unsub(); unsub = null; }
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#pin").value = "";
  setTimeout(() => $("#pin").focus(), 50);
}
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = $("#pin").value.trim();
  const err = $("#loginErr");
  err.hidden = true;
  if (!pin) return;
  $("#loginBtn").disabled = true;
  try {
    const ok = await store.login(pin);
    if (!ok) {
      err.textContent = "PIN errato";
      err.hidden = false;
      $("#pin").value = "";
      $(".login-card").classList.remove("shake");
      void $(".login-card").offsetWidth;
      $(".login-card").classList.add("shake");
    }
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    $("#loginBtn").disabled = false;
  }
});
$("#logoutBtn").addEventListener("click", () => store.logout());

function enterApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  if (!unsub) {
    unsub = store.subscribe(
      (list) => {
        records = list.sort((a, b) => (b.creatoMs || 0) - (a.creatoMs || 0));
        renderRegistro();
      },
      (e) => toast("Errore database: " + e.message, "err")
    );
  }
  startNew();
  showView("nuovo");
}

// ------------------------------------------------------------------ navigazione
function showView(v) {
  $$(".view").forEach((s) => (s.hidden = s.id !== "view-" + v));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === v));
  window.scrollTo({ top: 0 });
}
$$(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    if (t.dataset.view === "nuovo" && st.editId) startNew();
    showView(t.dataset.view);
  })
);

// ------------------------------------------------------------------ form
const form = $("#trForm");

function startNew() {
  st.editId = null;
  st.azienda = null;
  st.existing = [];
  st.pending = { accettazione: [], trasporto: [] };
  form.reset();
  $("#dateErr").hidden = true;
  $$(".invalid", form).forEach((x) => x.classList.remove("invalid"));
  $("#formTitle").textContent = "Nuovo ingresso";
  $("#formSub").textContent = "Compila i dati e allega i documenti";
  $("#saveBtn").textContent = "Salva registrazione";
  $("#changeAz").hidden = false;
  $("#stepAzienda").hidden = false;
  form.hidden = true;
  renderFiles();
}

function setAzienda(az) {
  st.azienda = az;
  $("#azChip").textContent = az;
  $(".az-chip").dataset.az = az === "MACE POWER" ? "power" : "service";
  $("#stepAzienda").hidden = true;
  form.hidden = false;
  if (!form.dataEntrata.value) form.dataEntrata.value = today();
}
$$(".azienda-btn").forEach((b) =>
  b.addEventListener("click", () => {
    setAzienda(b.dataset.azienda);
    form.cliente.focus();
  })
);
$("#changeAz").addEventListener("click", () => {
  $("#stepAzienda").hidden = false;
  form.hidden = true;
});
$("#cancelBtn").addEventListener("click", () => {
  const wasEdit = !!st.editId;
  startNew();
  if (wasEdit) showView("registro");
});

async function openEdit(r) {
  startNew();
  st.editId = r.id;
  setAzienda(r.azienda);
  TEXT_FIELDS.forEach((f) => (form[f].value = r[f] || ""));
  DATE_FIELDS.forEach(([f]) => (form[f].value = r[f] || ""));
  form.garanzia.checked = !!r.garanzia;
  $("#formTitle").textContent = "Modifica registrazione n° " + r.numero;
  $("#formSub").textContent = r.cliente + " · matricola " + r.matricola;
  $("#saveBtn").textContent = "Salva modifiche";
  showView("nuovo");
  try {
    st.existing = await store.listFiles(r.id);
  } catch (e) {
    toast("Impossibile leggere gli allegati: " + e.message, "err");
  }
  renderFiles();
}

function readForm() {
  const d = { azienda: st.azienda, garanzia: form.garanzia.checked };
  TEXT_FIELDS.forEach((f) => (d[f] = form[f].value.trim()));
  DATE_FIELDS.forEach(([f]) => (d[f] = form[f].value || ""));
  return d;
}

function validate(d) {
  let ok = true;
  $$(".invalid", form).forEach((x) => x.classList.remove("invalid"));
  ["cliente", "matricola", "dataEntrata"].forEach((f) => {
    if (!d[f]) { form[f].classList.add("invalid"); ok = false; }
  });
  const err = $("#dateErr");
  err.hidden = true;
  let prev = null;
  for (const [f, label] of DATE_FIELDS) {
    if (!d[f]) continue;
    if (prev && d[f] < d[prev[0]]) {
      err.textContent = `La data di ${label} non può essere prima della data di ${prev[1]}.`;
      err.hidden = false;
      form[f].classList.add("invalid");
      ok = false;
      break;
    }
    prev = [f, label];
  }
  if (!ok) {
    const first = $(".invalid", form);
    first && first.focus();
    toast("Controlla i campi evidenziati", "err");
  }
  return ok;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = readForm();
  if (!d.azienda) { $("#stepAzienda").hidden = false; return; }
  if (!validate(d)) return;

  const queue = [...st.pending.accettazione.map((f) => [f, "accettazione"]), ...st.pending.trasporto.map((f) => [f, "trasporto"])];
  $("#modal").dataset.lock = "1";
  openModal(`<h3>Salvataggio in corso…</h3><p id="saveMsg" class="muted">Registrazione dati</p>
    <div class="progress"><div id="saveBar"></div></div>`);
  const setP = (msg, p) => { $("#saveMsg").textContent = msg; $("#saveBar").style.width = Math.round(p * 100) + "%"; };

  try {
    let id = st.editId, numero;
    if (id) {
      await store.update(id, d);
      numero = records.find((r) => r.id === id)?.numero;
    } else {
      ({ id, numero } = await store.create(d));
    }
    for (let i = 0; i < queue.length; i++) {
      const [file, cat] = queue[i];
      await store.uploadFile(id, file, cat, (p) =>
        setP(`Caricamento PDF ${i + 1} di ${queue.length}: ${file.name}`, (i + p) / queue.length)
      );
    }
    setP("Fatto", 1);
    delete $("#modal").dataset.lock;
    closeModal();
    toast(st.editId ? `Registrazione ${numero} aggiornata` : `Trasformatore registrato con n° ${numero}`);
    startNew();
    showView("registro");
  } catch (ex) {
    delete $("#modal").dataset.lock;
    closeModal();
    toast("Errore durante il salvataggio: " + ex.message, "err");
  }
});

// ------------------------------------------------------------------ allegati nel form
function addFiles(cat, list) {
  for (const f of list) {
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) { toast(`"${f.name}" non è un PDF`, "err"); continue; }
    if (f.size > MAX_FILE) { toast(`"${f.name}" supera 15 MB`, "err"); continue; }
    st.pending[cat].push(f);
  }
  renderFiles();
}

function renderFiles() {
  $$(".drop").forEach((drop) => {
    const cat = drop.dataset.cat;
    const ex = st.existing.filter((f) => f.categoria === cat);
    const pe = st.pending[cat];
    drop.classList.toggle("has-files", ex.length + pe.length > 0);
    $(".file-list", drop).innerHTML =
      ex.map((f) => `<li><span class="pdf-ico">PDF</span><span class="fname" title="${esc(f.nome)}">${esc(f.nome)}</span>
          <span class="fsize">${kb(f.dimensione)}</span>
          <button type="button" class="icon-btn" data-dl="${f.id}" title="Scarica">⬇</button>
          <button type="button" class="icon-btn del" data-delex="${f.id}" title="Elimina">✕</button></li>`).join("") +
      pe.map((f, i) => `<li class="pending"><span class="pdf-ico">PDF</span><span class="fname" title="${esc(f.name)}">${esc(f.name)}</span>
          <span class="fsize">${kb(f.size)} · da caricare</span>
          <button type="button" class="icon-btn del" data-delpe="${i}" title="Rimuovi">✕</button></li>`).join("");
  });
}

$$(".drop").forEach((drop) => {
  const input = $("input[type=file]", drop);
  const cat = drop.dataset.cat;
  drop.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) { input.click(); return; }
    e.stopPropagation();
    if (b.dataset.delpe !== undefined) {
      st.pending[cat].splice(+b.dataset.delpe, 1);
      renderFiles();
    } else if (b.dataset.dl) {
      downloadFile(st.editId, st.existing.find((f) => f.id === b.dataset.dl), b);
    } else if (b.dataset.delex) {
      const f = st.existing.find((x) => x.id === b.dataset.delex);
      if (!(await confirmBox(`Eliminare definitivamente "${f.nome}"?`, "Elimina"))) return;
      try {
        await store.deleteFile(st.editId, f.id);
        st.existing = st.existing.filter((x) => x.id !== f.id);
        renderFiles();
        toast("Allegato eliminato");
      } catch (ex) { toast("Errore: " + ex.message, "err"); }
    }
  });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { addFiles(cat, input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); addFiles(cat, e.dataTransfer.files); });
});

async function downloadFile(recId, f, btn, open = false) {
  const win = open ? window.open("", "_blank") : null;
  if (btn) btn.disabled = true;
  try {
    const blob = await store.getFileBlob(recId, f);
    const url = URL.createObjectURL(blob);
    if (win) {
      win.location.href = url;
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = f.nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) {
    if (win) win.close();
    toast("Errore apertura file: " + e.message, "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ------------------------------------------------------------------ registro
$("#fStato").insertAdjacentHTML("beforeend", STATI.map((s) => `<option value="${s.k}">${s.label}</option>`).join(""));
[["#fQ", "q", "input"], ["#fAz", "az", "change"], ["#fStato", "stato", "change"], ["#fGar", "gar", "change"], ["#fAnno", "anno", "change"]].forEach(
  ([sel, key, ev]) => $(sel).addEventListener(ev, () => { st.filters[key] = $(sel).value; renderRegistro(); })
);

function filtered() {
  const { q, az, stato: s, gar, anno } = st.filters;
  const qq = q.trim().toLowerCase();
  return records.filter((r) => {
    if (az && r.azienda !== az) return false;
    if (s && stato(r) !== s) return false;
    if (gar === "si" && !r.garanzia) return false;
    if (gar === "no" && r.garanzia) return false;
    if (anno && !(r.dataEntrata || "").startsWith(anno)) return false;
    if (qq && ![r.numero, r.cliente, r.matricola, r.tensioni, r.difetto, r.note].join(" ").toLowerCase().includes(qq)) return false;
    return true;
  });
}

function renderRegistro() {
  $("#regCount").textContent = records.length || "";

  // anni disponibili
  const anni = [...new Set(records.map((r) => (r.dataEntrata || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const fa = $("#fAnno");
  const cur = fa.value;
  fa.innerHTML = `<option value="">Tutti gli anni</option>` + anni.map((a) => `<option>${a}</option>`).join("");
  fa.value = anni.includes(cur) ? cur : "";
  st.filters.anno = fa.value;

  // contatori per stato (rispetto agli altri filtri, escluso lo stato)
  const base = records.filter((r) => (!st.filters.az || r.azienda === st.filters.az));
  $("#stats").innerHTML =
    `<button type="button" class="stat ${!st.filters.stato ? "on" : ""}" data-s=""><b>${base.length}</b><span>Totale</span></button>` +
    STATI.map((s) => `<button type="button" class="stat st-${s.k} ${st.filters.stato === s.k ? "on" : ""}" data-s="${s.k}">
        <b>${base.filter((r) => stato(r) === s.k).length}</b><span>${s.label}</span></button>`).join("");

  const rows = filtered();
  $("#regTable tbody").innerHTML = rows
    .map((r) => {
      const s = stato(r);
      return `<tr data-id="${r.id}" tabindex="0">
        <td data-l="N°"><b>${esc(r.numero)}</b></td>
        <td data-l="Azienda"><span class="az-tag ${r.azienda === "MACE POWER" ? "power" : "service"}">${r.azienda === "MACE POWER" ? "POWER" : "SERVICE"}</span></td>
        <td data-l="Cliente">${esc(r.cliente)}</td>
        <td data-l="Matricola">${esc(r.matricola)}</td>
        <td data-l="kVA">${esc(r.potenza) || "—"}</td>
        <td data-l="Entrata">${fmt(r.dataEntrata)}</td>
        <td data-l="Preventivo">${fmt(r.dataPreventivo)}</td>
        <td data-l="Garanzia">${r.garanzia ? '<span class="gar si">Sì</span>' : '<span class="gar">No</span>'}</td>
        <td data-l="Inizio rip.">${fmt(r.dataInizio)}</td>
        <td data-l="Fine rip.">${fmt(r.dataFine)}</td>
        <td data-l="Consegna">${fmt(r.dataConsegna)}</td>
        <td data-l="Giorni">${giorni(r)}</td>
        <td data-l="Stato"><span class="badge st-${s}">${statoLabel(s)}</span></td>
        <td data-l="PDF">${r.nAllegati ? `<span class="pdf-count">${r.nAllegati}</span>` : "—"}</td>
      </tr>`;
    })
    .join("");
  $("#emptyMsg").hidden = rows.length > 0;
  $("#emptyMsg").textContent = records.length ? "Nessun trasformatore corrisponde ai filtri." : "Il registro è vuoto: inizia da “+ Nuovo ingresso”.";
}

$("#stats").addEventListener("click", (e) => {
  const b = e.target.closest(".stat");
  if (!b) return;
  st.filters.stato = b.dataset.s;
  $("#fStato").value = b.dataset.s;
  renderRegistro();
});
$("#regTable tbody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (tr) openDetail(tr.dataset.id);
});
$("#regTable tbody").addEventListener("keydown", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (tr && e.key === "Enter") openDetail(tr.dataset.id);
});

// ------------------------------------------------------------------ dettaglio
async function openDetail(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  const s = stato(r);
  const steps = DATE_FIELDS.map(([f, label]) =>
    `<li class="${r[f] ? "done" : ""}"><span class="dot"></span><div><small>${label[0].toUpperCase() + label.slice(1)}</small><b>${fmt(r[f])}</b>
      ${f === "dataPreventivo" ? `<em class="gar ${r.garanzia ? "si" : ""}">${r.garanzia ? "In garanzia" : "Non in garanzia"}</em>` : ""}</div></li>`
  ).join("");
  openModal(
    `<div class="detail-head">
       <div><p class="muted">Registrazione n°</p><h3>${esc(r.numero)}</h3></div>
       <div class="detail-tags"><span class="az-tag ${r.azienda === "MACE POWER" ? "power" : "service"}">${esc(r.azienda)}</span>
       <span class="badge st-${s}">${statoLabel(s)}</span></div>
     </div>
     <dl class="info">
       <div><dt>Cliente</dt><dd>${esc(r.cliente)}</dd></div>
       <div><dt>Matricola</dt><dd>${esc(r.matricola)}</dd></div>
       <div><dt>Potenza</dt><dd>${r.potenza ? esc(r.potenza) + " kVA" : "—"}</dd></div>
       <div><dt>Tensioni</dt><dd>${esc(r.tensioni) || "—"}</dd></div>
       <div class="full"><dt>Difetto / motivo</dt><dd>${esc(r.difetto) || "—"}</dd></div>
       ${r.note ? `<div class="full"><dt>Note</dt><dd>${esc(r.note)}</dd></div>` : ""}
     </dl>
     <h4>Avanzamento <span class="muted">· ${giorni(r)} giorni in officina</span></h4>
     <ol class="steps">${steps}</ol>
     <h4>Documenti</h4>
     <div id="detFiles" class="det-files"><p class="muted">Caricamento allegati…</p></div>
     <div class="modal-actions spread">
       <button class="btn danger ghost" data-a="del">Elimina</button>
       <div><button class="btn ghost" data-a="close">Chiudi</button>
       <button class="btn primary" data-a="edit">Modifica / aggiorna date</button></div>
     </div>`,
    true
  );
  let files = [];
  $("#modalBody").onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.a === "close") closeModal();
    else if (b.dataset.a === "edit") { closeModal(); openEdit(r); }
    else if (b.dataset.a === "del") {
      if (!(await confirmBox(`Eliminare la registrazione ${r.numero} (${r.cliente}) con tutti i suoi PDF? L'operazione non si può annullare.`, "Elimina"))) return;
      try { await store.remove(r.id); toast(`Registrazione ${r.numero} eliminata`); }
      catch (ex) { toast("Errore: " + ex.message, "err"); }
    } else if (b.dataset.open || b.dataset.dl) {
      const f = files.find((x) => x.id === (b.dataset.open || b.dataset.dl));
      downloadFile(r.id, f, b, !!b.dataset.open);
    }
  };
  try {
    files = await store.listFiles(r.id);
    const box = $("#detFiles");
    if (!box) return;
    box.innerHTML = ["accettazione", "trasporto"].map((cat) => {
      const list = files.filter((f) => f.categoria === cat);
      return `<div class="det-cat"><p>${CAT_LABEL[cat]}</p>${
        list.length
          ? `<ul class="file-list">${list.map((f) => `<li><span class="pdf-ico">PDF</span><span class="fname" title="${esc(f.nome)}">${esc(f.nome)}</span>
              <span class="fsize">${kb(f.dimensione)}</span>
              <button class="btn ghost xs" data-open="${f.id}">Apri</button>
              <button class="btn ghost xs" data-dl="${f.id}">Scarica</button></li>`).join("")}</ul>`
          : `<p class="muted small">Nessun documento</p>`
      }</div>`;
    }).join("");
  } catch (ex) {
    const box = $("#detFiles");
    if (box) box.innerHTML = `<p class="err">Errore: ${esc(ex.message)}</p>`;
  }
}

// ------------------------------------------------------------------ export & stampa
$("#csvBtn").addEventListener("click", () => {
  const rows = filtered();
  if (!rows.length) return toast("Niente da esportare", "err");
  const head = ["N°", "Azienda", "Cliente", "Matricola", "Potenza kVA", "Tensioni", "Data entrata", "Data preventivazione", "In garanzia",
    "Inizio riparazione", "Fine riparazione", "Data consegna", "Giorni", "Stato", "N° PDF", "Difetto", "Note"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const lines = rows.map((r) => [r.numero, r.azienda, r.cliente, r.matricola, r.potenza, r.tensioni,
    r.dataEntrata ? fmt(r.dataEntrata) : "", r.dataPreventivo ? fmt(r.dataPreventivo) : "", r.garanzia ? "Sì" : "No",
    r.dataInizio ? fmt(r.dataInizio) : "", r.dataFine ? fmt(r.dataFine) : "", r.dataConsegna ? fmt(r.dataConsegna) : "",
    giorni(r), statoLabel(stato(r)), r.nAllegati || 0, r.difetto, r.note].map(q).join(";"));
  const blob = new Blob(["﻿" + [head.map(q).join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `registro-trasformatori-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});
$("#printBtn").addEventListener("click", () => {
  $("#printDate").textContent = fmt(today());
  window.print();
});
