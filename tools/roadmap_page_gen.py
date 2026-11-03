"""The Daybook action list: one source for ROADMAP.md's open actions and the live roadmap page.

Run from the repository root:  python3 tools/roadmap_page_gen.py
It rewrites the block between the action markers in ROADMAP.md and writes roadmap.html (not committed),
which is published to the live page (claude.ai/artifact/PCi6gEEHuHR9idt9fPbwks). Edit the lists below,
never the generated block by hand. Rebuilt 31 October 2026 (v365), when Mark found the list inaccurate and
asked for a paste-ready prompt on every step.
"""
import html, json, re, datetime

VERSION = '398'
UPDATED = '2 November 2026'
REPO = 'learning-development667/mark_medical'

# Each action: (id, title, who, note, prompt, state). who: 'Claude', 'Mark', 'Mark to decide', 'Testers', 'Both'.
# state: 'next' (do this soon), 'now' (under way or waiting on someone), 'open' (not started), 'later' (waits on another action).
CLAUDE_END = ' Follow CLAUDE.md (test in the harness, light and dark, 320 and 390 wide, bump the version, a CLAUDE.md note). When it is done, move it to Done in ROADMAP.md, run tools/roadmap_page_gen.py and republish the roadmap page.'
MARK_END = ' Talk me through it one step at a time, in plain words, and wait for me after each step. When it is done, tick it off in ROADMAP.md, run tools/roadmap_page_gen.py and republish the roadmap page.'
DECIDE_END = ' Do not build anything yet: give me your recommendation and a mock-up I can look at, then wait for my yes (the working rule in CLAUDE.md).'

def P(n, title, body, end):
    return f'Daybook ({REPO}), roadmap action {n}: {title}. {body}{end}'

GROUPS = []

store = [
 ('The iPhone app, with Apple Health and Siri', 'Claude', 'The first build reached TestFlight on 2 November; on 3 November Mark installed it through TestFlight (internal group Mark & Shelley) and signed in to his own Daybook. An external group, Circle Testers, was sent to Apple’s beta review the same evening (build 3; testers sign up with the App testers code). Next: Apple’s approval and the public link for friends, a few days of everyday use, then notifications and Apple Health.', 'Start the iPhone app: a thin native wrapper around the web app built in Xcode on my MacBook Air, reading Apple Health directly (steps, sleep, weight, workouts) instead of Health Auto Export, with Siri actions "Log a dose" and "Log my temperature". Plan it with me first: the project layout, what lives in the repository, and the first step I do in Xcode.', 'later'),
 ('The Android app, with Health Connect', 'Claude', 'The Google Play account and the app (uk.co.mark1apps.daybook) were made on 2 November; the Android project and its GitHub build on 3 November (v397). The secret was added and the first signed build made on 3 November (run 1; the upload key made and kept encrypted). Mark uploaded it to Internal testing the same evening (release 1 (1.0), available to internal testers). Next: the tester list, an Android phone to try it on, then Health Connect.', 'Plan the Android wrapper: the web app inside a native shell reading Health Connect directly, built from GitHub so I need no Android machine. Tell me what accounts and steps it needs, and whether a free Health Connect forwarding app could serve Android Beta testers sooner.', 'later'),
 ('Quick checks on the phone', 'Mark', 'Three things built but never confirmed: a morning weigh-in arriving from Apple Health by itself; Scan a barcode on a few real UK products; a real physio plan through Add from a photo or PDF.', 'Help me do three quick checks on my phone and tell you what I see: a weigh-in arriving from Apple Health, Scan a barcode on three real products, and a real physio plan through Add from a photo or PDF of the plan. Fix anything that misbehaves.', 'open'),
 ('Before testing: accessibility re-check', 'Claude', 'axe-core on every screen and sheet in both colour schemes, the hand checks, and the date on the Settings App card renewed. Last full check: 28 September.', 'Run axe-core over every screen, tab, report and sheet in light and dark at 390 and 320 wide, plus the hand checks in CLAUDE.md (focus order, every sheet a real dialog, 44px targets, nothing off the edge). Fix every violation, then renew the date on the App card and in About.', 'open'),
 ('Before testing: security', 'Claude', 'Parts 1 and 2 of the review are done (v291, v329 to v331). Left: pdf.js 4 now; the operator’s own key once the iPhone app reads Apple Health; the admin tool in a private repository once the GitHub organisation exists; a review before TestFlight.', 'Move the letter reader from pdf.js 3.11 to pdf.js 4 in vendor/ (the CSP and the worker path), test a PDF letter, and list what else on the security checklist in ROADMAP.md can be done now and what must wait.', 'open'),
 ('Testing, then both stores', 'Both', 'TestFlight on the iPhone and Google Play testing on Android: you and Shelley first, then a small group (a US tester’s a US university testers could come in here), then both stores together as Health & Fitness, a journal and report tool. Then the Beta label comes off.', 'Plan the App Store and Google Play submission with me: the listing words (Health & Fitness, a journal and report tool for patients and carers to share with their team, never monitoring), the screenshots, the privacy answers (ICO ZC275185), the reviewer’s demo login, TestFlight groups, and the Google Play account.', 'later'),
 ('Trade mark for My Medical Daybook', 'Mark', 'An IPO search in classes 9, 42 and 44, then about £170 for one class. Best before the stores if you can; it does not hold them up.', 'Walk me through a UK IPO trade mark search for "My Medical Daybook" in classes 9, 42 and 44, and the application for one class.', 'open'),
]

