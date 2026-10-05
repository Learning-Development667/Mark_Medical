# Daybook action list

What is left to do, as a plain list of actions in the order to do them. It replaced the staged roadmap on 4 October 2026 (v106), when Mark asked for a logical list rather than a plan. Kept in the repository so it is never lost in a chat.
Tick an action off by moving it to "Done" with its version number. A live copy with tick boxes is at https://claude.ai/artifact/PCi6gEEHuHR9idt9fPbwks (private to Mark, pinned in his Claude sidebar); republish it whenever this file changes.

Five stages, in Mark's order: **Build** (what the app does), **UI** (how it looks), **UX** (how it feels to someone new), **Website**, **App stores**. The website is near the end because it shows the app, so it waits until the app stops changing. The paperwork runs alongside, since it is mostly waiting. New ideas go into the right stage before they are built.

Best guess (4 October 2026): about 60 percent of the way to both stores, roughly 30 build days, six to eight weeks at the pace so far.

Decisions already made, so they are not reopened:
- Cost is no longer the constraint: the Apple Developer Programme and small running costs are accepted (Mark, 28 September 2026). The free tiers stay because they work.
- The name is **My Medical Daybook** in full, Daybook inside the app (v89).
- The data screens stay plain: no background pictures behind the cards and charts.
- The AI helper is called **Daybook Assistant** (v116, Mark: some people are wary of AI or have never heard of Claude). The privacy page, terms and About say once, plainly, that it is Claude, made by Anthropic in the US, reached through the bridge with Mark's own key and credit. The share-sheet route still names no assistant ("Send to my AI app").

## Stage 1: Build
Everything the app needs to do before the look changes, so nothing is restyled twice.
1. **Siri Shortcuts.** Claude: links that open Daybook with a sheet already filled in (`?add=temp&value=37.8` and the like), then a Shortcut per job ("Log my temperature", "Log a dose", "Question for the team") with the steps to add each to Siri. Free, no Apple Developer Programme needed. Done when "Hey Siri, log my temperature" opens Daybook with the number in the box on Mark's phone.
2. **Try a real physio sheet.** Mark: photograph a real plan, or choose an emailed PDF, through "Add from a photo or PDF of the plan", and say what it missed. Claude: tune the reader. Done when a real plan comes through with nothing important missed.
3. **Weight from Apple Health.** Mark: tick "Weight and Body Mass" in the Care Log automation in Health Auto Export. Claude: the bridge files it as `entries/{day}_weight` (`addedBy: "Apple Health"`). Done when a morning weigh-in shows on Today without being typed.
4. **Turn saved recordings into text.** Claude: transcribe on the bridge (Cloudflare Workers AI first, the Anthropic credit if that is not good enough). Done when a recorded answer gains a transcript within a minute.
5. **Finish the households move.** Mark, Actions tab: "Households, move the data in" with verify, then cleanup. Claude: take the TRANSITION block out of the rules and publish them. Mark checks on the phone: steps and sleep still arriving, sign-up switched on in Firebase, one test invite made and removed. Done when all of that passes.
6. **Move to app.mymedicaldaybook.co.uk.** Mark: in Cloudflare a CNAME `app` to `learning-development667.github.io` (DNS only) and email routing for support@; the new address in Firebase's authorised domains. Claude: push the move (built and waiting on the `domain-move` branch), set the contact address, then the reinstall steps for both phones. Done when both phones run from the new address with reminders working.
7. **Security tightening.** Claude: the CDN libraries hosted in the repository at fixed versions, a content security policy, the diagnostic keys out of web addresses, a review of every place typed text is shown. Done when nothing is left on that checklist.
8. **Export and delete.** Claude: download everything as a zip, or erase the household, from Settings with a two-step confirm. Apple requires it and the privacy page promises it. Done when an export opens and a deleted household leaves nothing behind.
9. **Condition profiles, with Crohn's and colitis second.** Claude: a profile chosen at sign-up and changeable in Settings, switching the tiles, the check-in questions, the Notes topics and thresholds (each from a published source) and the Treatment tab. Cancer stays exactly as it is for Mark and Shelley. Done when switching profile changes Today, the check-ins and Notes for the team.
- **Ongoing:** small fixes from day-to-day use go straight in (v97 to v105 came from a hospital bed); new ideas go into this list first.

