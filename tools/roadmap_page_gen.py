import html
E = html.escape
CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'

def row(text, who=None, note=None, state='open', num=None):
    cls = {'done': 'done', 'now': 'now', 'open': ''}[state]
    box = f'<span class="box">{CHECK}</span>' if state == 'done' else '<span class="box" aria-hidden="true"></span>'
    head = (f'{E(num)}. ' if num else '') + E(text)
    w = f' <span class="who">{E(who)}</span>' if who else ''
    n = f'<small>{E(note)}</small>' if note else ''
    st = {'done': '<span class="sr">Done. </span>', 'now': '<span class="sr">In progress. </span>', 'open': '<span class="sr">Not started. </span>'}[state]
    return f'<li class="{cls}">{box}<span class="t">{st}{head}{w}{n}</span></li>'

def section(title, count, sub, rows, cls=''):
    s = f'<section class="{cls}"><div class="stage-head"><h2>{E(title)}</h2><span class="count">{E(count)}</span></div>'
    if sub: s += f'<p class="sub">{E(sub)}</p>'
    return s + '<ul>' + ''.join(rows) + '</ul></section>'

built = [
 ('Sleep asked simply for anyone without a watch: bed and wake times, rested, broken and why; a set-up question on health apps', 'v260'),
 ("The Food sheet saves simply and never loses a food silently, after a tester's missing lunch", 'v259'),
 ("Fasting today? in the Crohn's morning check-in; the Meds tab's two buttons as tiles", 'v257, v258'),
 ("What's new by condition; when a medicine is taken; courses that start later", 'v253 to v256'),
 ('A new circle starts with no medicines; water with a medicine counts as a drink; Remove a medicine; Gel in pumps', 'v247 to v252'),
 ('Send to the team works for longer reports, within the free plan', 'v246'),
 ('Join the Beta from the website: choose Cancer treatment or Crohn\'s or colitis there, and the set-up does not ask again', 'v245'),
 ('Symptoms on the 0 to 10 scale too, and flagged on Notes for the team from 4', 'v244'),
 ('Pain flagged from 4, as the NHS scale says; sickness on 0 to 10 with the same bands', 'v243'),
 ('The Guide brought up to date: twelve walk-throughs, three of them new, and kept so', 'v242'),
 ('Pain on the NHS 0 to 10 scale: no pain, mild, moderate, severe shown as you slide', 'v241'),
 ("The calendar's day sheet shows how the days after a session went: side effects rated, your words, anything logged", 'v240'),
 ('Preview zooms the report alone: pinch, double tap, or + and - on the pages', 'v239'),
 ('Optional check of the words Tap to speak heard, before saving', 'v238'),
 ("The carer's mood and observations at the patient's two times, in their own area on the reports", 'v237'),
 ('Nothing on a report is cut short; what does not fit moves to another page', 'v236'),
 ("Mark's own words and the best day's words whole on the Mood report; no Skip on the opener; the questions row opens a list", 'v232 to v235'),
 ('The website rebuilt in the app’s look, at mymedicaldaybook.co.uk; the app moved to app.mymedicaldaybook.co.uk', 'v230, v231'),
 ('A watercolour behind the app; the week ends on a day you choose; Leave demo button; one Demo button with a choice', 'v226 to v229'),
 ('The icon: two books and a sunrise, in every size', 'v224'),
 ('The opener rebuilt as a watercolour clip with the title in real text', 'v222'),
 ("Crohn's and colitis, all five builds: injections, infusions and steroid courses; the flare plan and I think I'm flaring; results as given; the two-page report; tuned check-ins and set-up", 'v204 to v221'),
 ("Jo's Crohn's preview and a Demo choice for the cancer or Crohn's example", 'v206, v226'),
 ('The operator’s Usage page (counts only); the bridge reads one document a run; the Assistant’s monthly allowance', 'v209 to v212'),
 ('Your care circle: the patient’s circle, who runs it, handing it over; asked-once dose and how many each time', 'v191 to v200'),
 ('Treatment cycles as the team counts them, side effects asked in the check-ins, packaged foods and barcode scan', 'v172 to v201'),
 ('Tap to speak made reliable; half-typed readings and unfinished check-ins kept', 'v160 to v203'),
 ('Pain and pain relief report; Mood and wellbeing report; the set-up; the Guide; Your week for carers', 'v155 to v167'),
 ('Send to the team sent by Daybook itself, with Beta codes and the feedback sheet', 'v152 to v159'),
 ('Medicine history in the new house style; Mark 1 Apps Ltd named; copyright moved to the company', 'v141 to v151'),
 ('Condition packs, bowels, Notes for the team in two pages, the Food diary in two pages', 'v91 to v145'),
 ('The rebrand into the report look; given in hospital; weights that always save; reminders; households and sign-up', 'v75 to v122'),
 ('Check-ins, vitals, pain, food, drinks, sleep, notes, medicines, letters explained, the treatment plan, exercise, Apple Health', 'v4 to v74'),
]
built_html = '<section class="built"><div class="stage-head"><h2>Already built</h2><span class="count">v4 to v260</span></div><ul>' + ''.join(
    f'<li class="done"><span class="box">{CHECK}</span><span class="t">{E(t)}<small>{E(v)}</small></span></li>' for t, v in built) + '</ul></section>'