testers = [
 ('Crohn’s friends through to an appointment', 'Testers', 'Two friends with Crohn’s log until their next appointment and take the Crohn’s and colitis report; an IBD nurse reads it. Their feedback comes back through Provide feedback.', 'My Crohn’s testers have sent feedback (pasted below, or in the feedback collection). Go through it with me, say what each point means for the app, and propose fixes in order of impact.', 'now'),
 ('A US tester and his university', 'Mark', 'a US tester offered his HCI class, usability studies, a US university staff as testers, designers for the logo and a press release. Talk on Signal first. Testers can use the web app now with a Beta code, TestFlight later.', 'Help me prepare my call with a US tester about his offer (his email of 31 October): what to ask for first (testers, a usability study, the logo), what a US university would need from me (their own ethics approval for a study), and what to hold back until a solicitor has looked (a press release, US users at scale).', 'next'),
 ('A fresh-eyes trial', 'Testers', 'One or two people who have never seen Daybook set it up and log a day unaided, while you watch and note where they stall.', 'Help me run a fresh-eyes trial: a short script for me to follow while someone new sets up Daybook and logs a day, what to watch for, and how to write down where they stall. Then fix what they found.', 'open'),
]
after = [
 ('Replies copied to a second address', 'Claude', 'A setting under Notes for the team naming a second email (Shelley’s, say) that every report sent through Daybook is also copied to, so the household sees the replies.', 'Add a setting under More > Settings > Notes for the team for a second email address that every report sent by Send to the team (any report) is copied to, beside the sender’s own copy. The bridge (handleSendReport) adds it to cc; it must be a member of the circle or an address saved under Who to contact, never any address. Mock the setting up for me first.', 'open'),
 ('The Guide: a PDF and three more topics', 'Claude', 'Twelve walk-throughs are in the app. Left: Apple Health, letters and documents, and Exercise topics, and a PDF of the whole Guide to print or send.', "Add three Guide topics in tools/guide_shots.js (Apple Health and the Health Auto Export set-up; letters and documents with Explain with Daybook Assistant and Save to my files; the Exercise tab with gentle exercises and the timer), retake, copy guide/ to the website repository and bump guide.json?v= there. Then make a PDF of the whole Guide from the same frames and captions, one step a page, and offer it under More > Help and what's new.", 'open'),
 ('Recorded answers turned into text', 'Claude', 'A recording of the team’s answer gains a written transcript within a minute, so it can be read and searched.', 'Transcribe saved recordings (an answer or a whole appointment) on the bridge: try Cloudflare Workers AI speech-to-text on the free allowance first, the Anthropic credit only if that is not good enough. Show the transcript under the recording and in the Questions answered document. Size the cost per circle before building, and tell me the figure.', 'open'),
 ('Siri Shortcuts, as a stopgap', 'Claude', 'Links that open Daybook with a sheet already filled in, and a Shortcut per job ("Log my temperature"). Free. The iPhone app will do this properly, so this is only worth it if that is weeks away.', 'Add links that open Daybook with a sheet filled in (?add=temp&value=37.8, ?add=dose&med=..., ?add=question), then write the steps to make an Apple Shortcut for each ("Log my temperature", "Log a dose", "Question for the team") and add it to Siri. First tell me whether it is worth doing given the iPhone app is next.', 'open'),
 ('Handover pack for the developer friends', 'Claude', 'The pitch refreshed and a handover: how to run it on the demo, how the bridge fits, the deliberate choices. Mark sends it; Claude fixes what they find.', 'Write a handover pack for two developer friends who will review Daybook: how to run it locally on the preview, how the app, Firebase, the bridge and GitHub fit together, the deliberate choices (no framework, network-first service worker, the cost rule, households) and what I want them to look at. Put it in the repository as HANDOVER.md and refresh the pitch.', 'open'),
 ('Keeping Daybook running', 'Claude', 'A plain guide in the repository for Shelley or a future developer: what runs where, how a push deploys, what to do when something breaks, how to close it gently.', 'Write KEEPING-DAYBOOK-RUNNING.md in the repository: every account Daybook depends on (GitHub, Firebase, Cloudflare, Resend, Anthropic, Apple, the domain) and which email owns it, how a push deploys the app and the bridge, the workflows on the Actions tab, what to check when something breaks, and how to close Daybook gently. No passwords or keys in it.', 'open'),
 ('US settings in the background', 'Claude', 'For a US tester’s American testers: °F, pounds and fluid ounces as settings, typed US foods from USDA FoodData Central, US date order. No legal change; US barcodes are already done (v388).', 'Add US units as personal settings (temperature in °F, weight in pounds, drinks in fluid ounces), typed US foods from USDA FoodData Central beside the UK food table, and a US date order and 12-hour clock setting. Nothing changes for anyone who does not choose them. Mock the settings up for me first.', 'open'),
]
ideas = [
 ('A solicitor’s review, when there is money', 'Mark to decide', 'Not required by law or by the stores. When the company can afford it: a data protection solicitor reads the privacy page, the terms and the DPIA for a fixed fee (roughly £800 to £2,000).', 'Help me find a fixed-fee data protection review of a health app’s privacy notice, terms and DPIA under UK GDPR, and what to send them.', 'open'),
 ('The other sliders against UK scales', 'Mark to decide', 'Pain is on the NHS 0 to 10 scale. Proposed: a sickness count for the cancer pack (how many times sick today, as the triage line asks), and sleep, mood, appetite and energy on 0 to 10 like pain. Touches: Would change scores already saved.', 'Pain, symptoms and sickness already use the NHS 0 to 10 scale with its bands. The proposal (looked at 22 October 2026): with the Cancer pack, a sickness count (how many times sick today), as the UKONS triage line asks; and sleep, mood, appetite and energy moved from 1 to 10 onto 0 to 10 like pain, with no bands, since there is no UK standard slider for them. Tell me what changes on the screens and the reports, and what happens to scores already saved.', 'open'),
 ('Log a tracked thing at any time', 'Mark to decide', 'Things I track are asked once, in the evening check-in. A reviewer suggested logging them during the day too, with the time (caffeine as it is drunk, say). Touches: Changes Today and the reports.', 'A reviewer suggested Things I track could be logged at any time with a timestamp, not only in the evening check-in. Tell me how that would work on Today and on the reports, whether it should replace or sit beside the evening question, and mock it up.', 'open'),
 ('Choose which check-in questions apply', 'Mark to decide', 'Someone with Something else gets questions that may not fit them. Proposed: a list in Settings to switch questions off, per circle. Touches: The reports rely on some questions.', 'A reviewer suggested letting a circle choose which morning and evening check-in questions it is asked. Tell me which questions could be switched off safely (and which the reports depend on), where the setting would live, and mock it up.', 'open'),
 ('Your own usual ranges for readings', 'Mark to decide', 'The app’s limits are the same for everyone. A person whose blood pressure or oxygen always sits outside them could set their own usual, as Crohn’s circles do for bowels. Touches: Clinical risk if a limit is widened.', 'A reviewer suggested personal usual ranges for readings (blood pressure, oxygen, heart rate, temperature), as the Crohn’s pack has for bowels a day. Tell me how it would change the colours and Notes for the team, the clinical risk of letting someone widen a limit, and mock it up.', 'open'),
 ('Food apps like MyNetDiary, named on the website', 'Mark to decide', 'a US tester’s feedback: he uses MyNetDiary. Daybook already takes food totals from any app that writes to Apple Health; one line on the website and in Support could say so. Touches: Words on the website only.', 'a US tester uses MyNetDiary for food. Daybook already takes the day’s food totals from Apple Health (MyNetDiary, MyFitnessPal and Nutracheck all write to it). Draft one line for the website and the Support page saying so, and check it is true as the app stands.', 'open'),
 ('Which report next', 'Mark to decide', 'Ideas: Treatment cycles (side effects by day after treatment), Readings for the GP, Activity and physio, a sleep report, a year in review. Touches: A recommendation only.', 'Help me choose the next report. For each idea (Treatment cycles, Readings for the GP, Activity and physio, a sleep report, a year in review) tell me who reads it, what is already logged for it, and how much work it is, then recommend one.', 'open'),
]
mark = [
 ('Both phones on the new address', 'Mark', 'Mark and Shelley remove the old Daybook icon, add it again from app.mymedicaldaybook.co.uk, sign in and switch reminders on. Also: add the new address to the demo project’s authorised domains in Firebase.', 'Walk me through moving both phones to app.mymedicaldaybook.co.uk: removing the old icon, adding Daybook to the Home Screen again, signing in, switching reminders on and checking a test notification. Then adding the domain to the demo Firebase project’s authorised domains.', 'open'),
 ('The website, section by section', 'Mark', 'Live at mymedicaldaybook.co.uk (the .com forwards there since 31 October). Left: your sign-off of each section, Charlene’s and Shelley’s words.', 'Take me through the website (mymedicaldaybook-site) one section at a time so I can sign each off or ask for changes. Then help me add Charlene’s and Shelley’s words when I have them.', 'open'),
 ('Real photographs for the website', 'Mark', 'a US tester’s feedback: the pictures have an AI look. Real photographs for the seven steps of the story and the stills, chosen by you.', 'a US tester said the website’s pictures look AI-made. Help me plan real photographs for the seven steps of the story and the other stills: a shot list in plain words, what to take on my phone, and how to send them to you; then put them on the website in place of the Firefly ones.', 'open'),
 ('A clinical adviser', 'Mark', 'a US tester’s feedback: a doctor or nurse from a teaching hospital as an adviser, named on the website once they agree. a US tester offered to help find one.', 'a US tester suggested a clinical adviser (a doctor or nurse, ideally from a teaching hospital) named on the website. Help me write a short, plain approach to send them: what Daybook is, that it is a journal and report tool and not a medical device, what I would ask of them (a review of the wording and the reports, a few hours a year), and what they get in return.', 'open'),
 ('Charity partners', 'Mark', 'a US tester’s feedback: partner with a charity. Pancreatic Cancer UK and Crohn’s & Colitis UK match the story best; Macmillan and Cancer Research UK are bigger and slower.', 'a US tester suggested partnering with a charity. Help me approach Pancreatic Cancer UK and Crohn’s & Colitis UK first: who to write to, what to ask for (a look at the app, a mention to nurses, a trial), and a short email in my own voice.', 'open'),
 ('A second person in the business', 'Mark', 'a US tester’s feedback: bring in a second person, beside Shelley, to help run Mark 1 Apps. Your call on whether and who.', 'a US tester suggested a second person to help run Mark 1 Apps Ltd. Help me think it through: what I would need from them (development, clinical, business), how it could be set up (adviser, employee, shareholder) and what to watch for, with no decision made for me.', 'open'),
 ('The wider Beta', 'Mark', 'The Crohn’s friends are on it. Next: the email to nurses and the message to Sarah Cannon Research, from the Daybook Beta messages doc, and a Beta code for each route in.', 'Help me send the next Beta invitations: check the Daybook Beta messages doc is still right for the app as it is now, make a Beta code for each route in (Household admin, beta-code), and tell me exactly what to send to whom.', 'open'),
 ('Read the Usage page each week', 'Mark', 'More > Settings > Usage: circles, who logged this week, check-ins done, Assistant use. Ongoing; say what else should be counted.', 'Open my Usage page figures with me and tell me what they say about how the Beta is going and what else is worth counting.', 'now'),
]
paper = [
 ('Company email in its own mailboxes', 'Mark', 'support@mymedicaldaybook.co.uk moved to an iCloud+ mailbox on 19 October; confirm with a test email. Then the same for mark@mark1apps.co.uk once its DNS is checked.', 'Help me check the company email: send a test to support@mymedicaldaybook.co.uk and confirm it arrives in the iCloud+ mailbox, then check the DNS for mark1apps.co.uk (Cloudflare shows it as misconfigured) without touching the email records that work.', 'open'),
('A guide for Shelley, and her access to every account', 'Both', 'Started 3 November: Shelley has her own Workspace address, shelley@mark1apps.co.uk. Still to do in Workspace: make her Super Admin, share mark@mark1apps.co.uk with her (Mail delegation), and 2-Step Verification on both sign-ins; then Google Play access. Then a plain user guide for Shelley to running Mark 1 Apps and Daybook, account by account (Apple, Google Play, GitHub, Firebase, Cloudflare, email, bank and Companies House), kept private, never in the public repository; passwords in a shared password group, never in the guide; Shelley made Admin or owner on each.', 'Make a plain user guide for Shelley, who is not technical, to running Mark 1 Apps Ltd and Daybook: for each account (Apple Developer and App Store Connect, Google Play, GitHub, Firebase, Cloudflare, Resend, Anthropic, the email, the bank, HMRC and Companies House) what it is for, how she signs in, the few things she might need to do and who to ask. Keep it private, not in the public repository, with no passwords in it: set up a shared password group with her in the Passwords app instead. Then give her Admin or owner access on each account, one at a time. Keep the tone that of an ordinary user guide.', 'next'),
 ('Tax, bank and yearly filings', 'Mark', 'Corporation Tax registration with HMRC within three months of starting to trade, a business bank account, the yearly confirmation statement and accounts.', 'Explain in plain words what Mark 1 Apps Ltd must do with HMRC and Companies House and when (Corporation Tax registration, the confirmation statement, the accounts), and what I need for a business bank account. Make me a dated checklist.', 'open'),
 ('Sign the DPIA and close its five actions', 'Both', 'The Data Protection Impact Assessment was drafted on 3 November (Claude Docs, “My Medical Daybook: Data Protection Impact Assessment”). Read it, correct it, close its five actions (two-step sign-in on company accounts, a breach plan, backups, supplier terms) and sign it. Charities and the NHS will ask for it.', 'Help me finish the Daybook DPIA in Claude Docs (https://claude.ai/artifact/Px741DrFQqxkWtHCgJyoLn): go through its five actions with me one at a time, in plain words, and wait for me after each.', 'open'),
 ('The ICO’s answer to our three questions', 'Mark', 'Sent on 3 November through the ICO’s small business form (topic: special category data), in place of a solicitor for now. They may ring or reply by email with a case reference. When it comes, Claude adds the answers to the DPIA. The questions: 1. Is contract plus explicit consent the right basis for a health diary people choose to use? 2. What should we record when a carer sets up Daybook for someone who cannot decide for themselves? 3. What safeguard covers text sent to Anthropic in the US when someone taps an AI button? Note the answers in the DPIA.', 'Help me prepare for a call to the ICO helpline (0303 123 1113) about Daybook: the three questions on the action list, what to have in front of me, and how to note the answers in the DPIA. Plain words, one step at a time, wait for me after each.', 'open'),
 ('Your will for the shares', 'Mark', 'What happens to your 26 shares. A solicitor, or the free will services through Macmillan and Marie Curie.', 'Explain the options for a will covering my shares in Mark 1 Apps Ltd, including the free will services through Macmillan and Marie Curie, and what to ask a solicitor.', 'open'),
]

