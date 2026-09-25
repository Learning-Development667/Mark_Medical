/* Care Log configuration.
   1. Copy this file to config.js (config.js is NOT created by the build; Mark creates and commits it).
   2. Paste the public Firebase web app config from the Firebase console (Project settings > Your apps > Web app).
   3. Put the two permitted email addresses in "users", mapped to the first name shown in the app.
   4. Optional: a further email can be added with { name, role: "readonly" } instead of a plain name,
      for someone who should see everything a family member sees (every tab, every report) with no
      editing rights at all; or { name, role: "viewer" } for a narrower slice, Meds, Chemo and Trends
      only. See the isReadOnly()/isViewer() functions and "Access" notes in firestore.rules and CLAUDE.md.
   Anyone can also tap "Guest" on the sign-in screen for a preview with made-up example data; that
   needs no account and no config here, see the "Guest preview mode" note in CLAUDE.md.
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
    // "VIEWER_EMAIL": { name: "Someone", role: "viewer" }
  }
};
