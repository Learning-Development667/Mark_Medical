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
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox', '--lang=en-GB'] }); // --lang: the date and time boxes are drawn by the browser in its own language
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'en-GB', timezoneId: 'Europe/London', serviceWorkers: 'block', hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  /* With no outside connection (the test machine), $DAYBOOK_HARNESS names the Playwright harness, whose routes() serves
     the Firebase stub, the chart and PDF libraries and the fonts from local copies; on a connected machine it is not needed. */
  if (process.env.DAYBOOK_HARNESS) await require(process.env.DAYBOOK_HARNESS).routes(context, {});
  /* the preview's own markers (the Preview pill, the Guest chip) are not what a signed-in phone shows, so they are hidden in the pictures */
  await page.addInitScript(() => { try { localStorage.setItem('daybook.opener.nofilm', '1'); localStorage.setItem('daybook.speak.hints', '3'); } catch (e) {} Object.defineProperty(window, 'DAYBOOK_DEMO', { configurable: true, set() {}, get() { return undefined; } }); document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#guest-pill, #user-chip { display: none !important; }'; document.head.appendChild(st); }); });
  await page.clock.setFixedTime(new Date(CLOCK));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#signin:not([hidden])');
  await page.click('#guest-button'); await page.waitForSelector('#app:not([hidden])'); await page.waitForTimeout(1200);
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
  await page.evaluate((today) => { const st = window.daybookPreview.state; st.recentEntries = st.recentEntries.filter((e) => !(e.type === 'checkin' && e.day === today && (e.slot === 'morning' || e.slot === 'evening'))); st.dayEntries = st.recentEntries.filter((e) => e.day === st.selectedDay); }, today);
  await refresh();
  await shot('Twice a day, a morning check-in and an evening one. Tap the row when it says Due now.', '#checkin-morning');
  await page.click('#checkin-morning'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await slider('#sheet-body input[type="range"]', 7);
  await shot('One question a screen. Slide to the score, 1 to 10. Hours slept come from Apple Health when it is connected.', '#sheet-body .btn-next');
  await page.click('#sheet-body .btn-next'); await settle();
  await page.fill('#sheet-body textarea', 'Nothing new overnight.');
  await shot('A written answer has Tap to speak under it: tap, say it, tap again to stop. Skip is always there.', '#sheet-body .btn-next');
  await page.click('#sheet-body .btn-next'); await settle();
  await slider('#sheet-body input[type="range"]', 3);
  await page.fill('#sheet-body textarea', 'Lower back, eased by the morning dose.');
  await shot('Pain right now, with where it is in words underneath. The words go on Notes for the team and the Pain report.', '#sheet-body .btn-next');
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
  await shot('The Meds tab lists today\'s medicines, a dot for each dose due. Tap Log now when one is taken.', '#meds-scheduled .med-actions .btn-primary');
  await page.click('#meds-scheduled .med-actions .btn-primary'); await settle(700);
  await shot('Logged, with the time as a chip. A when-needed medicine says when the next dose can be given, and when the day\'s maximum is reached.');
  await tab('today');
  await shot('From Today, the Medicine tile logs a dose without leaving the screen.', '.qa[data-add="medicine"]');
  await page.click('.qa[data-add="medicine"]'); await page.waitForSelector('#sheet:not([hidden])');
  await shot('Tap the medicine taken. When-needed ones come first, with whether they can be given now.');
  await closeSheet();
  await tab('meds');
  await shot('Manage medicines adds one, changes a dose, or sets reminder times. Reminders arrive as notifications once they are switched on under Settings.', '#meds-manage');
  await page.click('#meds-manage'); await page.waitForSelector('#sheet:not([hidden])');
  await shot('Every medicine on the list, with Edit. A finished course keeps its history under Medicine history.');
  await closeSheet();

  /* 4. a question */
  begin('question', 'A question for the team', 'Keep the questions for the next appointment, labelled for who answers them.', 'A question written down when it comes to you is a question that gets asked.');
  await tab('today');
  await shot('Something to ask at the next appointment? Tap Question for the team on Today.', '#question-now');
  await page.click('#question-now'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await page.fill('#sheet-body textarea', 'Is the tiredness expected at this point, or worth a blood test?');
  await shot('Type it, or Tap to speak, and say who it is for: Oncology, Gastro, General, Dietitian or the Pain team. It goes to the top of that report.', '#sheet-body .btn-primary');
  await page.click('#sheet-body .btn-primary'); await settle(700);
  await tab('vitals'); await page.click('#rep-notes'); await page.waitForSelector('#view-notes:not([hidden])'); await settle(1500);
  await shot('Every open question heads Notes for the team, with room under it for the answer in clinic. Record or write the answer, then mark it answered.', '#notes-questions .btn-secondary');

  /* 5. your week */
  begin('week', 'Your week', 'Five minutes, once a week, from Friday to Sunday.', 'The weekly check is what the Mood and wellbeing report builds its weeks from.');
  await tab('today');
  await shot('From Friday to Sunday, Your week appears on Today: five minutes, once a week.', '#week-check');
  await page.click('#week-check'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await page.click('#sheet-body .taps-chips >> nth=0 >> button >> nth=1'); await settle(300);
  await shot('Four words for each question, then three boxes in your own words. Every tap is saved as you go.', '#sheet-body .taps-chips >> nth=1 >> button >> nth=1');
  await page.click('#sheet-body .taps-chips >> nth=1 >> button >> nth=1'); await settle(300);
  await page.fill('#sheet-body textarea >> nth=2', 'Steadier, and the garden kept me going.');
  await shot('Finish when it is done. Close it instead and Today says it is not finished yet, with everything kept.', '#sheet-body .btn-primary');
  await page.click('#sheet-body .btn-primary'); await settle(700);
  await shot('Done for the week. Tap the row again to change an answer.');

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
  await shot('Preview shows the pages exactly as they print, with Print and Save as PDF above them.');
  await closeSheet();

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
  begin('carer', 'A carer\'s phone', 'Invited as a carer: the same Daybook, with your own view of the week and the day.', 'Someone invited as a carer logs and reads everything the same way, and adds their own view alongside.');
  await page.evaluate(() => { window.daybookPreview.state.account = { name: 'Guest', role: 'family', relation: 'carer' }; });
  await tab('today'); await refresh();
  await shot('A carer sees the same Today, and from Friday, Your week, as you see it: how the patient seemed, kept apart from their own answers.', '#week-check');
  await page.click('#week-check'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await shot('Four questions on how they seemed this week, then three in your own words. It goes on the Mood and wellbeing report as "As Shelley saw it".');
  await closeSheet();
  await tab('chemo');
  await shot('On the Treatment tab, the Carer\'s view: the day\'s energy, sickness, eating, pain and mood as you see it.', '#checkin-carer');
  await page.click('#checkin-carer'); await page.waitForSelector('#sheet:not([hidden])'); await settle();
  await shot('The same sliders, worded as you see it. They are shown beside the patient\'s own scores on the treatment cycle chart, never mixed with them.');
  await closeSheet();

  fs.writeFileSync(path.join(OUT, 'guide.json'), JSON.stringify({ made: new Date().toISOString().slice(0, 10), width: 390, height: 844, topics }, null, 1));
  const total = fs.readdirSync(OUT).filter((f) => f.endsWith('.webp')).reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`${topics.length} topics, ${topics.reduce((a, t) => a + t.steps.length, 0)} frames, ${(total / 1024 / 1024).toFixed(2)} MB`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