GROUPS = [
 ('store', 'To the App Store and Google Play', 'Both stores matter equally. The path, in order; only this group matters for now.', store),
 ('testers', 'With the testers', None, testers),
 ('after', 'After the App Store: Claude to build', 'Not until the app is in the store, unless you say otherwise.', after),
 ('ideas', 'After the App Store: ideas', 'Saying yes to one of these gets you a recommendation and a mock-up, never a change. Each says what it would touch.', ideas),
 ('mark', 'Yours, when you have time', 'None of these hold the store up.', mark),
 ('paper', 'Paperwork', 'Mark 1 Apps Ltd, company number 17510025.', paper),
]

DONE_RECENT = [
 ('Apple: API key, app ID and app record, the first iPhone build on TestFlight; Google Play: the account verified and the app created', '2 Nov'),
 ('US barcodes from USDA FoodData Central; NHS medicine names (dm+d) in Add medicine; supermarket fruit labels understood by the scanner', 'v388 to v392, 2 Nov'),
 ('The Fable review of 1 to 2 November: all 28 items and the wording list, including the cancer wording under Something else', 'v376 to v387, 2 Nov'),
 ('Meet the team page with About us and photos; "Why the data is held" on the privacy page', 'v372, 1 Nov'),
 ('The ICO number and support email in the website’s footer', '1 Nov'),
 ('A third demo, Robin with chronic pain; the .com addresses forward to the .co.uk', 'v371, 1 Nov'),
 ('a US tester’s feedback: Shelley named on the website, a line to the app, privacy and terms copied fresh', '31 Oct'),
 ('Feedback on the Usage page; mood words off Notes for the team unless chosen; course dates cleared', 'v368 to v370'),
 ('Things I track and symptoms as charts on Trends', 'v365'),
 ('Something else: the reviewers’ fixes (blood pressure sittings, weight rises, triptans as pain relief)', 'v363, v364'),
 ('Something else for any condition; Things I track; your own Today tiles; pain and daily life', 'v359 to v361'),
 ('The look tidied: gold rim buttons, cream cards, the coloured tab bar, Reports | Trends', 'v338 to v356'),
 ('Medicines around treatment days; the evening check-in to 05:59', 'v357, v358'),
 ('Security review parts 1 and 2: libraries kept in the app, a security policy, the check-in lock in the database', 'v291 to v331'),
 ('Export and delete: download every record, delete a circle or leave it', 'v295'),
 ('Reports from a confirmed email only, and Daybook’s own confirm email', 'v292 to v296'),
 ('Food: label photos, unknown barcodes, drinks with food in them, the day by meal', 'v285 to v328'),
 ('Naps, a mood tile, missing information in red, the tiles on Today open their lists', 'v280 to v305'),
 ('The households move finished (the old layout taken out of the rules)', 'v291'),
 ('Firebase on pay-as-you-go; reports emailed by Daybook itself through Resend', 'v159, Oct'),
 ('Crohn’s and colitis: all five builds and the preview', 'v204 to v221'),
 ('The icon, the website, the new address app.mymedicaldaybook.co.uk', 'v224 to v231'),
 ('The set-up, the Guide, the Pain and Mood reports, Your week for carers', 'v155 to v242'),
 ('Everything from check-ins to Apple Health, the reports and the care circle', 'v4 to v200'),
]
PARKED = [
 ('Menopause, then more conditions after the stores', 'Menopause, long-term pain, heart failure, COPD, diabetes, migraine, dementia, recovery after surgery, each on the pack mechanism. Something else covers many of them meanwhile.'),
 ('A first sign-in tour', 'A short tour of the real screens on first sign-in. Parked by Mark on 20 October.'),
 ('Share label figures with Open Food Facts', 'Opt-in, after the App Store, agreed with Open Food Facts first.'),
 ('IBD-Control and the IBD Fatigue scale', 'Need written permission (Professor Bodger; King’s College London). Claude drafts the letters when asked.'),
 ('An "AI used this month" line in Settings', 'From the bridge’s own tally. If wanted.'),
 ('The Oxford comma (a US tester)', 'Not taken: Daybook follows UK style, so no comma before the last "and".'),
 ('A full US version', 'US law, a solicitor and a US listing. Parked by Mark on 2 November; the US settings in the background are an action.'),
 ('Mark 1 Apps website and storefront', 'A page of the apps Mark has built. Not started.'),
]

