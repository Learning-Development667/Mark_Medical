# Daybook roadmap

The list of what is still to do, in the order to do it, kept in the repository so it is never lost in a chat.
Update it as things are finished: move the item to "Done", with the version number. Started 29 September 2026 at v71.
A simplified live copy with tick boxes is published at https://claude.ai/artifact/PCi6gEEHuHR9idt9fPbwks (private to Mark, pinned in his Claude sidebar); republish it whenever this file changes.

How to read it: each item says what it is, why it matters, who does what (Mark, or Claude in the code), and what "done" looks like.
The order follows one idea: what Mark uses every day comes first, then the foundations other people's data would sit on,
then the name and the look, then the developer review, then the App Store, which is the slowest and hardest to undo.

Decisions already made, so they are not reopened:
- Cost is no longer the constraint. The £79 a year Apple Developer Programme and small running costs are accepted (Mark, 28 September 2026). The free tiers stay because they work, not because they must.
- Legal matters (trademark, company) wait until the app is polished. The name Daybook is already used by a journal app (Daybook Labs), so a new name is needed before any store listing, but not before.
- The data screens stay plain, with no background pictures behind the cards and charts. The sign-in screen has the watercolour and that is where it stays.
- The app never names one AI assistant in its wording. "Daybook's AI service" means the bridge calling the Anthropic API with Mark's own key and one-off credit; nobody using the app needs anything of their own.

## Stage 1: for Mark's own use, now

1. ~~**Confirm the recording rules are published.**~~ Done 29 September: the live rules match the repository. `firestore.rules` gained `recordings` and `recordings/{id}/parts` in v64. Mark: open Firebase console > Firestore > Rules and check the live rules mention `recordings`; if not, paste the file from the repository and Publish. Done when a recorded answer saves on the phone without "Could not save".
2. ~~**Tick Workouts in Health Auto Export.**~~ Done 29 September: a second automation, "Care Log Workouts" (Data Type Workouts, route data and workout metrics off, every 3 hours), beside "Care Log" (Health Metrics). Nothing to send until a walk or swim is recorded on the phone or watch. The bridge and the Exercise tab handle workouts since v69, but the automation only sends what is ticked. Mark: open the automation that posts to the bridge, tick Workouts, run it once. Done when the "From Apple Health" card shows today's walk.
3. **Try a real physio plan through "Add from a photo or PDF of the plan".** The reader was tested with a canned reply only. Mark: photograph a real sheet, or choose an emailed PDF, and note what it read and what it missed. Claude: tune the instructions from that. Done when a real plan comes through with nothing important missed.
4. ~~**Private notifications.**~~ Done in v74: on by default on every phone, including the two already set up; switch it off per phone under More > Settings > Reminders. A setting under More > Settings > Reminders, on by default, per phone: the notification says "A medicine is due" and the app shows the name and dose when opened. Suggested by a friend who saw a medicine name on a lock screen. Claude: the setting on `pushSubs/{id}.private`, the bridge honouring it, the settings switch. Done when a reminder on a private phone shows no medicine name.
5. **Transcribe saved recordings.** A doctor's recorded answer becomes text automatically, so it can be read, copied and included in Notes for the team. Claude: test Cloudflare Workers AI (Whisper) on the bridge first; if the quality is not good enough, the Anthropic API can do it from the same credit. Done when a saved recording gains "Transcript" text on the answer sheet within a minute.
6a. **Treatment plan tab: the look and layout.** Mark wants the Treatment tab's screen tidied up (added 29 September). Mark: a note or screenshot of what jars, or a sketch of what he would rather see. Claude: the redesign. Done when Mark is happy with it on his phone.
6. **Anything else Mark notices day to day.** Small fixes go straight in as they come (the Manage medicines move in v71 is the pattern). Keep a note on the phone and hand them over in a batch.

## Stage 2: foundations, so it is safe for other people

7. **Separate households.** Built in v75 (rules, break-in tests on the emulator, the app on household paths, the bridge per household, the migration and admin workflows). Left to do, Mark from the Actions tab: run "Households, move the data in" with copy, then "Publish database rules" (real), then copy again, verify, and cleanup with the confirmation text; then Claude removes the TRANSITION block from the rules and publishes once more. Done when both phones open on the household and cleanup has run.
8. ~~**Sign-up and invites.**~~ Done in v78: Create an account on the sign-in screen (a sign-in plus its own household), Forgotten your password, invite links from Settings > Household (family, read only, or medicines and treatment only; one use, seven days), a no-household screen for a sign-in that has neither, and Remove for the owner. All through the bridge; the app never writes the records that decide access.
9. **Per-household keys and limits.** The Apple Health inbox key, the reminder subscriptions and the AI explain allowance become per household, so one household cannot spend another's. Claude: a key per household on the bridge, the daily cap counted per household. Done when the demo project and Mark's household have separate counts.
10. **Security hardening.** Host the CDN libraries (Firebase, Chart.js, pdf.js, mammoth, jsPDF) in the repository with pinned versions; add a content security policy; move the diagnostic keys out of web addresses (`/push-test?key=`) into a header; review every place user text is put on screen. (The automated rules tests came with v75.) Claude. Done when the developer friends' checklist has nothing left in these areas.
11. **Export and delete.** A household can download everything as a zip (JSON plus the document pages and recordings) and can erase the household outright. Apple requires it and it is right anyway. Claude: a bridge endpoint for each, buttons under Settings with a two-step confirm. Done when a fresh export opens and a deleted household leaves nothing behind.

