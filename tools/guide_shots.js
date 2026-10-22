/* The Guide's walk-throughs (v167): real screens from the preview's made-up data, taken at phone size, one WebP a step
   with the caption and where the finger goes next, written to guide/guide.json and guide/*.webp. Run it again whenever the
   look changes:  node tools/guide_shots.js  (needs playwright-core on NODE_PATH, Chromium at $CHROME, the app served at
   $DAYBOOK_URL, by default http://127.0.0.1:8765/index.html, and offline the harness at $DAYBOOK_HARNESS). Nothing real is ever in these pictures. */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'guide');
const BASE = process.env.DAYBOOK_URL || 'http://127.0.0.1:8765/index.html';
const CLOCK = '2026-10-16T09:30:00Z'; // a Friday morning in London (10:30 BST), so Your week is offered and the morning check-in is due
const QUALITY = 0.8;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox', '--lang=en-GB'], env: { ...process.env, LANG: 'en_GB.UTF-8', LC_ALL: 'en_GB.UTF-8', LANGUAGE: 'en_GB' } }); // --lang and LANG: the date and time boxes are drawn in the computer's own language; without LANG a time read 11:10 PM
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'en-GB', timezoneId: 'Europe/London', serviceWorkers: 'block', hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  /* With no outside connection (the test machine), $DAYBOOK_HARNESS names the Playwright harness, whose routes() serves
     the Firebase stub, the chart and PDF libraries and the fonts from local copies; on a connected machine it is not needed. */
  if (process.env.DAYBOOK_HARNESS) await require(process.env.DAYBOOK_HARNESS).routes(context, {});
  /* the preview's own markers (the Preview pill, the Guest chip) are not what a signed-in phone shows, and a toast from the step before would sit over the next picture, so they are hidden in the pictures */
  await page.addInitScript(() => { try { localStorage.setItem('daybook.opener.nofilm', '1'); localStorage.setItem('daybook.speak.hints', '3'); } catch (e) {} Object.defineProperty(window, 'DAYBOOK_DEMO', { configurable: true, set() {}, get() { return undefined; } }); document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#guest-pill, #user-chip, #toast { display: none !important; }'; document.head.appendChild(st); }); });
  await page.clock.setFixedTime(new Date(CLOCK));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#signin:not([hidden])');
  await page.click('#guest-button'); await page.click('[data-preview="cancer"]'); await page.waitForSelector('#app:not([hidden])'); await page.waitForTimeout(1200);
  const conv = await context.newPage();
  const topics = [];
  let topic = null;
  const begin = (key, title, sub, intro) => { topic = { key, title, sub, intro, steps: [] }; topics.push(topic); };
  const settle = (ms) => page.waitForTimeout(ms || 450);
  /* one frame: the screen as it is now, the ring on `tap` (a selector or a locator), the caption */
  async function shot(caption, tap) {
    await settle();
    let ring = null;
    if (tap) {
      const loc = typeof tap === 'string' ? page.locator(tap).first() : tap;
      await loc.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {}); await settle(350);
      const box = await loc.boundingBox({ timeout: 4000 }).catch(() => null);
      if (!box) console.error('no ring for', String(tap));
      if (box) ring = { x: Math.round(((box.x + box.width / 2) / 390) * 1000) / 1000, y: Math.round(((box.y + box.height / 2) / 844) * 1000) / 1000 };
    }
    const png = await page.screenshot({ type: 'png' });
    const dataUrl = 'data:image/png;base64,' + png.toString('base64');
    const webp = await conv.evaluate(([src, q]) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); res(c.toDataURL('image/webp', q)); }; im.onerror = rej; im.src = src; }), [dataUrl, QUALITY]);
    const n = topic.steps.length + 1;
    const file = `${topic.key}-${n}.webp`;
    fs.writeFileSync(path.join(OUT, file), Buffer.from(webp.split(',')[1], 'base64'));
    topic.steps.push({ file, caption, ...(ring ? { tap: ring } : {}) });
    process.stdout.write(`${file} ${(fs.statSync(path.join(OUT, file)).size / 1024).toFixed(0)} KB\n`);
  }
  const slider = async (sel, v) => page.$eval(sel, (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const tab = async (name) => { await page.click(`.tab[data-tab="${name}"]`); await settle(500); };
  const closeSheet = async () => { await page.keyboard.press('Escape'); await settle(400); };
  const refresh = async () => { await page.click('#day-prev'); await page.click('#day-next'); await settle(); };
  /* the side-effects step appears in the three days after a session (v189): Next past it, and any other step without a slider */
  const toRange = async () => { for (let i = 0; i < 3 && !(await page.$('#sheet-body input[type="range"]')); i++) { await page.click('#sheet-body .btn-next'); await settle(300); } };
  const toReview = async () => { for (let i = 0; i < 10 && !(await page.$('#sheet-body .btn-primary:has-text("Save")')); i++) { await page.click('#sheet-body .btn-next'); await settle(250); } };
  const today = await page.evaluate(() => window.daybookPreview.state.selectedDay);
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.webp')) fs.unlinkSync(path.join(OUT, f));

  /* 1. a reading */
  begin('reading', 'Log a reading', 'Vitals, pain, a drink, food, a note, sleep, bowels, a symptom or a dose, from Today.', 'Everything between the check-ins is logged from the tiles on Today, in the same way.');
  await shot('On Today, tap Vitals. The other tiles log pain, a drink, food, a note, sleep, bowels, a symptom or a dose the same way.', '.qa[data-add="vitals"]');
  await page.click('.qa[data-add="vitals"]'); await page.waitForSelector('#sheet:not([hidden])');
  await shot('Type the readings you have. Any box can be left empty, and the time is filled in for you.', '#sheet-body .bigvalue input');
  await page.fill('#sheet-body .bigvalue input', '37.6');
  await page.fill('#sheet-body .field:has-text("Oxygen") input', '97');
  await shot('37.6 and 97 typed. For a reading taken earlier, change the time or the date, then tap Save.', '#sheet-body .btn-primary');
  await page.click('#sheet-body .btn-primary'); await settle(700);
  await shot('Saved. It is on the timeline for the day, coloured if it is raised, and the Reports charts have it too. The three dots on an entry edit or delete it.');

  /* 2. the check-ins */
  begin('checkin', 'The morning and evening check-ins', 'A minute each: sleep, symptoms, pain and mood, one question a screen.', 'The check-ins are what the reports are built from. A minute each, twice a day.');
  /* the simple night (v260): no tracker night this morning, so the step asks for the times */
  await page.evaluate((today) => { const st = window.daybookPreview.state; st.recentEntries = st.recentEntries.filter((e) => !(e.day === today && ((e.type === 'checkin' && (e.slot === 'morning' || e.slot === 'evening')) || e.type === 'sleep'))); st.dayEntries = st.recentEntries.filter((e) => e.day === st.selectedDay); }, today);
  await refresh();
  await shot('Twice a day, a morning check-in and an evening one. Tap the row when it says Due now.', '#checkin-morning');
  await page.click('#checkin-morning'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await slider('#sheet-body input[type="range"]', 7);
  await page.fill('#night-bed', '23:10'); await page.fill('#night-woke', '06:50'); await settle(200);
  await shot('One question a screen. Slide to the score, then when you went to bed and woke up: Daybook works out the hours. With Apple Health connected, the night fills itself in.', '#night-woke');
  await page.click('[aria-label="Do you feel rested"] .preset:text-is("A bit")');
  await page.click('[aria-label="Was your sleep broken"] .preset:text-is("Once or twice")');
  await page.click('[aria-label="What broke it"] .preset:text-is("Pain")');
  await page.click('[aria-label="Roughly how long were you awake"] .preset:text-is("30 minutes to an hour")'); await settle(200);
  await shot('Rested, and whether the night was broken: if it was, what broke it and roughly for how long. It goes on the Sleep chart and the reports.', '#sheet-body .btn-next');
  await page.click('#sheet-body .btn-next'); await settle();
  await page.fill('#sheet-body textarea', 'Nothing new overnight.');
  await shot('A written answer has Tap to speak under it: tap, say it, tap again to stop. To see what was heard before it is saved, switch that on in Settings. Skip is always there.', '#sheet-body .btn-next');
  await page.click('#sheet-body .btn-next'); await settle();
  await toRange();
  await slider('#sheet-body input[type="range"]', 3);
  await page.fill('#sheet-body textarea', 'Lower back, eased by the morning dose.');
  await shot('Pain right now, from 0 no pain to 10 worst imaginable: as you slide it says mild, moderate or severe. Where it is goes in the box underneath.', '#sheet-body .pain-key');
  await page.click('#sheet-body .btn-next'); await settle();
  await slider('#sheet-body input[type="range"]', 7);
  await page.click('#sheet-body .btn-next'); await settle();
  await page.fill('#sheet-body textarea', 'A walk to the shop.');
  await page.click('#sheet-body .btn-next'); await settle();
  await shot('The review: every answer, tap one to change it, then Save.', '#sheet-body .btn-primary');
  await page.click('#sheet-body .btn-primary'); await settle(700);
  await shot('Done. The check-in is a card on Today: tap it to open it, and Edit to change an answer later.', '#checkin-morning-card .cc-head');

  /* 3. medicines */
  begin('meds', 'Medicines and reminders', 'Log a dose, see what is due, set reminder times.', 'The Meds tab is the list; the Medicine tile on Today is the quick way to log a dose.');
  await tab('meds');
  await shot('The Meds tab lists today\'s medicines, each with how many doses are done. Tap Log now when one is taken.', '#meds-scheduled .med-log');
  await page.click('#meds-scheduled .med-log'); await settle(700);
  await page.click('#meds-scheduled .med-toggle'); await settle(500);
  await shot('Logged: the line counts it, and the name opens the card with the time of each dose, Other time, Remove and Log a side effect. A when-needed medicine says when the next dose can be given.');
  await shot('The arrows at the foot of an open card, or holding the name for a second and sliding it, put the list in your own order.', '#meds-scheduled .med-order');
  await tab('today');
  await shot('From Today, the Medicine tile logs a dose without leaving the screen.', '.qa[data-add="medicine"]');
  await page.click('.qa[data-add="medicine"]'); await page.waitForSelector('#sheet:not([hidden])');
  await shot('Tap the medicine taken. When-needed ones come first, with whether they can be given now.');
  await closeSheet();
  await tab('meds');
  await shot('Manage medicines adds one, changes a dose or the times it is taken. Reminders arrive as notifications once they are switched on under Settings.', '#meds-manage');
  await page.click('#meds-manage'); await page.waitForSelector('#sheet:not([hidden])');
  await shot('Add a medicine sits at the top. Under it, every medicine on the list, with what it is for and Edit. A finished course keeps its history under Medicine history.', '#sheet-body .medrow:has-text("Diazepam") button');
  await page.click('#sheet-body .medrow:has-text("Diazepam") button'); await settle(700);
  await shot('Edit says whether it is regular or when needed, then how it is taken (tablets, gel in pumps and the rest), how many each time and the strength, so Log now records the right amount.', '#sheet-body [aria-label="Regular or when needed?"]');
  await closeSheet();
  await page.click('#meds-manage'); await page.waitForSelector('#sheet:not([hidden])');
  await page.click('#sheet-body .medrow:has-text("Senna") button'); await settle(700);
  await shot('A regular medicine then asks when you take it: tick Morning, Midday, Teatime or Night and set each time. One in the morning and one at night is Morning and Night. The same times are its reminders.', '#sheet-body .when-row[data-slot="night"] input[type=checkbox]');
  await closeSheet();

  /* 4. a question */
  begin('question', 'A question for the team', 'Keep the questions for the next appointment, labelled for who answers them.', 'A question written down when it comes to you is a question that gets asked.');
  await tab('today');
  await shot('Something to ask at the next appointment? Tap Question for the team on Today.', '#question-now');
  await page.click('#question-now'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await page.fill('#sheet-body textarea', 'Is the tiredness expected at this point, or worth a blood test?');
  await shot('Type it, or Tap to speak, and say who it is for: Oncology, Gastro, General, Dietitian, Wellbeing or the Pain team. It goes to the top of that report.', '#sheet-body .btn-primary');
  await page.click('#sheet-body .btn-primary'); await settle(700);
  if (await page.$('#sheet:not([hidden])')) await closeSheet();
  await shot('Saved. The row now says how many are waiting; tap it to see them all.', '#question-now');
  await page.click('#question-now'); await page.waitForSelector('#sheet-body .qlist'); await settle();
  await shot('Every question still waiting, from any date. Mark one as answered once the team has dealt with it, or add another at the foot.', '#sheet-body .qlist > .btn-primary');
  await closeSheet();
  await tab('vitals'); await page.click('#rep-notes'); await page.waitForSelector('#view-notes:not([hidden])'); await settle(1500);
  await shot('Every open question heads Notes for the team, with room under it for the answer in clinic. Record or write the answer, then mark it answered.', '#notes-questions .btn-secondary');

  /* 4a. treatment days and side effects (v189, v240) */
  begin('treatment', 'Treatment days and side effects', 'The calendar, where you are in the cycle, and how the days after a session went.', 'The Treatment tab holds the sessions, the days after them, and how each cycle tends to go.');
  const fx = await page.evaluate(() => {
    const st = window.daybookPreview.state, today = st.selectedDay;
    const sessions = Object.keys(st.days).filter((d) => st.days[d].chemo && d < today).sort();
    const last = sessions[sessions.length - 1];
    const t = new Date(last + 'T12:00:00'); t.setDate(t.getDate() + 1);
    const d1 = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    const at = (hh) => new Date(d1 + 'T' + hh + ':00');
    st.recentEntries = st.recentEntries.filter((e) => !(e.day === d1 && (e.type === 'checkin' || e.type === 'symptom')) && !(e.day === today && e.type === 'checkin' && e.slot === 'evening'));
    st.recentEntries.push(
      { id: d1 + '_morning', type: 'checkin', slot: 'morning', day: d1, at: at('08:10'), addedBy: 'Mark', sleep: 5, pain: 3, mood: 5, sidefx: { session: last, treatment: 'chemo', grades: { Sickness: 2, Tiredness: 2, 'Poor appetite': 1 } }, symptoms: 'Queasy from about six and could not face breakfast.' },
      { id: d1 + '_evening', type: 'checkin', slot: 'evening', day: d1, at: at('20:15'), addedBy: 'Mark', pain: 2, mood: 6, sidefx: { session: last, treatment: 'chemo', grades: { Sickness: 1, Tiredness: 2 } }, symptoms: 'Better after the anti-sickness tablet at lunch.' },
      { id: 'guide-fx-1', type: 'symptom', what: 'Mouth', value: 4, day: d1, at: at('14:30'), addedBy: 'Mark', causeKind: 'treatment', causeId: 'chemo', causeName: 'Chemo', note: 'Sore on the left side' });
    st.cycleEntries = null; st.cycleFetched = 0;
    return { d1: Number(d1.slice(8)) };
  });
  await tab('chemo');
  await shot('The Treatment tab: the next session at the top, then the calendar. Sessions carry a letter, C for chemo, and turn gold once ticked done.', '#cal-grid .cal-cell.is-chemo');
  await shot('Add sessions puts a whole run in at once: the first date, how many and how often. A session that moves is moved from its own day.', '#chemo-add-run');
  await page.evaluate((n) => { const c = [...document.querySelectorAll('#cal-grid .cal-cell:not(.is-empty)')].find((x) => x.querySelector('.cal-num') && x.querySelector('.cal-num').textContent === String(n)); c.click(); }, fx.d1);
  await page.waitForSelector('#sheet:not([hidden])'); await settle(700);
  await shot('Tap a day after a session to see how it went: the side effects rated in that day\'s check-ins, your own words, and anything logged.', '#sheet-body .day-fx');
  await closeSheet();
  await tab('today'); await refresh();
  await page.click('#checkin-evening'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  for (let i = 0; i < 10 && !(await page.$('#sheet-body .fx-row')); i++) { await page.click('#sheet-body .btn-next'); await settle(250); }
  await shot('On the three days after a session, the morning and evening check-ins ask about side effects: none, mild, moderate or severe for each.', '#sheet-body .fx-row');
  await closeSheet();
  await page.evaluate(() => { try { Object.keys(localStorage).filter((k) => k.startsWith('daybook.checkin.')).forEach((k) => localStorage.removeItem(k)); } catch (e) {} const p = window.daybookPreview.state.profile; if (p) p.checkinDrafts = {}; });
  await tab('chemo');
  /* the page clock is fixed for the pictures, so Chart.js's draw-in never moves on: move the clock a few seconds so the lines finish */
  for (let i = 1; i <= 3; i++) { await page.clock.setFixedTime(new Date(Date.parse(CLOCK) + i * 4000)); await settle(250); }
  await page.evaluate(() => { const hd = [...document.querySelectorAll('#view-chemo .section-title')].find((x) => /How treatment goes/.test(x.textContent)); if (hd) { hd.scrollIntoView({ block: 'start' }); window.scrollBy(0, -64); } }); await settle(900);
  await shot('How treatment goes: energy, sickness, appetite, pain, mood or sleep by day after each session, so the shape of a cycle shows after a few.');

  /* 5. your week */
  begin('week', 'Your week', 'Five minutes, once a week, over the last days of your week.', 'The weekly check is what the Mood and wellbeing report builds its weeks from.');
  await tab('today');
  await shot('Over the last three days of the week, Your week appears on Today: five minutes, once a week.', '#week-check');
  await page.click('#week-check'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await page.click('#sheet-body .taps-chips >> nth=0 >> button >> nth=1'); await settle(300);
  await shot('Four words for each question, then three boxes in your own words. Every tap is saved as you go.', '#sheet-body .taps-chips >> nth=1 >> button >> nth=1');
  await page.click('#sheet-body .taps-chips >> nth=1 >> button >> nth=1'); await settle(300);
  await page.fill('#sheet-body textarea >> nth=2', 'Steadier, and the garden kept me going.');
  await shot('Finish when it is done. Close it instead and Today says it is not finished yet, with everything kept.', '#sheet-body .btn-primary');
  await page.click('#sheet-body .btn-primary'); await settle(700);
  await shot('Done for the week. Tap the row again to change an answer.');
  await tab('more'); await page.click('#more-settings'); await settle(700);
  await shot('The week ends on Sunday unless you change it under More, Settings, Your week. With treatment on the calendar, one tap makes it end on your treatment day.', '#settings-week');

  /* 6. reports */
  begin('reports', 'Reports, and emailing them', 'Notes for the team, the Food diary, Mood and wellbeing, Pain, and the charts.', 'Each report is a page or two for one person on the team, made from what is already logged.');
  await tab('vitals');
  await shot('The Reports tab: Notes for the team first, then the Food diary, Mood and wellbeing, Pain and pain relief, Documents, and the charts of every reading.', '#rep-notes');
  await page.click('#rep-notes'); await page.waitForSelector('#view-notes:not([hidden])'); await settle(1500);
  await shot('Choose the period, then Send to the team, Preview or Save as PDF. The summary and the notes are below.', '#notes-send');
  await page.click('#notes-send'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await shot('Pick who it goes to. Contacts with an email address come from Who to contact on More.', '#sheet-body .pickrow');
  await page.click('#sheet-body .pickrow'); await settle(900);
  await shot('The subject and message are written for you and can be changed. The report is attached as a PDF, and a copy goes to your own inbox.');
  await closeSheet();
  await page.click('#notes-preview');
  await page.waitForFunction(() => { const f = document.querySelector('#sheet .viewer-frame'); return f && f.srcdoc; }, null, { timeout: 60000 }); await settle(1500);
  await shot('Preview shows the pages exactly as they print. Pinch, double tap, or use plus and minus to zoom in on the report alone. Print and Save as PDF are above.', '#viewer-zoom-in');
  await closeSheet();

  /* 6a. the other reports (v119, v156, v161) */
  begin('morereports', 'Pain, food and mood reports', 'A report for the pain team, the dietitian, and whoever helps with how you feel.', 'Each report is made for one reader, from what is already logged.');
  await tab('vitals');
  await shot('Beside Notes for the team: Pain and pain relief for the pain team, the Food diary for the dietitian, Mood and wellbeing for a therapist or GP.', '#rep-pain');
  await page.click('#rep-pain'); await page.waitForSelector('#view-pain:not([hidden])'); await settle(1500);
  await shot('Pain and pain relief: two weeks to start, the check-in scores, the worst each day, key points from what you wrote, every dose of pain relief and when the top-ups were taken. Send, Preview and Save as PDF, as on every report.', '#pain-send');
  await tab('vitals'); await page.click('#rep-food'); await page.waitForSelector('#view-food:not([hidden])'); await settle(1500);
  await shot('The Food diary: what was eaten and drunk each day, with the questions for the dietitian, on two pages.', '#food-send');
  await tab('vitals'); await page.click('#rep-mood'); await page.waitForSelector('#view-mood:not([hidden])'); await settle(1500);
  await shot('Mood and wellbeing: the best and hardest days, how often you felt low, sleep and pain behind it, and the weeks, with a carer\'s view in its own area.', '#mood-send');

  /* 7. contacts and the set-up */
  begin('contacts', 'Who to contact, and the set-up', 'The ward, the nurse, the GP: one tap to call or email, and where the reports go.', 'More holds the Set-up, this Guide, letters and paperwork, saved meals, Settings and Who to contact.');
  await tab('more');
  await shot('More: the Set-up, the Guide, letters and paperwork, saved meals, Settings, and Who to contact. Tap Add a new contact.', '#calls-add');
  await page.click('#calls-add'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  const inputs = await page.$$('#sheet .contactrow.is-new input');
  await inputs[0].fill('Sarah'); await inputs[1].fill('Oncology nurse specialist'); await inputs[2].fill('01234 567890'); await inputs[4].fill('sarah@example.nhs.uk');
  await shot('A name, and a phone number or an email address, or both. Save.', '#sheet-body .btn-primary:has-text("Save")');
  await page.click('#sheet-body .btn-primary:has-text("Save")'); await settle(700);
  await shot('Call and Email are one tap. Any contact with an email address can be sent a report from the Reports tab.', '#more-setup');
  await page.click('#more-setup'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await shot('The Set-up: what Daybook is for, your name on the reports, a contact, the Home Screen and Tap to speak. Run it again any time, from here or from Settings.');
  await closeSheet();

  /* 8. a carer's phone */
  begin('carer', 'A carer\'s phone', 'Invited as a carer: the same Daybook, with your own view of their mood, the week and the day.', 'Someone invited as a carer logs and reads everything the same way, and adds their own view alongside.');
  await page.evaluate(() => { window.daybookPreview.state.account = { name: 'Guest', role: 'family', relation: 'carer' }; });
  await tab('today'); await refresh();
  await shot('A carer\'s Today has two more rows: their mood this morning and this evening, as you see it, at the patient\'s own times.', '#carer-carermorning');
  await page.click('#carer-carermorning'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await shot('Their mood on 1 to 10, then anything you noticed. It goes on the timeline and the Mood and wellbeing report, never mixed with the patient\'s own scores.');
  await closeSheet();
  await shot('Over the last days of the week, Your week, as you see it: how the patient seemed, kept apart from their own answers.', '#week-check');
  await page.click('#week-check'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await shot('Four questions on how they seemed this week, then three in your own words. It goes on Notes for the team and the Mood and wellbeing report as "As Shelley saw it".');
  await closeSheet();

  /* 9. the whole story, for the website (v230): a day's logging, a question, then the report made and sent */
  begin('story', 'From the day to the report', 'A day\'s logging, a question when it comes to you, then two pages for the team, sent from the app.', 'This is what Daybook is for: the days between appointments, logged as they happen, become the report for the next one.');
  await page.evaluate(() => { window.daybookPreview.state.account = { name: 'Guest', role: 'family', relation: 'patient' }; });
  await page.evaluate((today) => { const st = window.daybookPreview.state; st.recentEntries = st.recentEntries.filter((e) => !(e.type === 'checkin' && e.day === today && (e.slot === 'morning' || e.slot === 'evening'))); st.dayEntries = st.recentEntries.filter((e) => e.day === st.selectedDay); }, today);
  await tab('today'); await refresh();
  await shot('A day starts on Today. The morning check-in is due: a minute, one question a screen.', '#checkin-morning');
  await page.click('#checkin-morning'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await slider('#sheet-body input[type="range"]', 6);
  await shot('How you slept, anything new overnight, pain and mood. Slide to the score, or Tap to speak for the words.', '#sheet-body .btn-next');
  await toReview();
  await page.click('#sheet-body .btn-primary:has-text("Save")'); await settle(700);
  await shot('Saved as a card. Through the day the tiles log a dose, a drink, a meal, a symptom or a bowel movement in a few taps.', '.qa[data-add="medicine"]');
  await page.click('.qa[data-add="medicine"]'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await shot('A dose is one tap on the medicine. When-needed ones say whether the next can be given yet.', '#sheet-body .doserow');
  await page.click('#sheet-body .doserow >> nth=-1'); await settle(700);
  if (await page.$('#sheet:not([hidden])')) await closeSheet();
  await shot('A question comes to you at 3am. Write it down and it waits for the appointment.', '#question-now');
  await page.click('#question-now'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  if (await page.$('#sheet-body .qlist')) { await page.click('#sheet-body .qlist > .btn-primary'); await settle(); }
  await page.fill('#sheet-body textarea', 'Should I keep taking the anti-sickness tablets on the days I feel fine?');
  await shot('Say who it is for, and it goes to the top of that team\'s report.', '#sheet-body .btn-primary');
  await page.click('#sheet-body .btn-primary'); await settle(700);
  await tab('vitals');
  await shot('Before the appointment, open Reports. Everything since the last one is already there.', '#rep-notes');
  await page.click('#rep-notes'); await page.waitForSelector('#view-notes:not([hidden])'); await settle(1500);
  await shot('Notes for the team: the questions, what changed, the charts and the week\'s notes, on two pages. Preview shows them as they print.', '#notes-preview');
  await page.click('#notes-preview');
  await page.waitForFunction(() => { const f = document.querySelector('#sheet .viewer-frame'); return f && f.srcdoc; }, null, { timeout: 60000 }); await settle(1800);
  await shot('Two A4 pages the team can read in a minute, with room to write. Print them, or send them from the app.');
  await closeSheet();
  await page.click('#notes-send'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await page.click('#sheet-body .pickrow'); await settle(900);
  await shot('Send to the team emails the PDF to the nurse, the dietitian or the oncologist, with a copy to you. One tap, and it is done.', '#send-go, #sheet-body .btn-primary');
  await closeSheet();

  /* 10. Crohn's or colitis (v204 to v221), on Jo's preview */
  await page.evaluate(() => document.getElementById('guest-pill').click()); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await page.click('#sheet-body .btn-primary, #sheet-body .btn-danger'); await page.waitForSelector('#signin:not([hidden])'); await settle(600);
  await page.click('#guest-button'); await page.click('[data-preview="ibd"]'); await page.waitForSelector('#app:not([hidden])'); await page.waitForTimeout(1500);
  begin('ibd', 'Crohn\'s or colitis', 'Bowels, flares, injections, results and the report for the IBD team.', 'With Crohn\'s or colitis ticked in Settings, Daybook adds what an IBD team asks about.');
  await tab('today');
  await shot('With Crohn\'s or colitis set up, Today has I think I\'m flaring under the check-ins.', '#flare-row');
  await page.click('#flare-row'); await page.waitForSelector('#sheet:not([hidden])'); await settle(700);
  await shot('A 7-day summary to read out or send to the advice line, what the team told you to do in their own words, and a log of your calls.');
  await closeSheet();
  await shot('Bowels logs each movement in a few taps.', '.qa[data-add="bowel"]');
  await page.click('.qa[data-add="bowel"]'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await shot('The Bristol chart as seven rows, then any blood and how long you could wait. Tap every type in a mixed one.');
  await closeSheet();
  /* fasting today, in the morning check-in (v258): on a day with no check-in yet, skipped through to the question */
  await page.evaluate(() => { for (let i = 0; i < 20; i++) document.getElementById('day-prev').click(); }); await settle(400);
  await page.click('#checkin-morning'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  for (let i = 0; i < 10; i++) { const t = await page.$$eval('#sheet-body .wiz-q', (e) => (e.length ? e[e.length - 1].textContent : '')); if (t === 'Fasting today?') break; await page.click('#sheet-body .wiz-skip'); await page.waitForTimeout(150); }
  await page.click('#sheet-body .fast-chips .preset:text-is("16:8")'); await settle(300);
  await shot('The morning check-in asks whether you are fasting today, and which kind. One tap; it goes on the Food diary and the reports.', '#sheet-body .btn-next');
  await closeSheet();
  await page.evaluate(() => { for (let i = 0; i < 20; i++) document.getElementById('day-next').click(); }); await settle(400);
  await tab('chemo');
  await shot('The Treatment tab: your flare plan, flare days shaded on the calendar, injections or infusions with the next one due, and any steroid course.', '#flare-card');
  await tab('vitals'); await page.click('#rep-results'); await page.waitForSelector('#view-results:not([hidden])'); await settle(1200);
  await shot('Results: blood tests and calprotectin as the team gave them, charted against the lab\'s own range. Daybook never says whether one is good or bad.');
  await tab('vitals'); await page.click('#rep-ibd'); await page.waitForSelector('#view-ibd:not([hidden])'); await settle(1500);
  await shot('The Crohn\'s and colitis report: bowels against your usual, blood, urgency, flares, treatment and results, with your questions for the gastro team.', '#ibd-send');

  /* the order on More > Guide (the website plays the story first whatever the order) */
  const ORDER = ['reading', 'checkin', 'meds', 'question', 'treatment', 'week', 'reports', 'morereports', 'ibd', 'contacts', 'carer', 'story'];
  topics.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  fs.writeFileSync(path.join(OUT, 'guide.json'), JSON.stringify({ made: new Date().toISOString().slice(0, 10), width: 390, height: 844, topics }, null, 1));
  const total = fs.readdirSync(OUT).filter((f) => f.endsWith('.webp')).reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`${topics.length} topics, ${topics.reduce((a, t) => a + t.steps.length, 0)} frames, ${(total / 1024 / 1024).toFixed(2)} MB`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