# ---------------------------------------------------------------- numbering and output
items = []
n = 0
for key, title, sub, rows in GROUPS:
    for (t, who, note, body, state) in rows:
        n += 1
        end = CLAUDE_END if who == 'Claude' else DECIDE_END if who == 'Mark to decide' else MARK_END if who in ('Mark', 'Both') else ''
        items.append({'n': n, 'g': key, 't': t, 'who': who, 'note': note, 'state': state, 'prompt': P(n, t, body, end)})

counts = {k: sum(1 for i in items if i['g'] == k) for k, *_ in GROUPS}
total = len(items)

# ROADMAP.md block
md = [f'_Generated by `tools/roadmap_page_gen.py` on {UPDATED} (v{VERSION}). Edit the lists there, then run it; do not edit this block by hand._', '']
md.append(f'**{total} open actions:** ' + '; '.join(f'{t} {counts[k]}' for k, t, *_ in GROUPS) + '.')
md.append('')
for key, title, sub, rows in GROUPS:
    md.append(f'### {title}')
    if sub: md.append(sub)
    md.append('')
    for i in items:
        if i['g'] != key: continue
        flag = {'next': ' (next)', 'now': ' (under way)', 'later': ' (waits on another action)', 'open': ''}[i['state']]
        md.append(f"{i['n']}. **{i['t']}** ({i['who']}){flag}. {i['note']}")
        md.append(f"   > Paste: {i['prompt']}")
    md.append('')