s1 = [
 row('Siri Shortcuts', 'Claude', '"Hey Siri, log my temperature" opens Daybook with the box filled in. Free, no developer account.', 'open', '1'),
 row('Try a real physio sheet', 'Mark', 'A photo or emailed PDF; Claude tunes the reader from what it missed.', 'now', '2'),
 row('Weight from Apple Health', 'Mark', "Built in v126, with BMI. Done when a morning weigh-in shows on Today by itself.", 'now', '3'),
 row('Recordings turned into text', 'Claude', None, 'open', '4'),
 row('Finish the households move', 'Mark', 'Verify and cleanup on the Actions tab, then Claude trims the rules.', 'open', '5'),
 row('Move to app.mymedicaldaybook.co.uk', 'Mark', 'Built and live (v231). Left: Mark and Shelley add Daybook to the Home Screen again and switch reminders on; the demo project’s authorised domain.', 'now', '6'),
 row('Security tightening', 'Claude', 'Libraries hosted at fixed versions, a content security policy, the check-in author lock in the rules.', 'open', '7'),
 row('Export and delete', 'Claude', 'Built in v295: More, Settings, Your records. Download every record as a zip; the patient deletes the whole circle, anyone else leaves and deletes their own sign-in, after typing DELETE.', 'done', '8'),
 row("Condition packs: Crohn's and colitis, then menopause", 'Claude, with testers', "All five Crohn's builds are done (v204 to v221). Next: two friends with Crohn's log through to an appointment and take the report; an IBD nurse reads it. Then menopause.", 'now', '9'),
 row('Firebase to pay-as-you-go', 'Mark', "Upgrade to Blaze with a budget alert at £10, before the testers' links go out. The free plan stops answering past its daily allowance.", 'now', '9b'),
 row('Read the Usage page weekly', 'Mark', 'More > Usage. Built in v211; say what else should be counted.', 'now', '9c'),
 row('Switch on the emailed reports', 'Mark', 'Done 13 October: Resend, domain verified, key deployed, test email arrived with the PDF.', 'done', '10'),
 row('The other sliders against UK scales', 'Mark to decide', 'A sickness count (how many times sick today) for the cancer pack, as the UKONS triage line asks; sleep, mood, appetite and energy on 0 to 10 like pain.', 'open', '9e'),
 row('Replies also copied to a household address', 'Claude', 'A second address every emailed report is copied to; later the correspondence kept inside Daybook.', 'open', '10a'),
]
s2 = [row('The icon', 'Mark', 'Done in v224. Remove Daybook from the Home Screen and add it again to see it.', 'done', '10')]
s3 = [
 row('The set-up', 'Claude', 'Done in v164: what Daybook is for, your name, a contact, the Home Screen, Tap to speak.', 'done', '11'),
 row('Fresh-eyes trial', 'Mark', 'One or two people who have never seen it set up and log a day unaided; Claude fixes where they stall.', 'open', '11a'),
 row('Accessibility re-check', 'Claude', 'Every screen and sheet in both colour schemes, and the date on the App card renewed.', 'open', '12'),
 row('User guide', 'Claude', 'Up to date in v242: twelve walk-throughs, with a rule that a changed screen means a retaken guide. Left: a PDF, and Apple Health, letters and Exercise topics.', 'now', '13'),
 row('Developer friends review it', 'Both', 'Claude writes the handover, Mark sends it, Claude fixes what they find.', 'open', '14'),
]
s4 = [
 row('mymedicaldaybook.co.uk', 'Both', 'Live and rebuilt in the app’s look (v3, 18 October), with search set up on 19 October. Left: Mark’s section-by-section review, Charlene’s and Shelley’s words, store badges when listed.', 'now', '15'),
 row('The Beta', 'Both', 'Codes and the feedback sheet are built. FRIENDS is made for the two Crohn’s friends. Next: the three messages (nurse email, Sarah Cannon Research, WhatsApp) and the first invites.', 'now', '15a'),
]
s5 = [
 row('Apple Developer Programme', 'Mark', 'Enrolment submitted on 23 October as Mark 1 Apps Ltd, from the company Apple Account (mark@mark1apps.co.uk). Waiting on Apple to check you can sign for the company, by email or phone; then £79 a year.', 'now', '16'),
 row('iPhone and Android apps, with Siri', 'Claude', 'Apple Health and Health Connect read directly, so nobody needs a paid app to connect; "Hey Siri, log a dose". Google Fit is being retired, so Android goes through Health Connect.', 'open', '17'),
 row('TestFlight, then both stores', 'Both', 'Mark and Shelley first, then a small group. Listed under Health & Fitness, as a journal and report tool. Then clear APP_STAGE so the Beta label goes.', 'open', '18'),
 row('Trade mark for My Medical Daybook', 'Mark', 'An IPO search in classes 9, 42 and 44, then about £170 for one class.', 'open', '19'),
]
pw = [
 row('Check the name on Companies House', 'Mark', 'Done', 'done'),
 row('Shelley verifies her identity with GOV.UK One Login', 'Shelley', 'Done', 'done'),
 row('Register Mark 1 Apps Ltd', 'Mark', 'Company number 17510025, 9 October 2026. Shelley and Mark directors.', 'done'),
 row('D-U-N-S number', 'Mark', 'Done 19 October: Apple emailed it. Keep it with the company papers; Google Play asks for it too.', 'done'),
 row('ICO registration', 'Mark', 'Registered 15 October 2026, on the privacy page since v200.', 'done'),
 row('Daybook belongs to the company', None, 'Deed signed and witnessed 10 October; copyright moved to Mark 1 Apps Ltd (v151). Still to do: your will for the shares.', 'done'),
 row('Company email in its own mailbox', 'Mark', 'support@ is moving from your Gmail to an iCloud+ mailbox (19 October); confirm with a test email. Then mark@mark1apps.co.uk, once its DNS is checked.', 'now'),
 row('Shelley can reach every account', 'Both', 'GitHub, Firebase, Cloudflare, Anthropic, Resend, Apple; passwords in a vault you both open. Claude writes the guide.', 'open'),
 row('Tax, bank and yearly filings', 'Mark', 'Corporation Tax registration with HMRC within three months of trading; a separate bank account; the yearly confirmation statement and accounts.', 'open'),
]
after = [row(t, None, None, 'open') for t in ['Menopause', 'Long-term pain, fibromyalgia, ME', 'Heart failure and kidney disease', 'COPD and asthma', 'Diabetes', 'Migraine and epilepsy', 'Dementia and frailty, carer-led', 'Recovery after surgery']]
parked = [
 row('Mark 1 Apps website and storefront', None, 'A page of the apps Mark has built, linking to each store listing. Not started.', 'open'),
 row('First sign-in tour', None, 'Welcome to Daybook, a short tour of the real screens with Quit, signposting the guides in More. Parked by Mark on 20 Oct until the guides are up to date.', 'open'),
 row('A sleep report', None, 'From the night answers since v260: hours, short nights, how rested, how often broken and by what. If wanted.', 'open'),
 row('IBD-Control for Crohn\'s circles', 'Mark', 'Free for non-commercial use only; Daybook needs Professor Bodger\'s written agreement first. Claude can draft the request.', 'open'),
 row('Barcode scanner check', 'Mark', 'Built (v172). Try it on a few real UK products and add any Open Food Facts lacks.', 'open'),
]

page = open(__file__.rsplit('/',1)[0] + '/roadmap_page_template.html').read()
body = (
 section('Stage 1 · Build', '2 of 14', 'What the app does. Small fixes keep going in as they come.', s1)
 + section('Stage 2 · UI', '1 of 1', 'How it looks.', s2)
 + section('Stage 3 · UX', '1 of 5', 'How it feels to someone new.', s3)
 + section('Stage 4 · Website', '0 of 2', 'Live since 18 October; the Beta runs from it.', s4)
 + section('Stage 5 · App stores', '0 of 4', 'No longer waiting on Apple’s paperwork.', s5)
 + section('Paperwork · Mark 1 Apps Ltd', '6 of 9', 'Company number 17510025, registered in England and Wales on 9 October 2026.', pw)
 + section('After the stores · More conditions', '0 of 8', None, after)
 + section('Parked, on purpose', '', None, parked)
)
page = page.replace('{{BUILT}}', built_html).replace('{{STAGES}}', body)
open('roadmap.html', 'w').write(page)
print(len(page))
