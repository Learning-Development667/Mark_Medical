"""The Daybook action list: one source for ROADMAP.md's open actions and the live roadmap page.

Run from the repository root:  python3 tools/roadmap_page_gen.py
It rewrites the block between the action markers in ROADMAP.md and writes roadmap.html (not committed),
which is published to the live page (claude.ai/artifact/PCi6gEEHuHR9idt9fPbwks). Edit the lists below,
never the generated block by hand. Rebuilt 31 October 2026 (v365), when Mark found the list inaccurate and
asked for a paste-ready prompt on every step.
"""
import html, json, re, datetime

VERSION = '365'
UPDATED = '31 October 2026'
REPO = 'learning-development667/mark_medical'

# Each action: (id, title, who, note, prompt, state). who: 'Claude', 'Mark', 'Mark to decide', 'Testers', 'Both'.
# state: 'next' (do this soon), 'now' (under way or waiting on someone), 'open' (not started), 'later' (waits on another action).
CLAUDE_END = ' Follow CLAUDE.md (test in the harness, light and dark, 320 and 390 wide, bump the version, a CLAUDE.md note). When it is done, move it to Done in ROADMAP.md, run tools/roadmap_page_gen.py and republish the roadmap page.'
MARK_END = ' Talk me through it one step at a time, in plain words, and wait for me after each step. When it is done, tick it off in ROADMAP.md, run tools/roadmap_page_gen.py and republish the roadmap page.'
DECIDE_END = ' Do not build anything yet: give me your recommendation and a mock-up I can look at, then wait for my yes (the working rule in CLAUDE.md).'

def P(n, title, body, end):
    return f'Daybook ({REPO}), roadmap action {n}: {title}. {body}{end}'

GROUPS = []