md.append('### Parked, on purpose')
for t, d in PARKED: md.append(f'- **{t}.** {d}')
md.append('')
block = '\n'.join(md)
road = open('ROADMAP.md').read()
road = re.sub(r'<!-- actions:start -->.*?<!-- actions:end -->', lambda m: '<!-- actions:start -->\n' + block + '\n<!-- actions:end -->', road, flags=re.S)
open('ROADMAP.md', 'w').write(road)

# The page
E = html.escape
WHO_LABEL = {'Mark to decide': 'Shown to you first'}
WHO_CLS = {'Claude': 'w-claude', 'Mark': 'w-mark', 'Mark to decide': 'w-decide', 'Testers': 'w-test', 'Both': 'w-both'}
STATE_WORD = {'next': 'Next', 'now': 'Under way', 'later': 'Waits', 'open': ''}
def card(i):
    st = STATE_WORD[i['state']]
    pill = f'<span class="state s-{i["state"]}">{st}</span>' if st else ''
    return (f'<li class="act s-{i["state"]}" id="a{i["n"]}">'
            f'<div class="act-head"><span class="num">{i["n"]}</span><div class="act-title"><h3>{E(i["t"])}</h3>'
            f'<div class="tags"><span class="who {WHO_CLS[i["who"]]}">{E(WHO_LABEL.get(i["who"], i["who"]))}</span>{pill}</div></div></div>'
            f'<p class="note">{E(i["note"])}</p>'
            f'<div class="act-foot"><button type="button" class="copy" data-n="{i["n"]}" aria-describedby="p{i["n"]}">Copy for Claude</button>'
            f'<details><summary>Show the words</summary><p class="prompt" id="p{i["n"]}">{E(i["prompt"])}</p></details></div></li>')