## Stage 2: UI, how it looks
10. **The icon.** Today's Home Screen icon is still the Care Log heartbeat. Mark makes the final image in Firefly (the two leaning shapes and a sun lead); full-bleed square, motif inside the middle 65 percent. Claude makes every size for the Home Screen and both stores. Done when it is on the phone.

## Stage 3: UX, how it feels to someone new
11. **A fresh-eyes trial.** Mark: find one or two people who have never seen Daybook (not Shelley) and watch them create an account on the demo, log a day and make Notes for the team, without help. Note every place they stop or ask. Claude: fix each one. Done when a newcomer gets through without asking.
12. **Accessibility re-check.** Claude: axe-core on every screen and sheet in both colour schemes, plus the hand checks, and the date on the App card renewed. Done when there are zero violations.
13. **User guide.** Claude: in the app (More > Guide) and as a PDF, by task, with screenshots of the new look and made-up data. Done when someone new can set up and use every main feature from the guide alone.
14. **Developer friends.** Claude: the pitch refreshed and a handover pack (how to run it on the demo, how the bridge fits, the deliberate choices). Mark sends it. Claude fixes what they find, each closed with a version number. Done when their list is empty.

## Stage 4: Website
15. **The website at mymedicaldaybook.co.uk.** Claude builds a few pages in the chosen look: what Daybook is, who it is for, screenshots, the privacy page and terms, a support page, and how to install it (the web app now, the stores later). Mark reviews. The stores need its privacy and support addresses. Done when the site is live and the app links to it.

## Stage 5: App stores
16. **Join the Apple Developer Programme.** Mark: enrol as Mark 1 Apps Ltd (see Paperwork), about £79 a year; accept the agreements; make an App Store Connect API key and save it as a repository secret. Done when GitHub can upload a build.
17. **Build the iPhone and Android apps, with Siri.** Claude: a thin iPhone app around the same web code with Apple Health read directly and Siri actions ("Log a dose", "Read this medicine", "Summarise this letter"); an Android wrapper with Health Connect. Built on GitHub, no Mac needed. Done when "Hey Siri, log a dose" works on Mark's phone.
18. **TestFlight, then both stores.** Mark and Shelley first, then a small group, then submission with a demo login for the reviewers. Google Play is a one-off $25 account. Done when both stores list Daybook.
19. **Trade mark for "My Medical Daybook".** Mark: an IPO search in classes 9, 42 and 44, then about £170 for one class. Done when the application is in.

## Paperwork, alongside (Mark, started 4 October 2026)
Decided: Mark is registering **Mark 1 Apps Ltd** (4 October 2026), with Shelley as director so the company, and Daybook with it, can carry on in her hands. A company that makes apps is what Apple's guideline 5.1.1(ix) asks for; it does not have to be a health or medical business, since Daybook gives no medical service. It also means a claim is against the company, not Mark's own home and savings. Mostly waiting, so it runs while Stages 1 to 4 are built. All of it must be done before action 16.
- **Check the name.** Search "Mark 1 Apps" on the Companies House register; nothing with that exact name was found on 4 October (Mark 1 Associates Ltd and Mark1 Conversions Ltd exist, which does not block it).
- **Shelley verifies her identity with GOV.UK One Login.** Free, about 15 minutes with a passport or driving licence and the phone's camera. Required for every director and anyone holding a quarter or more of the shares since 2026, so Mark verifies too if he keeps shares.
- **Register the company at Companies House online.** About £100 (it doubled from £50 on 1 February 2026; check the GOV.UK page for the current fee). Needed: the name, Shelley as director (Mark as a second director too, if he wants, so either can sign while both are here), who holds the shares, the business type (SIC 62012, business and domestic software development), a registered email address (private), and a registered office address. That address is public on the register for good, so use a registered office service (about £20 to £60 a year) rather than home.
- **Afterwards:** register for Corporation Tax with HMRC within three months of starting to trade; a yearly confirmation statement and accounts (an accountant or the free HMRC and Companies House tools for a very small company); a separate bank account.
- **A D-U-N-S number** for the company. Free, through Apple's own D-U-N-S look-up once the company exists, about two weeks.
- **ICO registration** in the company's name, about £52 a year, before anyone outside the family uses it.
- **For Apple's organisation enrolment (action 16):** a public website and an email address on a domain the company uses. The mymedicaldaybook.co.uk site (action 15) naming Mark 1 Apps Ltd, and support@mymedicaldaybook.co.uk, should do; enrol only when the build is close, since the yearly fee starts on enrolment.
- **Daybook belongs to the company.** A one-page written assignment of the code, the name and the artwork from Mark to Mark 1 Apps Ltd (the LICENSE names Mark personally today), so it passes with the company and not through probate. Shares go to Shelley now or by Mark's will; a solicitor or the free will services through Macmillan and Marie Curie can do both properly.
- **Shelley can reach everything.** The GitHub account, Firebase, Cloudflare (the bridge and the domain), the Anthropic Console, Health Auto Export and, later, Apple: either in the company's name with Shelley as an owner, or written down for her. Claude writes her a plain guide to keeping Daybook running, or closing it gently, when Mark wants it.
- **Then Claude updates the wording:** Mark 1 Apps Ltd as the responsible party in the privacy page, the terms, About, the LICENSE, README and the Settings App card, with the company number.

