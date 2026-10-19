# Registro Trasformatori – MACE Power / MACE Service

Sito per registrare i trasformatori in entrata: azienda, dati macchina, le 5 date
(entrata → preventivazione + garanzia → inizio riparazione → conclusione → consegna),
PDF di accettazione e trasporto, e registro con filtri, export Excel e stampa.

Gira su **GitHub Pages** (gratis) e salva tutto su **Firebase Firestore** (piano gratuito Spark,
**non** serve la carta di credito: i PDF vengono salvati "a pezzi" dentro Firestore, non su Firebase Storage).

---

## 1. Crea il progetto Firebase (una volta sola, ~10 minuti)

1. Vai su <https://console.firebase.google.com> → **Aggiungi progetto** → nome es. `registro-trasformatori` (Analytics puoi disattivarlo).
2. **Firestore Database** → *Crea database* → modalità **produzione** → regione `europe-west` (es. `eur3` o `europe-west8` Milano).
3. Scheda **Regole** di Firestore → cancella tutto e incolla il contenuto del file `firestore.rules` → **Pubblica**.
4. **Authentication** → *Inizia* → scheda *Metodo di accesso* → attiva **Email/Password**.
5. Sempre in Authentication → scheda **Utenti** → *Aggiungi utente*:
   - Email: `registro@macepower.it` (non serve che esista davvero)
   - Password: `140523` ← questo è il PIN
6. Ingranaggio ⚙ → **Impostazioni progetto** → in basso *Le tue app* → icona **`</>`** (Web) → nome a piacere → *Registra app*.
   Copia i valori di `firebaseConfig` e incollali in **`js/firebase-config.js`** al posto di `INSERISCI_...`.

> Per cambiare PIN in futuro: Authentication → Utenti → menu ⋮ accanto all'utente → *Reimposta password*… oppure elimina e ricrea l'utente con la nuova password (minimo 6 cifre).

## 2. Pubblica su GitHub Pages

1. Crea un repository (es. `registro-trasformatori`) e carica **tutti i file mantenendo le cartelle** (`index.html`, `css/`, `js/`, …).
2. Repository → **Settings → Pages** → *Source*: `Deploy from a branch` → branch `main`, cartella `/ (root)` → Save.
3. Dopo 1-2 minuti il sito è su `https://TUO-UTENTE.github.io/registro-trasformatori/`.
4. Torna su Firebase → Authentication → **Settings → Domini autorizzati** → *Aggiungi dominio* → `TUO-UTENTE.github.io`.

Fatto. Apri il sito, inserisci il PIN e sei dentro.

## Sicurezza, terra terra

- Il codice su GitHub è pubblico, ma **il PIN non è scritto nel codice**: è la password dell'utente Firebase.
- Il "lucchetto" vero sono le regole di Firestore: senza login col PIN il database risponde "accesso negato".
- Firebase blocca da solo chi prova troppi PIN di fila.
- La sessione dura finché il browser resta aperto: chiudendolo bisogna rimettere il PIN.
- La config Firebase (apiKey ecc.) **non è un segreto**, è normale che sia visibile.

## Limiti del piano gratuito (più che sufficienti)

- 1 GB di dati totali (≈ centinaia di PDF da qualche MB)
- 50.000 letture e 20.000 scritture al giorno
- Ogni PDF max **15 MB**

## Modalità DEMO

Finché `js/firebase-config.js` contiene `INSERISCI_...`, il sito funziona in DEMO:
PIN `140523`, dati salvati solo nel browser (i PDF si perdono ricaricando la pagina). Serve solo per provarlo.
Per provarlo in locale serve un mini server (i moduli JS non partono aprendo il file con doppio clic):
`python -m http.server` nella cartella e poi apri <http://localhost:8000>.

## Struttura

```
index.html            pagina unica (login, nuovo ingresso, registro)
css/style.css         grafica
js/app.js             logica dell'interfaccia
js/store.js           salvataggio dati (Firebase o demo)
js/firebase-config.js ← QUI incolli la configurazione Firebase
firestore.rules       regole di sicurezza da incollare in Firebase
```

Numerazione registro automatica per anno di entrata: `2026/001`, `2026/002`, …

Stato calcolato dalle date: *In attesa preventivo → Preventivato → In riparazione → Riparato, da consegnare → Consegnato*.
