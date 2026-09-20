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
- `index.html`, `styles.css`, `scripts.js`, `sw.js`, `manifest.json`, `config.example.js`, `icons/`, `firestore.rules`, `CLAUDE.md`, `docs/heart-rate-shortcut.md`.
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
- `entries/{autoId}`: { day "YYYY-MM-DD", at Timestamp, type "med"|"temp"|"drink"|"food"|"weight"|"heart"|"note", medId?, medName?, dose?, value? (number), note?, addedBy, createdAt }
  - `type: "heart"` holds a heart rate in bpm as `value`. Logged either by hand or via the "Get from Apple Health" button, which hands off to an iOS Shortcut that reads Health and writes the entry directly to Firestore (the web app itself never touches HealthKit). See `docs/heart-rate-shortcut.md`.
- `medicines/{id}`: { name, dose, how, purpose, kind "scheduled"|"prn", perDay?, minGapHours?, maxPerDay?, courseEnd? "YYYY-MM-DD", active, order }
- `documents/{autoId}`: { title, docDate, kind "images"|"text", pageCount, text?, explanation, addedBy, addedAt, updatedAt }
- `documents/{autoId}/pages/{pageNumber}`: { data base64 JPEG, width, height }
- `profile/main`: { calls: [{label, number}] }

## Access
Only two email addresses may access data, enforced in `firestore.rules` and mirrored in `config.js` (`users` map). Sign-in screen only; accounts are created in the Firebase console.