## After the stores: more conditions
One at a time, each a few days with its sources checked, on the profile mechanism from action 9. Each needs the tiles, the check-in questions, the Notes thresholds with sources, demo data and a test. The demo gains a profile switcher.
- Menopause.
- Long-term pain, fibromyalgia, ME.
- Heart failure and kidney disease.
- COPD and asthma.
- Diabetes.
- Migraine and epilepsy.
- Dementia and frailty, carer-led.
- Recovery after surgery.

## Next project, not started
**Mark 1 Apps website and storefront** (Mark, 1 October 2026). Mark's own website showing the apps he has built, a bit like a small Apple or Android store. For now each app can be installed as a web app (PWA) or the Android equivalent, and later each links out to its real store listing so people can buy it. Learning and Development was the business name Mark used before he stopped work because of his cancer; Mark 1 Apps is the name going forward. Not being worked on yet. Questions to settle when it starts: which apps go on it, the domain (mymedicaldaybook.co.uk is bought; actions 6 and 15), whether anything is sold on the site or only linked, and what the pages look like (the look chosen in action 10 may carry over).

## Parked, on purpose
- Food barcode lookup on the bridge (`/food?barcode=`, Open Food Facts). Useful, not urgent; the CoFID table and My foods cover most meals.
- Backgrounds on the data tabs. Decided against (see above).
- An "AI used this month: about 12p" line under Settings, from the bridge's own token tally. Offered 4 October; build if wanted.