claude = [
 ('Replies copied to a second address', 'Claude',
  'A setting under Notes for the team naming a second email (Shelley’s, say) that every report sent through Daybook is also copied to, so the household sees the replies.',
  'Add a setting under More > Settings > Notes for the team for a second email address that every report sent by Send to the team (any report) is copied to, beside the sender’s own copy. The bridge (handleSendReport) adds it to cc; it must be a member of the circle or an address saved under Who to contact, never any address. Mock the setting up for me first.', 'next'),
 ('Accessibility re-check', 'Claude',
  'axe-core on every screen and sheet in both colour schemes, the hand checks, and the date on the Settings App card renewed. Last full check: 28 September.',
  'Run axe-core over every screen, tab, report and sheet in light and dark at 390 and 320 wide, plus the hand checks in CLAUDE.md (focus order, every sheet a real dialog, 44px targets, nothing off the edge). Fix every violation, then renew the date on the App card and in About.', 'next'),
 ('The Guide: a PDF and three more topics', 'Claude',
  'Twelve walk-throughs are in the app. Left: Apple Health, letters and documents, and Exercise topics, and a PDF of the whole Guide to print or send.',
  'Add three Guide topics in tools/guide_shots.js (Apple Health and the Health Auto Export set-up; letters and documents with Explain with Daybook Assistant and Save to my files; the Exercise tab with gentle exercises and the timer), retake, copy guide/ to the website repository and bump guide.json?v= there. Then make a PDF of the whole Guide from the same frames and captions, one step a page, and offer it under More > Help and what\'s new.', 'open'),
 ('Recorded answers turned into text', 'Claude',
  'A recording of the team’s answer gains a written transcript within a minute, so it can be read and searched.',
  'Transcribe saved recordings (an answer or a whole appointment) on the bridge: try Cloudflare Workers AI speech-to-text on the free allowance first, the Anthropic credit only if that is not good enough. Show the transcript under the recording and in the Questions answered document. Size the cost per circle before building, and tell me the figure.', 'open'),
 ('Siri Shortcuts, as a stopgap', 'Claude',
  'Links that open Daybook with a sheet already filled in, and a Shortcut per job ("Log my temperature"). Free. The iPhone app will do this properly, so this is only worth it if that is weeks away.',
  'Add links that open Daybook with a sheet filled in (?add=temp&value=37.8, ?add=dose&med=..., ?add=question), then write the steps to make an Apple Shortcut for each ("Log my temperature", "Log a dose", "Question for the team") and add it to Siri. First tell me whether it is worth doing given the iPhone app is next.', 'open'),
 ('Security: what is left', 'Claude',
  'Parts 1 and 2 of the review are done (v291, v329 to v331). Left: pdf.js 4 now; the operator’s own key once the iPhone app reads Apple Health; the admin tool in a private repository once the GitHub organisation exists; a review before TestFlight.',
  'Move the letter reader from pdf.js 3.11 to pdf.js 4 in vendor/ (the CSP and the worker path), test a PDF letter, and list what else on the security checklist in ROADMAP.md can be done now and what must wait.', 'open'),
 ('Handover pack for the developer friends', 'Claude',
  'The pitch refreshed and a handover: how to run it on the demo, how the bridge fits, the deliberate choices. Mark sends it; Claude fixes what they find.',
  'Write a handover pack for two developer friends who will review Daybook: how to run it locally on the preview, how the app, Firebase, the bridge and GitHub fit together, the deliberate choices (no framework, network-first service worker, the cost rule, households) and what I want them to look at. Put it in the repository as HANDOVER.md and refresh the pitch.', 'open'),
 ('Keeping Daybook running', 'Claude',
  'A plain guide in the repository for Shelley or a future developer: what runs where, how a push deploys, what to do when something breaks, how to close it gently.',
  'Write KEEPING-DAYBOOK-RUNNING.md in the repository: every account Daybook depends on (GitHub, Firebase, Cloudflare, Resend, Anthropic, Apple, the domain) and which email owns it, how a push deploys the app and the bridge, the workflows on the Actions tab, what to check when something breaks, and how to close Daybook gently. No passwords or keys in it.', 'open'),
 ('The iPhone app, with Apple Health and Siri', 'Claude',
  'A thin iPhone app around the same web code: Apple Health read directly (no paid app needed), Siri actions such as "Log a dose". Waits on Mark’s Xcode and API key (Apple: the API key and Xcode, under Yours to do).',
  'Start the iPhone app: a thin native wrapper around the web app built in Xcode on my MacBook Air, reading Apple Health directly (steps, sleep, weight, workouts) instead of Health Auto Export, with Siri actions "Log a dose" and "Log my temperature". Plan it with me first: the project layout, what lives in the repository, and the first step I do in Xcode.', 'later'),
 ('The Android app, with Health Connect', 'Claude',
  'The same for Android, reading Health Connect directly (Google Fit is being retired). After the iPhone app.',
  'Plan the Android wrapper: the web app inside a native shell reading Health Connect directly, built from GitHub so I need no Android machine. Tell me what accounts and steps it needs, and whether a free Health Connect forwarding app could serve Android Beta testers sooner.', 'later'),
]
decide = [
 ('The other sliders against UK scales', 'Mark to decide',
  'Pain is on the NHS 0 to 10 scale. Proposed: a sickness count for the cancer pack (how many times sick today, as the triage line asks), and sleep, mood, appetite and energy on 0 to 10 like pain.',
  'Pain, symptoms and sickness already use the NHS 0 to 10 scale with its bands. The proposal (looked at 22 October 2026): with the Cancer pack, a sickness count (how many times sick today), as the UKONS triage line asks; and sleep, mood, appetite and energy moved from 1 to 10 onto 0 to 10 like pain, with no bands, since there is no UK standard slider for them. Tell me what changes on the screens and the reports, and what happens to scores already saved.', 'open'),
 ('Log a tracked thing at any time', 'Mark to decide',
  'Things I track are asked once, in the evening check-in. A reviewer suggested logging them during the day too, with the time (caffeine as it is drunk, say).',
  'A reviewer suggested Things I track could be logged at any time with a timestamp, not only in the evening check-in. Tell me how that would work on Today and on the reports, whether it should replace or sit beside the evening question, and mock it up.', 'open'),
 ('Choose which check-in questions apply', 'Mark to decide',
  'Someone with Something else gets questions that may not fit them. Proposed: a list in Settings to switch questions off, per circle.',
  'A reviewer suggested letting a circle choose which morning and evening check-in questions it is asked. Tell me which questions could be switched off safely (and which the reports depend on), where the setting would live, and mock it up.', 'open'),
 ('Your own usual ranges for readings', 'Mark to decide',
  'The app’s limits are the same for everyone. A person whose blood pressure or oxygen always sits outside them could set their own usual, as Crohn’s circles do for bowels.',
  'A reviewer suggested personal usual ranges for readings (blood pressure, oxygen, heart rate, temperature), as the Crohn’s pack has for bowels a day. Tell me how it would change the colours and Notes for the team, the clinical risk of letting someone widen a limit, and mock it up.', 'open'),
 ('Cancer wording under Something else', 'Mark to decide',
  'A few places still read as cancer-only for a Something else circle. A tidy-up pass to find and fix them.',
  'Go through the app as a Something else circle (no Cancer pack) and list every screen, hint, report line and email that still reads as if it were about cancer or chemo. Give me the list with your proposed wording for each.', 'open'),
 ('A weekly medicine schedule', 'Mark to decide',
  'Medicines taken on some days of the week only (a weekly methotrexate, say), counted only on those days.',
  'A reviewer suggested a weekly schedule for medicines taken on set days (methotrexate once a week, say). Tell me how it would sit in Edit medicine beside When do you take it and Only around treatment days, how it changes the Meds tab, the counts and the reminders, and mock it up.', 'open'),
 ('Which report next', 'Mark to decide',
  'Ideas: Treatment cycles (side effects by day after treatment), Readings for the GP, Activity and physio, a sleep report, a year in review.',
  'Help me choose the next report. For each idea (Treatment cycles, Readings for the GP, Activity and physio, a sleep report, a year in review) tell me who reads it, what is already logged for it, and how much work it is, then recommend one.', 'open'),
]
mark = [
 ('Apple: the API key and Xcode', 'Mark',
  'Apple accepted the enrolment on 27 October and the £79 is paid. Next: check it is active, make an App Store Connect API key, save it as a repository secret, install Xcode on the MacBook Air.',
  'Walk me through the next Apple steps: checking the Developer Programme membership for Mark 1 Apps Ltd is active, making an App Store Connect API key and saving it as a GitHub repository secret (never in the chat), and installing Xcode on my MacBook Air.', 'next'),
 ('Both phones on the new address', 'Mark',
  'Mark and Shelley remove the old Daybook icon, add it again from app.mymedicaldaybook.co.uk, sign in and switch reminders on. Also: add the new address to the demo project’s authorised domains in Firebase.',
  'Walk me through moving both phones to app.mymedicaldaybook.co.uk: removing the old icon, adding Daybook to the Home Screen again, signing in, switching reminders on and checking a test notification. Then adding the domain to the demo Firebase project’s authorised domains.', 'next'),
 ('The contact email on the privacy page', 'Mark',
  'The privacy page and terms name no email yet ("Contact: Mark 1 Apps Ltd."). Choose which address goes there (support@mymedicaldaybook.co.uk, say).',
  'Help me choose the contact address for the privacy page, terms and About, then set it (window.DAYBOOK_CONTACT in config.js) and check it shows on all three.', 'next'),
 ('Quick checks on the phone', 'Mark',
  'Three things built but never confirmed: a morning weigh-in arriving from Apple Health by itself; Scan a barcode on a few real UK products; a real physio plan through Add from a photo or PDF.',
  'Help me do three quick checks on my phone and tell you what I see: a weigh-in arriving from Apple Health, Scan a barcode on three real products, and a real physio plan through Add from a photo or PDF of the plan. Fix anything that misbehaves.', 'open'),
 ('The website, section by section', 'Mark',
  'Live at mymedicaldaybook.co.uk. Left: your sign-off of each section, and Charlene’s and Shelley’s words.',
  'Take me through the website (mymedicaldaybook-site) one section at a time so I can sign each off or ask for changes. Then help me add Charlene’s and Shelley’s words when I have them.', 'open'),
 ('The .com domains', 'Mark',
  'mymedicaldaybook.com and mark1apps.com are bought and in the same Cloudflare account. Forward mymedicaldaybook.com (and www., app.) to the .co.uk addresses with the rest of the address kept, so a typed .com or an old link never dead-ends; mark1apps.com the same way to mark1apps.co.uk once that has a page.',
  'Walk me through forwarding the .com domains in Cloudflare (free Redirect Rules, one domain at a time): mymedicaldaybook.com and www.mymedicaldaybook.com to https://mymedicaldaybook.co.uk, and app.mymedicaldaybook.com to https://app.mymedicaldaybook.co.uk, each keeping the path and the query (so ?beta= and ?invite= links still work), with a 301. Check first what DNS records each .com already has and leave any email records alone. Then say what to do with mark1apps.com while mark1apps.co.uk has no website. Afterwards test each address and tell me what it lands on.', 'next'),
 ('The wider Beta', 'Mark',
  'The Crohn’s friends are on it. Next: the email to nurses and the message to Sarah Cannon Research, from the Daybook Beta messages doc, and a Beta code for each route in.',
  'Help me send the next Beta invitations: check the Daybook Beta messages doc is still right for the app as it is now, make a Beta code for each route in (Household admin, beta-code), and tell me exactly what to send to whom.', 'open'),
 ('Read the Usage page each week', 'Mark',
  'More > Settings > Usage: circles, who logged this week, check-ins done, Assistant use. Ongoing; say what else should be counted.',
  'Open my Usage page figures with me and tell me what they say about how the Beta is going and what else is worth counting.', 'now'),
 ('Trade mark for My Medical Daybook', 'Mark',
  'An IPO search in classes 9, 42 and 44, then about £170 for one class. Best done before the stores.',
  'Walk me through a UK IPO trade mark search for "My Medical Daybook" in classes 9, 42 and 44, and the application for one class.', 'open'),
]
testers = [
 ('Crohn’s friends through to an appointment', 'Testers',
  'Two friends with Crohn’s log until their next appointment and take the Crohn’s and colitis report; an IBD nurse reads it. Their feedback comes back through Provide feedback.',
  'My Crohn’s testers have sent feedback (pasted below, or in the feedback collection). Go through it with me, say what each point means for the app, and propose fixes in order of impact.', 'now'),
 ('A fresh-eyes trial', 'Testers',
  'One or two people who have never seen Daybook set it up and log a day unaided, while you watch and note where they stall.',
  'Help me run a fresh-eyes trial: a short script for me to follow while someone new sets up Daybook and logs a day, what to watch for, and how to write down where they stall. Then fix what they found.', 'open'),
]
stores = [
 ('TestFlight, then both stores', 'Both',
  'Mark and Shelley first, then a small group, then submission (Health & Fitness, a journal and report tool, never monitoring). Google Play is a one-off $25. Then APP_STAGE is cleared so Beta goes. After the iPhone and Android apps.',
  'Plan the App Store and Google Play submission with me: the listing words (Health & Fitness, a journal and report tool for patients and carers to share with their team, never monitoring), the screenshots, the privacy answers (ICO ZC275185), the reviewer’s demo login, TestFlight groups, and the Google Play account.', 'later'),
]
paper = [
 ('Company email in its own mailboxes', 'Mark',
  'support@mymedicaldaybook.co.uk moved to an iCloud+ mailbox on 19 October; confirm with a test email. Then the same for mark@mark1apps.co.uk once its DNS is checked.',
  'Help me check the company email: send a test to support@mymedicaldaybook.co.uk and confirm it arrives in the iCloud+ mailbox, then check the DNS for mark1apps.co.uk (Cloudflare shows it as misconfigured) without touching the email records that work.', 'open'),
 ('Shelley can reach every account', 'Both',
  'Every account belongs to the company with two people able to get in: a GitHub organisation, Shelley as owner on Firebase, Cloudflare, Anthropic, Resend, Apple and Google Play; passwords in a shared vault.',
  'Walk me through giving Shelley owner access to every account Daybook runs on, in this order: a GitHub organisation (Mark 1 Apps) with both repositories moved in, Firebase and Google Cloud, Cloudflare, Anthropic Console, Resend, Apple Developer, then a shared password vault. One account at a time.', 'open'),
 ('Tax, bank and yearly filings', 'Mark',
  'Corporation Tax registration with HMRC within three months of starting to trade, a business bank account, the yearly confirmation statement and accounts.',
  'Explain in plain words what Mark 1 Apps Ltd must do with HMRC and Companies House and when (Corporation Tax registration, the confirmation statement, the accounts), and what I need for a business bank account. Make me a dated checklist.', 'open'),
 ('Your will for the shares', 'Mark',
  'What happens to your 26 shares. A solicitor, or the free will services through Macmillan and Marie Curie.',
  'Explain the options for a will covering my shares in Mark 1 Apps Ltd, including the free will services through Macmillan and Marie Curie, and what to ask a solicitor.', 'open'),
]