## Stage 3: the name and the look

12. **Choose the new name.** Daybook belongs to someone else. Mark shortlists candidates; Claude checks each against the IPO trade mark search, the App Store and Google Play, and the web address. Done when one name is clear on all four.
13. **Rename everywhere, new icon, refreshed sign-in.** The topbar, sign-in, manifest, Home Screen title, PDF footer, share title, copied notes, the pitch, the repository description and the Pages path if it moves. Mark 1 Apps stays as the maker. Mark: the icon in Firefly from Claude's prompts. Claude: the code. Done when "Daybook" appears nowhere but the history in CLAUDE.md.
14. **Privacy policy, terms and About.** Inside the app, in plain English: what is stored and where (Firebase, London), what goes to the AI service and when, that nothing is medical advice, how to export or delete, who to contact. Claude drafts; Mark reads and approves. Done when the App card links to all three and they read well on a phone.
15. **Re-run the accessibility audit.** axe-core on every screen and sheet in both colour schemes, plus the hand checks, and re-date the claim on the App card (currently 28 September 2026). Claude. Done when zero violations again.

## Stage 4: the developer friends

16. **Refresh the pitch and write the handover.** What it is, how to run it against the shared demo, how the bridge fits, and which choices are deliberate (no frameworks, no build step, network-first service worker, all rights reserved). Claude writes; Mark sends. Done when a developer can get it running from the handover alone.
17. **Fix what they find.** Their findings become a numbered list here, each closed with a version number.

## Stage 5: the app stores, Apple and Android
Daybook is one web app, so both stores get the same code. Android users can install it from Chrome today (Add to Home screen) with reminders and recordings working; only the health feed and the store listing are platform work.

18. **Join the Apple Developer Programme.** Mark, £79 a year. A hosted Mac on GitHub Actions can build the iPhone app, so Mark does not need to own a Mac. Decide first who publishes: Apple expects healthcare apps to come from a legal entity, not an individual, so either a charity, hospice or NHS team publishes it under their account, or a small limited company (Mark 1 Apps Ltd, about £50 to set up) does.
19. **Build the native shells.** iPhone: a thin app around the same web code, with Apple Health read directly (no Health Auto Export needed) and proper notifications. Android: a Trusted Web Activity wrapper (Google's own route for web apps) and a Health Connect feed, either through a Play Store app that posts to the bridge's inbox (a one-off purchase, like Health Auto Export) or read directly by the wrapper. Both built on GitHub Actions, no Mac needed. Claude. Done when each shell runs the app from the same repository with no second copy of the code.
20. **TestFlight and Play internal testing, then submission.** Mark and Shelley first, then a small group, then submission to both stores with a demo login for the reviewers and the privacy answers from item 14. Google Play: a developer account is a one-off $25; Google leans the same way as Apple on health apps coming from an organisation, but less strictly.

## Parked, on purpose
- Food barcode lookup on the bridge (`/food?barcode=`, Open Food Facts). Useful, not urgent; the CoFID table and My foods cover most meals.
- A trade mark application. About £170 for one class in the UK; do it once the new name is chosen and the app is going to the store.
- Backgrounds on the data tabs. Decided against (see above).

## Done
- v78 Sign-up and invites: nobody needs the Firebase console or the Actions tab to join or start a household.
- v77 the household helpers fixed (v76 loaded nothing after sign-in).
- v75 Separate households: one locked folder per household, enforced by the database rules and proved by the break-in tests; the bridge per household; migration and admin workflows; the rules published from git.
- v74 Private notifications: "A medicine is due" on the lock screen, the detail in the app.
- v73 Swimming and distances: the bridge converts metres, yards and feet (a pool swim no longer reads as kilometres), Lengths and Distance ways of counting with an optional time, and programme items that tick themselves from matching Apple Health workouts.
- v72 this roadmap.
- v69 Exercise programme: own exercises, physio plan, add from a photo, Apple Health workouts. v70 the plan from a PDF, Word or text file. v71 Manage medicines moved to the top of the Meds tab.
- v68 Licence and copyright notice. v67 demo wipe covers recordings, push subscriptions and reminders. v65 sign-in watercolour. v64 recorded answers with consent. v63 Treatment plan with session types. v62 opener film. v60 and v61 Explain in Daybook. v59 carer's view and the treatment cycle chart.
