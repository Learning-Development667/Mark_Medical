window.CARE_LOG_CONFIG = {
  firebase: {
    apiKey: "AIzaSyCrc8VkeAzXAMzeTZp-NblqVsg7EAreH64",
    authDomain: "care-log-3d05a.firebaseapp.com",
    projectId: "care-log-3d05a",
    storageBucket: "care-log-3d05a.firebasestorage.app",
    messagingSenderId: "270131122577",
    appId: "1:270131122577:web:87f4dd30cf5137d3560a30"
  }
};

/* Shared demo (Guest on the sign-in screen): a SEPARATE Firebase project, daybook-demo, with
   its own database and rules (firestore.demo.rules). The guest sign-in below is public by
   design: the demo holds made-up data only and is wiped every night. See CLAUDE.md. */
window.DAYBOOK_DEMO = {
  firebase: {
    apiKey: "AIzaSyCmMTCjYw-JR1sUjxkYLYGAlDWMp1nah2s",
    authDomain: "daybook-demo-34eae.firebaseapp.com",
    projectId: "daybook-demo-34eae",
    storageBucket: "daybook-demo-34eae.firebasestorage.app",
    messagingSenderId: "405083142629",
    appId: "1:405083142629:web:b47df53a8644fb73cbd70c"
  },
  email: "guest@daybook.demo",
  password: "Password"
};

/* Medicine reminders: the public half of the Web Push key (public by design). The private half is
   the VAPID_PRIVATE_KEY repository secret, handed to the bridge by the deploy workflow. */
window.DAYBOOK_PUSH = { publicKey: "BJ33RgWZAU7jOB8esjGKGMB2yPSXU42KmFEQX3Tn1DgntHaZDT16xKz6HdTAvVZyV1Bu0oX_A_TWVBf20Q93xMs" };

/* The bridge, for Explain in Daybook (see worker/) */
window.DAYBOOK_BRIDGE = { url: "https://care-log-bridge.markbrown667.workers.dev" };