GROUPS = [
 ('claude', 'Claude to build', 'In the order to do them. Paste one into the chat to start it.', claude),
 ('decide', 'Waiting on your yes', 'Ideas Claude can build once you say so. Each prompt asks for a mock-up first.', decide),
 ('mark', 'Yours to do', 'Things only you can do. Each prompt asks Claude to walk you through it.', mark),
 ('testers', 'With the testers', None, testers),
 ('stores', 'The app stores', None, stores),
 ('paper', 'Paperwork', 'Mark 1 Apps Ltd, company number 17510025.', paper),
]

DONE_RECENT = [
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
WHO_CLS = {'Claude': 'w-claude', 'Mark': 'w-mark', 'Mark to decide': 'w-decide', 'Testers': 'w-test', 'Both': 'w-both'}
STATE_WORD = {'next': 'Next', 'now': 'Under way', 'later': 'Waits', 'open': ''}
def card(i):
    st = STATE_WORD[i['state']]
    pill = f'<span class="state s-{i["state"]}">{st}</span>' if st else ''
    return (f'<li class="act s-{i["state"]}" id="a{i["n"]}">'
            f'<div class="act-head"><span class="num">{i["n"]}</span><div class="act-title"><h3>{E(i["t"])}</h3>'
            f'<div class="tags"><span class="who {WHO_CLS[i["who"]]}">{E(i["who"])}</span>{pill}</div></div></div>'
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
next_html = ''.join(f'<li><a href="#a{i["n"]}">{i["n"]}. {E(i["t"])}</a> <span class="who {WHO_CLS[i["who"]]}">{E(i["who"])}</span></li>' for i in nexts)
summary = ''.join(f'<a class="chip" href="#{k}"><b>{counts[k]}</b> {E(t)}</a>' for k, t, *_ in GROUPS)
prompts = json.dumps({str(i['n']): i['prompt'] for i in items}, ensure_ascii=False).replace('</', '<\\/')

page = open('tools/roadmap_page_template.html').read()
for k, v in {'{{UPDATED}}': UPDATED, '{{VERSION}}': VERSION, '{{TOTAL}}': str(total), '{{SUMMARY}}': summary,
             '{{NEXT}}': next_html, '{{SECTIONS}}': sections + parked + done, '{{PROMPTS}}': prompts}.items():
    page = page.replace(k, v)
open('roadmap.html', 'w').write(page)
print(total, 'open actions;', len(page), 'bytes')
