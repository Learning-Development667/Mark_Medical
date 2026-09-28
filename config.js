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
