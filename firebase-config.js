// ============================================================
//  CONFIGURAZIONE FIREBASE
//  1. Vai su https://console.firebase.google.com  ->  il tuo progetto
//  2. Impostazioni progetto (ingranaggio) -> "Le tue app" -> app Web (</>)
//  3. Copia i valori di "firebaseConfig" qui sotto al posto di INSERISCI_...
//
//  Finché apiKey resta "INSERISCI_...", il sito gira in MODALITÀ DEMO
//  (dati salvati solo nel browser, utile per provarlo).
// ============================================================

export const firebaseConfig = {
  apiKey: "INSERISCI_API_KEY",
  authDomain: "INSERISCI_PROGETTO.firebaseapp.com",
  projectId: "INSERISCI_PROGETTO",
  storageBucket: "INSERISCI_PROGETTO.appspot.com",
  messagingSenderId: "INSERISCI_SENDER_ID",
  appId: "INSERISCI_APP_ID",
};

// Utente "tecnico" creato in Firebase Authentication.
// La password di questo utente È il PIN (140523).
// Se cambi questa email, cambiala anche in firestore.rules.
export const LOGIN_EMAIL = "registro@macepower.it";
