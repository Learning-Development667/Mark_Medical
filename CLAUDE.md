# Daybook

My Medical Daybook: a private health tracker shared by a care circle (a patient and the people they choose), made by Mark Brown for his own cancer treatment and run by Mark 1 Apps Ltd. Hosted on GitHub Pages from `main`, root, at https://app.mymedicaldaybook.co.uk/ (the `CNAME` file; the old github.io address redirects). The website is https://mymedicaldaybook.co.uk (its own repository, `mymedicaldaybook-site`, with its own CLAUDE.md). In Beta until the App Store and Google Play (`APP_STAGE` in `scripts.js`; clear it and `BETA_CODES_REQUIRED` in `worker/wrangler.toml` at the stores).

**This file is the rules and the shape of the app. Every version's detailed notes are in `docs/HISTORY.md`** (searchable by function name, element id or version, e.g. `grep -n "v359\|afterTreatmentLog" docs/HISTORY.md`). Read the relevant history before changing a feature. When you finish a version, add a short section at the top of the history's Version notes, not here; only add to this file when a lasting rule or a structural fact changes.

## Working rules (Mark's, in force)
- **Ask before a big decision** (22 October 2026). When a request could be read more than one way, or would remove, replace or change the kind of something already there (a tile, a section, a screen, a count turned into an average, a feature taken off), ask first in one short question with a recommendation. Do the clearly asked part straight away; never widen a request on your own reading of it. Small obvious fixes inside what he asked need no question.
- **Change nothing on a screen until Mark agrees it** when he is reviewing a design; show a mock-up first for anything visual and new.
- All work is committed directly to `main`. No branches, no pull requests, unless Mark asks. Bump on every commit: `APP_VERSION` in `scripts.js` and the `?v=` on `scripts.js` and `styles.css` in `index.html`.
- Run `node --check` on every JS file (including `worker/src/index.js`) before committing.
- UK English. **No em dashes** anywhere a person reads.
- Scope: only the Learning-Development667 repositories. Never read, write or search Innovation-mag (Mark's work organisation) unless he expressly allows it in that conversation.
- **No health data in the repo, ever.** No real names of Beta testers, no Beta codes or their labels, no D-U-N-S number, enrolment ids, passwords or home address: the repository is public.
- **No tool run from Actions prints a name, a medicine, a Beta code, a label or a time anything was taken or eaten**; ids, counts and states only (`hidden()` masks to two characters). Actions logs of a public repo are public.
- Never put a model identifier in commits, code or docs.
- **ROADMAP:** `tools/roadmap_page_gen.py` is the one source of the open actions. After any roadmap change run `python3 tools/roadmap_page_gen.py` and republish `roadmap.html` to the live page (https://claude.ai/artifact/PCi6gEEHuHR9idt9fPbwks) in the same turn. Never edit the generated block of ROADMAP.md by hand; a finished action leaves the script's lists and gets a line in ROADMAP.md's Done.
- **The Guide follows the app** (20 October 2026): a change to anything a Guide topic shows updates its step in `tools/guide_shots.js` and retakes the frames in the same version (`node tools/guide_shots.js`; offline needs the scratchpad harness, see the history's v242 and v270), then copy `guide/` to the website and bump `guide.json?v=` in its `js/site.js`. Look at every changed frame before pushing. During a declared tidy-up batch, retake once at the end.
- **What's new** (`WHATS_NEW` in `scripts.js`): bundle about twice a week, only what a person would notice, in plain words; **Mark approves each batch's words before it ships**. Items can be limited to a pack.
- Test in headless Chromium with Playwright (the scratchpad harness serves the repo with a Firebase stub, `vendor/` libraries and fonts); check 390 light and 320 dark, no sideways scroll, controls 44px or more, no page errors, axe where a screen changed. Say plainly what was not tried on an iPhone (no WebKit here) and ask Mark to check.

## Product rules (lessons that must not be undone)
- **Facts, never judgements or advice.** Daybook is not a medical device: it never says whether something is a flare, what a result means, or when to ring; the levels are a few fixed, documented thresholds, and the reports say "Not medical advice". Results are shown as given, with the lab's range "as given", never coloured or flagged.
- **A reading and a person's words are two separate lines on every report, never one sentence** (v332).
- **Nothing on a report is cut short**: text is never shortened or ended with an ellipsis; what does not fit moves to another page (v236). Exception: the Pain report's key points by design (v263), with every note kept on the screen. Do not squeeze charts to save a page (Mark: three pages is fine).
- **Counts stay counts; readings that go up and down are averages coloured by the average** (v274 to v276). Ask before turning one kind of tile into another.
- **Pain, symptoms and sickness are 0 to 10** with the NHS bands (none 0, mild 1 to 3, moderate 4 to 6, severe 7 to 10); flagged amber from 4, red from 7 (sickness's report limit is 6). Skipped is `null`, never 0.
- **Never name the Bristol Stool Chart** or copy its wording or pictures (copyright Norgine); the seven types are in our own words (`BRISTOL`; identifiers keep the name).
- **Anything that stops a save marks the field itself in red with "Missing information"** (or "Check this"), never only a message at the top (`missing()`, `markMissing()`).
- **Never let a typed reading be dropped silently**: number boxes are text boxes with a numeric keypad read by `readNum()`; a value that cannot be read stops the save and names the box. Never put a plausible number in a placeholder.
- **A check-in belongs to whoever filled it in** (`ownsCheckin()`, the `uid` stamp, enforced in `firestore.rules`). Carer slots (`carer`, `carermorning`, `carerevening`, `weekcarer`) never count as patient figures (`isPatientCheckin()`).
- **Mood words stay off Notes for the team** unless Settings' tick is on (`moodWordsToTeam()`).
- **The full name** "My Medical Daybook" appears only on the cover screens, the opener, the reports ("Created with My Medical Daybook" by the title and in every footer), the static `<title>`, `manifest.json` `name`, README and LICENSE, always as "My Medical" small over "Daybook" large. Everywhere inside the app it is just **Daybook**. The pasted header `=== CARE LOG DOCUMENT ===` is a data format and stays.
- **Daybook Assistant** is the AI helper's name everywhere; the privacy page discloses once that it is Claude by Anthropic (US). Every AI button keeps its one-line disclosure. Never write "Daybook's own AI". The app must work fully without it.
- **Hints are a line or two**; what a button does is said by the button and the Guide.
- Toasts sit at the top of the screen, never over anything you tap. No visible change on `touchstart` anywhere (iPhone drops the click). Never open a report in a new tab (Home Screen apps cannot); reports preview in the in-app viewer.

## Code rules (bugs we have already paid for)
- Never hand `replaceChildren()` or `append()` a bare `null` (it prints "null"); spread an empty array. Anything mapping over `entryTitle()` must `filter(Boolean)`.
- Never name a local `f` in `worker/src/index.js` (it shadows the field reader; v100).
- Data is reached only through `hcol()` / `hdoc()` (app) and `hp()` (bridge), which prepend `households/{hid}`.
- Any script from outside must be added to the Content Security Policy meta in `index.html` or it will not load. Libraries live in `vendor/` at fixed versions with their licences; only Firebase (gstatic) and Google Fonts come from outside. pdf.js is called with `isEvalSupported: false`.
- Report frames: no `<pattern>`, `url(#...)` fills or `data:image/svg` backgrounds (Safari taints the canvas). The hidden PDF frames (`report-frame-*`) are not sandboxed (Safari's html2canvas hangs); the CSP still blocks script there.
- Large uploads through the bridge are kept as bytes: never `JSON.parse`, regex or re-stringify megabytes in the worker (free plan's 10 ms CPU; v246).
- Bridge keys travel in the `X-Care-Log-Key` header only, never `?key=`.
- Any feature that polls or lists is sized for reads a day at 300 and 3,000 circles.
- Every Firestore page or part document stays under 900 KB.
- Service worker: network-first always, `skipWaiting()`, delete all caches on activate, never cache-first.
- Icon addresses carry `?i=2`; bump it when the icon pictures change.
- Background wash pictures are baked so every text token keeps 4.5:1 on them; redo that measurement if they are ever remade.

## Cost rule ("cheap, not free", Mark, 18 October 2026)
- Pay-as-you-go only, never a fixed monthly bill while usage is small: Firebase Blaze with a budget alert (Auth and Firestore only; no Storage, no Functions), GitHub Pages, one Cloudflare Worker on the free plan (the bridge), Resend's free emails.
- Daybook Assistant is capped per circle: 40 a day (`EXPLAIN_LIMIT_REAL`; demo 12), and non-report uses 60 a month (`EXPLAIN_LIMIT_MONTH`). **A report summary for a clinician is never refused by the month** (`EXPLAIN_REPORT_KINDS`). Paid from the Anthropic Console credit.
- Secrets never go in the public site: they live as Worker secrets set from GitHub repository secrets by `.github/workflows/deploy-worker.yml`. `config.js` holds only the public Firebase web config (plus the demo's public guest details, the bridge URL, the push public key and the contact email).
- Rough cost at 300 active circles: about £5 a month, nearly all storage; letters and recordings could move to Cloudflare R2 if storage grows.

## Company and licence
Copyright 2026 Mark 1 Apps Ltd (company number 17510025, England and Wales; Mark and Shelley directors), by a Deed of Assignment of 10 October 2026; ICO registration ZC275185. The code is published to be read, not copied (`LICENSE`). On white or light backgrounds the Mark 1 Apps mark is `icons/mark1apps-line.png`, never the neon one in a dark box or inverted.

**Company documents go out on the letterhead** (Mark, 3 November 2026): letters, the DPIA, policies, anything sent to another organisation, as Word files from `tools/letterhead/make_doc.cjs` (Markdown in, `.docx` out: the faint sky header with the logo, the watercolour foot with the company lines, Arial 11 pt so Pages reads it right). The phone number is passed in as `LETTERHEAD_PHONE` and kept out of this public repository; it is in the brand rules doc (Claude Docs, "Mark 1 Apps brand rules"), which also holds the colours and fonts. **The brand is agreed** (Mark and Shelley, 3 November 2026): `docs/brand/BRAND.md` is the written record (logo, colours, fonts, the watercolour, voice, names, photographs, easy to read), with the logo, lockup and letterhead pictures beside it; follow it for anything the company makes. Navy #17263A and teal #18727A are the company's colours; the old bright blue is retired.

## Stack and files
- Vanilla HTML, CSS and JS, no frameworks, no build step. Firebase JS SDK v10 modular from gstatic. Chart.js, pdf.js 3, mammoth, jsPDF, html2canvas, JSZip and ZXing from `vendor/`, loaded lazily (`CDN` in `scripts.js`). Fonts: Fraunces 600 and Inter from Google Fonts.
- `index.html` (screens, sheets' templates, the privacy, terms and About templates), `styles.css` (tokens at the top; later look changes as dated blocks at the end), `scripts.js` (the app), `report.js` (every printed report), `sw.js`, `manifest.json`, `config.js`, `guide/` (generated), `icons/`, `vendor/`, `data/cofid.json` (the UK food table, built by `tools/build_cofid.py`), `firestore.rules` and `firestore.demo.rules`.
- `worker/`: the bridge, a plain module worker (`src/index.js`, `wrangler.toml`, `README.md`), deployed by the Deploy bridge worker workflow on push.
- `tests/rules/`: the rules break-in tests on the Firestore emulator (`rules-test.yml` runs them).
- `tools/`: `household_admin.mjs` (Household admin workflow: rescue, keys, Beta codes, `beta-rotate`, read-only checks), `publish_rules.mjs` (Publish database rules; refuses the wrong project), `reset_demo.mjs` (nightly demo wipe), `guide_shots.js`, `roadmap_page_gen.py`, `com_redirect.mjs` (the .com redirect on Cloudflare), `vapid_keys.mjs`, `lib/firestore_rest.mjs`.
- `docs/HISTORY.md`: every version's notes.

## Standards (look and access)
- Body text 17px minimum; tap targets 48px (44px floor). The user may be tired or drowsy: clarity beats density.
- Palette (the report look, since v122): page #F6F4EF, surface #FFFFFF, mist #EEF3F6, ink #17263A, secondary #4B5B6B, muted #56667A, line #D5DEE5, teal #18727A text / #1E7F86 fill, green #2D7354 / #3F8F6B, amber #8A5E10 / #E0A030, red #B0372E / #C8453B, terracotta #C2703D for emphasis only. Fills are never text. Dark: page #0F1B24, surface #172633, teal #5CC3C9. Gold-rim pill buttons, cream cards with a gold hairline, a coloured tab bar and a tab-colour accent per screen (v348 to v356). Design tokens only, no scattered hex (except fixed paper colours in reports).
- Fraunces 600 for the brand, titles, headings and large values; Inter for everything else (tabular figures only on numbers).
- WCAG 2.2 AA with zero axe violations in both colour schemes; every sheet a real dialog (inert background, focus moved in and returned, Escape closes); nothing overflows at 320px; every chart canvas has `role="img"` and a label. Motion off under reduced motion.
- Icons are inline SVG symbols; no emoji.

## The shape of the app
- **Care circles** (`households/{hid}` in the database; "care circle" in every word a person reads). Everything lives under `households/{hid}/...`: `entries`, `medicines`, `documents` (+`pages`), `recordings` (+`parts`), `profile/main`, `days`, `exercise`, `meals`, `nutrition`, `pushSubs`, `reminders`, `private`, `bridge`, `members`, `invites`. `users/{uid}.household` is the pointer. Roles: `family` (full), `readonly` (sees everything, changes nothing), `viewer` (medicines, treatment and some charts only). Relation `patient` / `carer` / "". The circle is the patient's: only the patient and whoever set it up invite or remove; it can be handed over. The rules enforce all of it; the app and bridge never write membership except through the bridge.
- **Sign-up**: the app makes the Firebase sign-in; the bridge makes the circle (`/household`, needs a Beta code while in Beta), invites (`/invite`, `/join`, `?invite=`), removals and hand-overs. `?beta=CODE&for=cancer|ibd|general` from the website fills the code and the condition.
- **Condition packs** (`profile/main.packs`): `cancer`, `ibd` (Crohn's or colitis), `general` (Something else, any long-term condition, with `condition` words). They combine; a circle saved before packs is `{ cancer: true }`. Pack-specific questions, wording and reports follow `packOn()`.
- **Tabs**: Today (check-ins, Your week, the question row, the quick-add tiles, the timeline), Meds, Treatment (calendar, sessions, cycles, flare plan for IBD), Exercise, Reports (Reports | Trends), More (Who to contact, Help and settings).
- **Entries** (`entries/{id}`, `type`): med, temp, vitals, weight, drink, food, note, sleep, nap, pain, mood, symptom, bowel, question, checkin (`{day}_{slot}`), result, call, sent, exercise. Check-in slots: morning, evening (18:00 to 05:59), week, and the carer's. Questions carry a `team` label (Oncology, Gastro, General, Not sure, Dietitian, Pain team).
- **Reports** (all in `report.js`, house style of v143): Notes for the team (two pages, more when needed, with Tidy up my notes via the Assistant), Food diary, Mood and wellbeing, Pain and pain relief, Crohn's and colitis, Medicine history. Preview in the in-app viewer, Print, Save as PDF, and Send to the team (emailed by the bridge through Resend from reporting@mymedicaldaybook.co.uk in the sender's name, reply-to and cc the sender, only to a saved contact, only from a confirmed email).
- **The bridge** (Cloudflare Worker `care-log-bridge`): Apple Health inbox (`/health`, Health Auto Export), Daybook Assistant (`/explain`, kinds per feature), reminders (cron every five minutes reading one plan document), barcode and packaged food lookups (`/food`, Open Food Facts), send-report, verify-email, feedback, usage counts for the operator's circle only (`/usage`), delete a circle or a sign-in, Beta code checks.
- **Demos**: in-memory previews that never touch Firebase (`?preview=cancer` Sam, `?preview=ibd` Jo, `?preview=general` Robin), from the sign-in screen's Demo button; and a shared live demo on a separate Firebase project, wiped nightly.
- **Privacy, terms and About** are templates in `index.html` (`tpl-privacy`, `tpl-terms`, `tpl-about`), dated at the top; when their text changes, change the date and copy them to the website's `privacy.html` and `terms.html`.
