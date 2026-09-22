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
- Chart.js, pdf.js (3.x UMD build), mammoth.js and jsPDF (2.5, for "Save as PDF" on the reports) from cdnjs, loaded lazily when needed.
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
- `entries/{autoId}`: { day "YYYY-MM-DD", at Timestamp, type "med"|"temp"|"drink"|"food"|"weight"|"vitals"|"note"|"sleep", medId?, medName?, dose?, value? (number), heartRate? (number, bpm), systolic? (number, mmHg), diastolic? (number, mmHg), oxygen? (number, %), note?, amount? (food: "A few mouthfuls"|"About half"|"Most of it"|"All of it"), detail? (food: what went with it), deep?/rem?/core?/awake? (sleep stages, minutes), addedBy, createdAt }
  - Sleep entries: `value` is minutes asleep for the night before, logged against the morning (`day` is the wake-up date). Typed in by hand from the Apple Health sleep screen (no HealthKit integration); the four stage fields are optional. Shown on the Today timeline, as a Latest tile and a bar chart in Trends, in the readings line of Notes for the team, and flagged there as a short night under 5 hours.
  - Food entries: `note` is the meal name, `detail` the optional "what is in it" text. The Food diary (Trends > Reports) lists food entries day by day with each day's drinks total, over 7 to 90 days, and has a Print button (print stylesheet in `styles.css`).
  - Notes for the team (Trends > Reports): collates every `type: "note"` entry plus notes attached to temp, weight, vitals and med entries, by day, with the day's mood and "one good thing", a readings summary and when-needed doses. A "Worth mentioning" list comes from `vitalsFlags()`: plain threshold checks (temp 37.5/38.0, heart rate 100/120 or 50 and under, BP 140/90 and 160/100 or systolic 90 and under, oxygen 93/90 and under, weight down 2 kg (red at 4 kg), days under 1 L of drinks, days with nothing eaten, when-needed medicine use, low-mood days). Not medical advice, and the UI says so. Letters and documents whose `docDate` falls in the range are included (title, date and full explanation in the text; a card with an excerpt and "Open the document" on screen). Send/Copy prefix the text with `NOTES_PROMPT`, asking Claude for questions for the oncologist or nurse. "Save as PDF" (`savePdf()`, jsPDF, A4, Helvetica) makes a people-facing copy without the prompt and hands it to the share sheet when files can be shared (Save to Files, Mail, AirDrop), otherwise downloads it; the Food diary has the same button. Print uses the same print stylesheet as the Food diary.
- `meals/{autoId}`: { name, parts (string, what goes with it, may be empty), addedBy, createdAt, updatedAt }. Saved automatically when food is logged with "Remember this meal" ticked (on by default; an existing meal's parts are updated if changed). Offered as quick buttons and datalist autocomplete in the Food sheet, which fills `parts` in. Managed under More > Saved meals.
  - The Vitals sheet logs temperature, heart rate, blood pressure and oxygen together. Temperature is saved as its own `type: "temp"` entry (so the 37.5 / 38.0 colouring, the Today tile and the chart all keep working); the other readings save as one `type: "vitals"` entry. All are optional; at least one is required to save. Manual entry only, no HealthKit or Shortcuts integration.
- `medicines/{id}`: { name, dose, how, purpose, kind "scheduled"|"prn", perDay?, minGapHours?, maxPerDay?, courseEnd? "YYYY-MM-DD", active, order }
- `documents/{autoId}`: { title, docDate, kind "images"|"text", category "general"|"chemo", pageCount, text?, explanation, addedBy, addedAt, updatedAt }
  - `category: "chemo"` documents are the chemo plan, listed in the Chemo tab as well as in Documents.
  - Title, date and category can be changed after saving ("Edit title, date or category" on the document screen).
- `documents/{autoId}/pages/{pageNumber}`: { data base64 JPEG, width, height }
- `days/{YYYY-MM-DD}`: { chemo (bool, session planned), chemoDone (bool), mood? (1 to 5), good? (string, "one good thing today"), updatedBy, updatedAt }
- `cheers/{autoId}`: { text, addedBy, createdAt } (the cheer board on the Chemo tab, newest first, last 50 shown)
- `exercise/{YYYY-MM-DD}`: { day, steps? (number), done: { pressups, situps, plank, squats } (bools), addedBy, updatedAt }
  - The Exercise tab has day arrows, and the Steps sheet has its own day picker (date field plus Today and Yesterday buttons, capped at today) so yesterday's steps can be logged the next morning.
- `profile/main`: { calls: [{label, number}], exerciseGoals?: { pressups, situps, plankSeconds, squats } } (goal defaults 20, 20, 60, 2; editable in the app)

## Navigation
Six bottom tabs: Today, Meds, Trends, Chemo, Exercise, More. "Vitals" is the name of the reading you log (the Today quick-add button and the Log vitals button); "Trends" is the look-back tab: a Reports row (Notes for the team, Food diary, Documents), the Latest tiles and every chart. The tab's internal ids stay `vitals` (`view-vitals`, `data-tab="vitals"`). Documents also lives under More (and chemo plan documents under Chemo); Saved meals, who to call and the app section are under More. Report pages remember the tab they were opened from (`state.reportReturn`, `state.docsReturn`) for Back and for tab highlighting.

## Access
Only two email addresses have full access, enforced in `firestore.rules` (`isFamily()`) and mirrored in `config.js` (`users` map). Sign-in screen only; accounts are created in the Firebase console.

### Read-only viewer
A further account can be added for someone who should see Mark's medicines, the chemo plan and mood, and the Trends charts, with no editing rights and nothing else visible. Two places to set up, both already wired in the app code:
- `firestore.rules`: their email goes in `isViewer()`. Read-only access is granted on `medicines`, `days` (chemo/mood) and `entries` of type `med`, `temp`, `vitals`, `weight`, `sleep` or `drink` only; `food` and `note` entries, `documents`, `cheers`, `exercise`, `profile` and `meals` stay `isFamily()`-only, so this is enforced at the database level, not just hidden in the UI.
- `config.js`: their email maps to `{ name, role: "viewer" }` instead of a plain name string.
Signing in as a viewer (`isViewerEmail()`, `state.viewer`) sets `setViewerMode(true)`: the bottom nav drops to three tabs (Meds, Chemo, Trends), landing on Meds; a "View only" pill shows in the topbar; and every add/edit/delete control on those three tabs is hidden (Log now/Other time/Manage medicines, Log vitals, the Reports row, the Chemo cheer board and plan documents section, and the calendar days stop being tappable). Today, Exercise, More and the reports are never reachable by a viewer.

## Guest preview mode
A "Guest" button on the sign-in screen gives a fully interactive preview of the app with made-up example data, no Firebase account, no sign-in, no Firestore access at all: nothing to create in the console, nothing to hand out. Tapping it sets `state.demo = true` and calls `startDemoData()`, which fills `state` from `buildDemoFixture()` (realistic made-up entries, a chemo calendar, cheer notes, exercise history). Every quick add, edit and delete throughout the file branches on `state.demo` to mutate that in-memory state and re-render, instead of calling Firestore, so the whole app is explorable but nothing is ever written anywhere; it is gone on refresh or on "Leave preview". A `Preview` pill shows in the topbar throughout. Because this path never touches `auth` or `db`, there is nothing to add to `firestore.rules` for it, and no risk of it ever reaching real data.
