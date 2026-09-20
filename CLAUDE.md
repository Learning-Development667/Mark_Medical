# Care Log

Private, shared health tracker for Mark and Shelley. Hosted on GitHub Pages from `main`, root.
Live: https://learning-development667.github.io/Mark_Medical/

## COST RULE (never break this)
- Runs entirely on the Firebase free Spark plan and GitHub Pages.
- Use ONLY Firebase Auth (email and password) and Cloud Firestore.
- Do NOT use Firebase Storage, Cloud Functions, any paid API, or any server.
- No API keys other than the public Firebase web config in `config.js`.
- Document pages are stored as base64 JPEG strings in Firestore. Each page document MUST stay under 900 KB.

## Branch and hosting
- All work is committed directly to `main`. No feature branches, no pull requests.
- GitHub Pages path is case-sensitive: `/Mark_Medical/`. `manifest.json` start_url and scope are `/Mark_Medical/`. `sw.js` is registered with scope `/Mark_Medical/`. All asset paths are relative.

## Stack
- Vanilla HTML, CSS and JS. No frameworks, no build step.
- Firebase JS SDK v10 modular from the gstatic CDN.
- Chart.js, pdf.js (3.x UMD build) and mammoth.js from cdnjs, loaded lazily when needed.
- Fonts: Bebas Neue (headings), DM Sans (body), DM Mono (times and numbers).

## Files
- `index.html`, `styles.css`, `scripts.js`, `sw.js`, `manifest.json`, `config.example.js`, `icons/`, `firestore.rules`, `CLAUDE.md`.
- `config.js` is created and committed by Mark only. Never create, edit or regenerate it. `index.html` loads `config.js` before `scripts.js`. It was created once, by explicit one-off authorisation from Mark on 2026-09-19, with the real Firebase config and the two permitted email addresses. That authorisation does not repeat: this rule reapplies immediately afterwards, standing, with no further exceptions.

## Standards
- Body text minimum 17px. Tap targets minimum 48px. The user may be tired or drowsy: clarity beats density.
- Palette: ink #18262B, surface #FFFFFF, background #EDF1F2, accent teal #1E5F74, alert red #A4262C (38.0°C and above), amber #9A5B00 (37.5 to 37.9°C and waits), green #2E6B45 (done). Full dark mode via prefers-color-scheme. No orange.
- Service worker: network-first ALWAYS. skipWaiting() on install, delete ALL caches on activate, network-first on fetch, never cache-first.
- Cache busting: `?v=VERSION` on `scripts.js` and `styles.css` in `index.html`, and the `APP_VERSION` constant in `scripts.js`. Bump on every commit.
- Run `node --check` on every JS file before committing.
- UK English throughout. No em dashes anywhere in UI copy.
- No health data in the repo, ever. Only code.

## Data model (Firestore)
- `entries/{autoId}`: { day "YYYY-MM-DD", at Timestamp, type "med"|"temp"|"drink"|"food"|"weight"|"vitals"|"note", medId?, medName?, dose?, value? (number), heartRate? (number, bpm), systolic? (number, mmHg), diastolic? (number, mmHg), oxygen? (number, %), note?, addedBy, createdAt }
  - The Vitals sheet logs temperature, heart rate, blood pressure and oxygen together. Temperature is saved as its own `type: "temp"` entry (so the 37.5 / 38.0 colouring, the Today tile and the chart all keep working); the other readings save as one `type: "vitals"` entry. All are optional; at least one is required to save. Manual entry only, no HealthKit or Shortcuts integration.
- `medicines/{id}`: { name, dose, how, purpose, kind "scheduled"|"prn", perDay?, minGapHours?, maxPerDay?, courseEnd? "YYYY-MM-DD", active, order }
- `documents/{autoId}`: { title, docDate, kind "images"|"text", category "general"|"chemo", pageCount, text?, explanation, addedBy, addedAt, updatedAt }
  - `category: "chemo"` documents are the chemo plan, listed in the Chemo tab as well as in Documents.
- `documents/{autoId}/pages/{pageNumber}`: { data base64 JPEG, width, height }
- `days/{YYYY-MM-DD}`: { chemo (bool, session planned), chemoDone (bool), mood? (1 to 5), good? (string, "one good thing today"), updatedBy, updatedAt }
- `cheers/{autoId}`: { text, addedBy, createdAt } (the cheer board on the Chemo tab, newest first, last 50 shown)
- `exercise/{YYYY-MM-DD}`: { day, steps? (number), done: { pressups, situps, plank, squats } (bools), addedBy, updatedAt }
- `profile/main`: { calls: [{label, number}], exerciseGoals?: { pressups, situps, plankSeconds, squats } } (goal defaults 20, 20, 60, 2; editable in the app)

## Navigation
Six bottom tabs: Today, Meds, Vitals, Chemo, Exercise, More. Documents lives under More (and chemo plan documents also under Chemo). All charts live in Vitals.

## Access
Only two email addresses may access real data, enforced in `firestore.rules` and mirrored in `config.js` (`users` map). Sign-in screen only; accounts are created in the Firebase console.

## Guest preview mode
A "Guest" button on the sign-in screen gives a fully interactive preview of the app with made-up example data, no Firebase account, no sign-in, no Firestore access at all: nothing to create in the console, nothing to hand out. Tapping it sets `state.demo = true` and calls `startDemoData()`, which fills `state` from `buildDemoFixture()` (realistic made-up entries, a chemo calendar, cheer notes, exercise history). Every quick add, edit and delete throughout the file branches on `state.demo` to mutate that in-memory state and re-render, instead of calling Firestore, so the whole app is explorable but nothing is ever written anywhere; it is gone on refresh or on "Leave preview". A `Preview` pill shows in the topbar throughout. Because this path never touches `auth` or `db`, there is nothing to add to `firestore.rules` for it, and no risk of it ever reaching real data.