## Done
- v124 Ticking a gentle exercise and its Timer work on an iPhone again (the swipe-to-remove reacted to every touch). The At home | In hospital switch on the Meds tab went; hospital medicines always show.
- v123 Medicine cards fit a small phone; the Given in hospital pill is easier to read.
- v122 The rebrand: the whole app in the report look Mark chose (Direction D on the brand board): a warm white page, Fraunces headings and Inter text, the readings as soft coloured panels with a stripe (teal, green steady, amber worth a mention, red to raise), the quick-add buttons in their own colours. Choosing the look and restyling the app are done; the icon is next in Stage 2.
- v121 The Food diary saves as a PDF on an iPhone; Print on an iPhone goes through the share sheet; the report preview no longer looks crowded; the report buttons answer faster.
- v120 Preview and Print open inside Daybook (the iPhone showed a blank page), and a PDF that cannot be made now says why.
- v119 The Food diary became two A4 pages in the same design as Notes for the team: protein against the target, drinks, food groups and points to discuss with room for the dietitian, then the trends and two weeks. Both reports now share one way of counting food days and the same weeks.
- v118 Trends renamed Reports, with Notes for the team as the big card at the top; the Food diary can be emailed (to the dietitian) like Notes; on both, Send, Preview and Save as PDF come first and every button has its own colour.
- v117 Notes for the team became the two-page report from the approved design: the latest new symptom, eight tiles, the medicines strip and the questions with room to write on page 1, eight charts and two weekly cards on page 2, every figure worked out from the readings and always exactly two A4 pages. Preview prints it; Save as PDF and Send to the team attach it. Daybook Assistant can write each week up and tidy the spelling on a tap.
- v116 Wording put right after a check of every claim in the app: the AI helper named Daybook Assistant with an honest line saying it is Claude from Anthropic, temperature words that point to the alert card instead of calling anything "normal", "Within limits" for the green summary, and a privacy page that says exactly what is stored, where and who can see it.
- v115 The notes in Notes for the team come in weekly blocks with the few that say most, and Summarise each week turns each week into two to four points through Daybook's AI service, on a tap.
- v114 A leaner Notes for the team: the summary as short talking points (the detail one tap away on screen), answered questions filed as "Questions answered" documents instead of printed, no letters, and no heading left alone at the foot of a page.
- v113 Record the appointment: one recording for the whole appointment after everyone agrees, a tap on each question as its answer starts, then each answer playable from its own point, from Notes or from the question.
- v112 Send to the team: the notes PDF with its charts, a subject and a covering message, handed to your own Mail app for a contact with an email address.
- v111 Charts in the Notes for the team PDF: temperature, sleep, pain, weight and anything the summary flags are drawn in by Daybook, with a tick list to add or leave out the rest.
- v110 Who to contact: each contact has a name, role, phone and email, with Call and Email buttons (the first part of the appointment pack, asked for after a rushed first appointment).
- v109 A bowel movement can be several Bristol types at once (tick every type in a mix); the timeline, the Trends table and Notes for the team say so, and Notes names hard and loose in the same movement.
- v108 Shelley to be the company's director; the code assigned to the company and Shelley given the keys, so Daybook can carry on.
- v107 Mark decided to register Mark 1 Apps Ltd; the Paperwork list became the steps to do it.
- v106 The staged roadmap replaced by this plain action list: Build, UI, UX, Website, App stores, with the paperwork alongside.
- v105 The entry menu became a proper view (titled Vitals, Temperature and so on, one line per reading, coloured by level) with Edit for temperature and vitals readings, opening the Vitals sheet with only that reading's boxes filled in; a changed date moves the reading.
- v103 At home | In hospital switch at the top of the Meds tab, shared by both phones: at home the hospital medicines and the Given in hospital section stay out of the way; in hospital they show, Notes says "In hospital since", and medicine reminders can pause. Also a contrast fix on the amber temperature tile.
- v102 Hospital medicines are counted, not scheduled: a second or third bag the same day reads "2 given today" with each time listed, never "1 of 1, Done for today"; the Today doses tile leaves them out; Notes for the team says "(2 times)".
- v101 A medicine on the list can be ticked Given by the hospital (hospital monitored): a teal pill, how it is given, its doses marked as given in hospital, and no reminders for it. A photo of a drip bag arrives ticked.
- v100 Explain in Daybook and Read it from a photo fixed for real households: a name clash in the bridge ("Cannot access 'f2' before initialization") had stopped every real request before the AI was asked, since v75. The $5 credit was untouched.
- v99 Roadmap only: Siri and Apple Intelligence through a native iPhone app parked until Stage 5, with the plan and Mark's steps.
- v98 The bridge says why the AI service refused (no credit, key not accepted, busy) instead of "Could not reach Daybook's AI service", gives the day's count back on a failure, and uses claude-opus-5-5.
- v97 Given in hospital: a drip, an injection or anything the hospital gave, logged from the Medicine tile or the Meds tab with a Given in hospital pill, listed on the Meds tab and in Notes for the team, never counted against a listed medicine. With the bridge's AI key on, "Read it from a photo" fills it in from a photo of the bag, box or label, and Add medicine can be filled the same way.
- v96 Units simplified: everything metric, with one kg | st and lb switch on the Weight chart and beside the weight box (they share it), and a temperature typed in Fahrenheit caught and converted; the Units card went.
- v95 Tap the date on Today, Meds or Exercise to pick any day from a calendar (logged days tinted), and a Units setting per phone: weight in kg, stones and pounds or pounds, temperature in °C or °F, everything stored metric and Notes for the team kept in kg and °C for the clinic.
- v94 Weights typed in Vitals were being dropped silently (the database held two of a daily routine): every Vitals box now reads whatever is typed, comma or full stop, refuses to save anything it cannot read and says which box, lists what it saved, and has a Date box so a reading filled in later lands on its own day.
- v93 Sheets stay above the iPhone keyboard (the check-in text box was hidden behind it), and the Vitals boxes open empty with the last weight and temperature as a line underneath, since a grey last reading inside the box looked already filled in and daily weights went unsaved.
- v92 The Symptom tile (a between-times symptom with a 1 to 10 score, a Symptoms line in Notes) and the Medicine tile (log a dose from Today, when-needed first with their status), completing the three by three grid.
- v91 Bowels: a seventh quick-add tile, the Bristol chart sheet with the triage ticks and a "none today" record, the timeline, a Trends chart and table, and the Bowels line in Notes for the team with the UKONS and Macmillan thresholds.
- v90 Privacy, terms and About inside the app, in plain English, linked from Settings, the sign-in screens and the address.
- v89 The name settled: My Medical Daybook on the opener, the sign-in screens, the manifest, the README and the LICENSE; Daybook alone inside the app.
- v88 The opener rebuilt: Daybook as the glowing headline, the Mark 1 Apps film smaller and feathered, played on every start from one second in, the maker and copyright line at the foot.
- v87 The gap under Choose exercises, and the old picker log taken off the Exercise tab (it stays on the timeline) so the tile and the list agree.
- v86 The Exercise tab: Choose exercises above the Gentle exercises list (the chosen ones, no more My stretches), side cards matching the exercise cards with the Timer inside, and the 10:22 duplicate: cause found (a second tap on the old Done button, the guard did not hold), the stray document removed automatically, a five-second safety net on exercise entries and a double-tap guard on the rows.
- v85 The picker is a plain tick list: all 24 exercises under Upper, Lower and Full body headings, no drop-down, nothing moves when you tick; My stretches rows swipe left to Remove, with Undo.
- v84 Add to plan ticks in the picker build My stretches, a free-form box for an exercise not in the list, and reps and Timer pills in one aligned column.
- v83 Gentle exercises: a 24-exercise picker in three groups with body-area tags, an avoid filter kept on the phone, the always-shown warning box, Done logging with time and who, the streak removed, the check-in back to a wellness check with a signpost, and an optional 10:00 nudge from the bridge.
- v82 Check-in summary card on Today and in the timeline (one line, opens to every answer, who submitted and who edited), Edit on the review screen with Cancel and Save changes, no second document.
- v81 Morning stretches (optional, never counted against the streak, starter set behind a notice and ticked from the morning check-in) and a countdown timer on anything counted in seconds or minutes.
- v80 Question numbers agree everywhere and close up when one is deleted. v79 Chart or table on every Trends card.
- v79 Chart or table on every Trends card, remembered per card; the Treatment calendar spaced from the Sessions card and the measure chips in a proper grid (part of 6a).
- v78 Sign-up and invites: nobody needs the Firebase console or the Actions tab to join or start a household. Per-household keys and limits confirmed done (item 9).
- v77 the household helpers fixed (v76 loaded nothing after sign-in).
- v75 Separate households: one locked folder per household, enforced by the database rules and proved by the break-in tests; the bridge per household; migration and admin workflows; the rules published from git.
- v74 Private notifications: "A medicine is due" on the lock screen, the detail in the app.
- v73 Swimming and distances: the bridge converts metres, yards and feet (a pool swim no longer reads as kilometres), Lengths and Distance ways of counting with an optional time, and programme items that tick themselves from matching Apple Health workouts.
- v72 this roadmap.
- v69 Exercise programme: own exercises, physio plan, add from a photo, Apple Health workouts. v70 the plan from a PDF, Word or text file. v71 Manage medicines moved to the top of the Meds tab.
- v68 Licence and copyright notice. v67 demo wipe covers recordings, push subscriptions and reminders. v65 sign-in watercolour. v64 recorded answers with consent. v63 Treatment plan with session types. v62 opener film. v60 and v61 Explain in Daybook. v59 carer's view and the treatment cycle chart.
