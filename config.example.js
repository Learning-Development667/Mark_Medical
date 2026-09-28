/* Care Log configuration.
   1. Copy this file to config.js (config.js is NOT created by the build; it is created and committed by hand).
   2. Paste the public Firebase web app config from the Firebase console (Project settings > Your apps > Web app).
   3. Accounts are data, not code: for each person, create the sign-in under Authentication > Users,
      then a document in the Firestore "users" collection whose id is that user's uid, with the fields
        name      the first name shown in the app
        role      "family" (full access), "readonly" (sees everything, writes nothing) or "viewer"
                  (Meds, Chemo and Trends only, read-only)
        relation  "patient", "carer" or "" (optional; shown on the More tab, used for wording later)
      No email address goes in this file or anywhere else in the code; firestore.rules gates every
      collection on those documents. See "Access" in CLAUDE.md.
   Anyone can also tap "Guest" on the sign-in screen for a preview with made-up example data; that
   needs no account and no config here, see the "Guest preview mode" note in CLAUDE.md.
   The Firebase web config is public by design. Access is controlled by Firebase Auth and firestore.rules. */

/* Optional: a shared demo anyone can use for real (Guest on the sign-in screen). It is a
   SEPARATE Firebase project with its own database, so nothing in it can touch the real one:
   create a second project, turn on Email/Password sign-in, create one user (the guest), set
   its Firestore rules to firestore.demo.rules, and paste its web config plus the guest's
   email and password here. They are public by design: the demo is wiped every night by
   .github/workflows/reset-demo.yml and reseeded with the example data on the next visit.
   Leave this out and Guest is the in-memory preview instead. */
// window.DAYBOOK_DEMO = {
//   firebase: { apiKey: "...", authDomain: "...", projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "..." },
//   email: "guest@example.com",
//   password: "the guest password"
// };

/* Optional: medicine reminders as push notifications. Run node tools/vapid_keys.mjs once: the public
   key goes here, the private key in the VAPID_PRIVATE_KEY repository secret for the bridge. */
// window.DAYBOOK_PUSH = { publicKey: "..." };

/* Optional: the bridge's address (printed by the deploy workflow), for "Explain in Daybook" on
   letters and Notes for the team. Without it those buttons are not shown; the share sheet
   route to the person's own AI app works regardless. */
// window.DAYBOOK_BRIDGE = { url: "https://care-log-bridge.<your-subdomain>.workers.dev" };

window.CARE_LOG_CONFIG = {
  firebase: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
  }
};