sections = ''
for key, title, sub, rows in GROUPS:
    sections += (f'<section class="group" id="{key}"><div class="g-head"><h2>{E(title)}</h2><span class="count">{counts[key]}</span></div>'
                 + (f'<p class="sub">{E(sub)}</p>' if sub else '') + '<ol class="acts">'
                 + ''.join(card(i) for i in items if i['g'] == key) + '</ol></section>')
parked = '<section class="group" id="parked"><div class="g-head"><h2>Parked, on purpose</h2></div><ul class="plain">' + ''.join(
    f'<li><b>{E(t)}.</b> {E(d)}</li>' for t, d in PARKED) + '</ul></section>'
done = '<section class="group" id="done"><details class="donebox"><summary><h2>Already built</h2><span class="count">v4 to v' + VERSION + '</span></summary><ul class="plain done">' + ''.join(
    f'<li>{E(t)} <small>{E(v)}</small></li>' for t, v in DONE_RECENT) + '</ul></details></section>'
nexts = [i for i in items if i['state'] == 'next']
next_html = ''.join(f'<li><a href="#a{i["n"]}">{i["n"]}. {E(i["t"])}</a> <span class="who {WHO_CLS[i["who"]]}">{E(WHO_LABEL.get(i["who"], i["who"]))}</span></li>' for i in nexts)
summary = ''.join(f'<a class="chip" href="#{k}"><b>{counts[k]}</b> {E(t)}</a>' for k, t, *_ in GROUPS)
prompts = json.dumps({str(i['n']): i['prompt'] for i in items}, ensure_ascii=False).replace('</', '<\\/')

page = open('tools/roadmap_page_template.html').read()
for k, v in {'{{UPDATED}}': UPDATED, '{{VERSION}}': VERSION, '{{TOTAL}}': str(total), '{{SUMMARY}}': summary,
             '{{NEXT}}': next_html, '{{SECTIONS}}': sections + parked + done, '{{PROMPTS}}': prompts}.items():
    page = page.replace(k, v)
open('roadmap.html', 'w').write(page)
print(total, 'open actions;', len(page), 'bytes')
