/* Care Log configuration.
   1. Copy this file to config.js (config.js is NOT created by the build; Mark creates and commits it).
   2. Paste the public Firebase web app config from the Firebase console (Project settings > Your apps > Web app).
   3. Put the two permitted email addresses in "users", mapped to the first name shown in the app.
   4. Optional: to let someone preview the app's design with made-up example data, create one more
      Firebase Auth account for them and map it to the name "Guest" exactly (capital G). Anyone signed
      in as "Guest" never touches Firestore; see the "Guest preview mode" note in CLAUDE.md.
   The Firebase web config is public by design. Access is controlled by Firebase Auth and firestore.rules. */

window.CARE_LOG_CONFIG = {
  firebase: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
  },
  users: {
    "MARK_EMAIL": "Mark",
    "shelleybrown23@gmail.com": "Shelley"
    // "someone@example.com": "Guest"
  }
};
