// Tap-through test for 3.1 in a phone-size browser. Checks exact values (one tap = one saved row).
// Run: npx expo export -p web && node scripts/write-sw.mjs dist && npx http-server dist -p 8099 -s
//      then: node scripts/tap-test-3.1.mjs /tmp/shots   (needs the playwright package and a Chromium)
import { chromium } from 'playwright';
const URL = 'http://localhost:8099/';
const SHOTS = process.argv[2] || 'shots';
import fs from 'fs'; fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const b = await chromium.launch();

async function fresh(noCW = false) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  if (noCW) await p.addInitScript(() => { delete window.CloseWatcher; });
  await p.goto(URL);
  await p.getByRole('button', { name: 'Skip, try it first' }).click();
  await p.getByLabel('Amount').waitFor();
  return { p, ctx, errors };
}
const store = (p) => p.evaluate(() => ({ e: JSON.parse(localStorage.getItem('gastos.v1.expenses') || '[]'), s: JSON.parse(localStorage.getItem('gastos.v1.settings') || '{}') }));
const tab = (p, n) => p.getByRole('tab', { name: n }).click();

// ---------- 5 + 6: Other with a name, note box, confirm ----------
{
  const { p, ctx, errors } = await fresh();
  ok(await p.getByRole('button', { name: 'Add a note' }).isVisible(), 'note box shows on Log');
  await p.screenshot({ path: `${SHOTS}/log.png` });
  await p.getByLabel('Amount').fill('150');
  await p.getByRole('radio', { name: 'Other', exact: true }).click();
  const what = p.getByLabel('What was it?');
  await what.waitFor();
  ok(await p.getByRole('button', { name: 'Done' }).isVisible(), 'Other opens a "What was it?" pop-up');
  await p.waitForTimeout(100);
  ok(await what.evaluate((el) => el === document.activeElement), 'its box takes focus, not Cancel');
  await what.fill('  Haircut  ');
  const keep = p.getByRole('checkbox');
  ok((await keep.getAttribute('aria-checked')) === 'true', '"Save to my list" ticked by default');
  ok(await p.getByRole('button', { name: 'Use Haircut' }).isVisible(), 'a new name offers "Use Haircut"');
  await p.waitForTimeout(350);
  const blurO = await p.evaluate(() => [...document.querySelectorAll('[aria-label="Cancel"]')].map((el) => getComputedStyle(el).backdropFilter).find((f) => f && f !== 'none'));
  ok(!!blurO && blurO.includes('blur'), 'Other pop-up blurs the screen behind it');
  await p.screenshot({ path: `${SHOTS}/other-popup.png` });
  await p.getByRole('button', { name: 'Done' }).click();
  await p.waitForTimeout(300);
  ok(!(await what.isVisible()), 'Done closes the pop-up');
  ok(await p.getByRole('radio', { name: 'Other: Haircut' }).isVisible(), 'Other tile now reads Haircut');
  await p.getByRole('button', { name: 'Add a note' }).click();
  await p.getByLabel('Note').fill('Barber near the office');
  await p.screenshot({ path: `${SHOTS}/other.png` });
  await p.getByRole('button', { name: /^Save/ }).last().click();
  const dlg = p.getByText('Save this expense?');
  await dlg.waitFor();
  ok(await p.getByText('Barber near the office').last().isVisible(), 'note on its own line in the pop-up');
  // 3: blur behind the pop-up
  const blur = await p.evaluate(() => [...document.querySelectorAll('[aria-label="Cancel"]')].map((el) => getComputedStyle(el).backdropFilter).find((f) => f && f !== 'none'));
  ok(!!blur && blur.includes('blur'), 'pop-up background is blurred: ' + blur);
  await p.screenshot({ path: `${SHOTS}/confirm.png` });
  await p.getByRole('button', { name: 'Save it' }).click();
  await p.waitForTimeout(400);
  let st = await store(p);
  ok(st.e.length === 1, 'one tap = one saved row (' + st.e.length + ')');
  ok(st.e[0]?.category === 'Haircut', 'saved as Haircut, spaces trimmed (' + st.e[0]?.category + ')');
  ok(st.e[0]?.note === 'Barber near the office' && st.e[0]?.cents === 15000, 'note and ₱150.00 saved');
  ok(JSON.stringify(st.s.categories) === '["Haircut"]', 'Haircut kept as a tile (' + JSON.stringify(st.s.categories) + ')');
  ok((await p.getByRole('radio', { name: 'Haircut', exact: true }).count()) === 0, 'the grid stays at 8 tiles: no Haircut tile');
  await p.getByRole('radio', { name: 'Other', exact: true }).click();
  ok(await p.getByRole('button', { name: 'Use Haircut' }).isVisible(), 'Haircut is in the list behind Other next time');
  await p.getByRole('button', { name: 'Cancel' }).last().click();
  await p.waitForTimeout(350);
  ok(!(await p.getByLabel('What was it?').isVisible().catch(() => false)), 'form resets after save');

  // typing a known name maps to it, no tile offered
  await p.getByLabel('Amount').fill('89.50');
  await p.getByRole('radio', { name: 'Other', exact: true }).click();
  await p.getByLabel('What was it?').fill('food');
  ok((await p.getByRole('checkbox').count()) === 0, 'no "keep" box for a name that already exists');
  ok(await p.getByText('Saves under Food.').isVisible(), 'pop-up says it saves under Food');
  await p.getByLabel('What was it?').press('Enter');
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /^Save/ }).last().click();
  await p.getByRole('button', { name: 'Save it' }).click();
  await p.waitForTimeout(300);
  st = await store(p);
  ok(st.e.length === 2 && st.e.some((e) => e.category === 'Food' && e.cents === 8950), '"food" saves under Food');
  ok(st.e.every((e) => e.note !== undefined), 'rows intact');

  // untick: one-off, no tile
  await p.getByLabel('Amount').fill('20');
  await p.getByRole('radio', { name: 'Other', exact: true }).click();
  await p.getByLabel('What was it?').fill('Parking');
  await p.getByRole('checkbox').click();
  await p.getByRole('button', { name: 'Done' }).click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /^Save/ }).last().click();
  await p.getByRole('button', { name: 'Save it' }).click();
  await p.waitForTimeout(300);
  st = await store(p);
  ok(st.e.some((e) => e.category === 'Parking') && !st.s.categories.includes('Parking'), 'unticked: saved as Parking, no tile');

  // empty name = plain Other
  await p.getByLabel('Amount').fill('5');
  await p.getByRole('radio', { name: 'Other', exact: true }).click();
  await p.getByRole('button', { name: 'Done' }).click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /^Save/ }).last().click();
  await p.getByRole('button', { name: 'Save it' }).click();
  await p.waitForTimeout(300);
  st = await store(p);
  ok(st.e.length === 4 && st.e.some((e) => e.category === 'Other' && e.cents === 500), 'empty name saves as plain Other');
  // Cancel puts back what was picked before; so does Back
  await p.getByRole('radio', { name: 'Transport' }).click();
  await p.getByRole('radio', { name: 'Other', exact: true }).click();
  await p.getByLabel('What was it?').fill('Tricycle');
  await p.getByRole('button', { name: 'Cancel' }).click();
  await p.waitForTimeout(300);
  ok((await p.getByRole('radio', { name: 'Transport' }).getAttribute('aria-checked')) === 'true', 'Cancel keeps Transport picked');
  await p.getByRole('radio', { name: 'Other', exact: true }).click();
  await p.getByLabel('What was it?').waitFor();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  ok(!(await p.getByLabel('What was it?').isVisible()) && (await p.getByRole('radio', { name: 'Transport' }).getAttribute('aria-checked')) === 'true', 'Back closes the Other pop-up like Cancel');
  ok(errors.length === 0, 'no console errors: ' + errors.join(' | '));
  await ctx.close();
}

// ---------- 4: Back button (CloseWatcher: Escape is the desktop close request) ----------
{
  const { p, ctx, errors } = await fresh();
  await p.getByLabel('Amount').fill('77');
  await p.getByRole('radio', { name: 'Food' }).click();
  await p.getByRole('button', { name: /^Save/ }).last().click();
  await p.getByText('Save this expense?').waitFor();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  ok(!(await p.getByText('Save this expense?').isVisible()), 'Back closes the pop-up');
  ok((await store(p)).e.length === 0, 'Back on the pop-up never saves');
  await tab(p, 'Settings');
  await p.getByRole('button', { name: /^Color theme/ }).click();
  await p.getByText('Pick the color you like.', { exact: false }).waitFor();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  ok(!(await p.getByText('Pick the color you like.', { exact: false }).isVisible()) && (await p.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected')) === 'true', 'Back closes the sheet, stays on Settings');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  ok((await p.getByRole('tab', { name: 'Log' }).getAttribute('aria-selected')) === 'true', 'Back from Settings goes to Log');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok(await p.getByText('Press back again to exit').isVisible(), 'Back on Log asks before leaving');
  ok(errors.length === 0, 'no console errors: ' + errors.join(' | '));
  await ctx.close();
}

// ---------- 4b: Back button, history fallback (no CloseWatcher) ----------
{
  const { p, ctx } = await fresh(true);
  await tab(p, 'History');
  await p.waitForTimeout(200);
  const st = await p.evaluate(() => history.state);
  ok(st && st.gastos === 'guard', 'fallback: spare entry pushed during the tap');
  await p.goBack();
  await p.waitForTimeout(400);
  ok((await p.getByRole('tab', { name: 'Log' }).getAttribute('aria-selected')) === 'true', 'fallback: Back from History goes to Log');
  await ctx.close();
}

// ---------- 1 + 2: colour theme and FAQ ----------
{
  const { p, ctx, errors } = await fresh();
  await tab(p, 'Settings');
  await p.screenshot({ path: `${SHOTS}/settings.png`, fullPage: false });
  await p.getByRole('button', { name: /^Color theme/ }).click();
  await p.getByRole('radio', { name: 'Baby pink' }).waitFor();
  await p.screenshot({ path: `${SHOTS}/themes.png` });
  await p.getByRole('radio', { name: 'Baby pink' }).click();
  await p.waitForTimeout(300);
  ok((await p.getByRole('radio', { name: 'Baby pink' }).getAttribute('aria-checked')) === 'true', 'Baby pink picked');
  ok((await store(p)).s.colorTheme === 'pink', 'colorTheme saved as pink');
  await p.keyboard.press('Escape');
  await tab(p, 'Log');
  await p.getByLabel('Amount').fill('185');
  const saveBg = await p.getByRole('button', { name: /^Save ₱185/ }).evaluate((el) => getComputedStyle(el).backgroundColor);
  ok(saveBg === 'rgb(178, 58, 110)', 'Save button is baby pink (' + saveBg + ')');
  await p.getByRole('radio', { name: 'Food' }).click();
  await p.screenshot({ path: `${SHOTS}/log-pink.png` });
  // survives a reload
  await p.reload();
  await p.getByLabel('Amount').waitFor();
  await p.getByLabel('Amount').fill('1');
  const bg2 = await p.getByRole('button', { name: /^Save ₱1/ }).evaluate((el) => getComputedStyle(el).backgroundColor);
  ok(bg2 === 'rgb(178, 58, 110)', 'theme kept after reopening');
  // dark + pink
  await tab(p, 'Settings');
  await p.getByRole('radio', { name: 'Dark' }).click().catch(async () => p.getByRole('button', { name: 'Dark' }).click());
  await p.waitForTimeout(900);
  await tab(p, 'Log');
  await p.screenshot({ path: `${SHOTS}/log-pink-dark.png` });
  // FAQ
  await tab(p, 'Settings');
  await p.getByRole('button', { name: 'FAQ' }).click();
  await p.getByLabel('Search questions').fill('backup');
  ok(await p.getByRole('button', { name: 'Is there a backup?' }).isVisible(), 'FAQ search finds "Is there a backup?"');
  ok(!(await p.getByRole('button', { name: 'How do I change the color?' }).isVisible()), 'search hides the rest');
  await p.getByRole('button', { name: 'Is there a backup?' }).click();
  ok(await p.getByText('Yes, two kinds.', { exact: false }).isVisible(), 'tapping a question opens its answer');
  await p.getByLabel('Search questions').fill('');
  await p.getByRole('button', { name: 'How safe is my data?' }).click();
  ok(await p.getByText('Each account can only ever see its own entries', { exact: false }).isVisible(), '"How safe is my data?" answers');
  await p.screenshot({ path: `${SHOTS}/faq.png` });
  ok(errors.length === 0, 'no console errors: ' + errors.join(' | '));
  await ctx.close();
}
// ---------- Your list behind Other: pins, most used, rename, remove; the Log screen fits ----------
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  const today = new Date().toISOString().slice(0, 10);
  const row = (i, category, cents, kind = 'expense') => ({ id: 'x' + i, kind, category, cents, note: '', method: 'cash', paidWith: '', currency: 'PHP', date: today, createdAt: Date.now() - i });
  const rows = [row(0, 'Salary', 1425000, 'income'), row(1, 'Food', 50000)];
  for (let i = 0; i < 3; i++) rows.push(row(10 + i, 'Tuition', 1000));
  for (let i = 0; i < 5; i++) rows.push(row(20 + i, 'Haircut', 1000));
  await p.addInitScript((rows) => {
    localStorage.setItem('gastos.v1.onboarded', '1');
    localStorage.setItem('gastos.v1.expenses', JSON.stringify(rows));
    localStorage.setItem('gastos.v1.settings', JSON.stringify({ currency: 'PHP', appearance: 'light', categories: ['Coffee', 'Tuition', 'Haircut', 'Parking'], pinned: [], paymentLabels: [], sounds: false, colorTheme: 'green' }));
  }, rows);
  await p.goto(URL);
  await p.getByLabel('Amount').waitFor();
  await p.waitForTimeout(600);
  const gap = await p.evaluate(() => {
    const save = [...document.querySelectorAll('[role="button"]')].filter((e) => /^Save/.test(e.textContent || '')).pop().getBoundingClientRect();
    return Math.round(document.querySelector('[role="tablist"]').getBoundingClientRect().top - save.bottom);
  });
  ok(gap >= 8 && gap <= 16, 'Log fills the phone: Save sits ' + gap + 'px above the tab bar');
  ok(await p.getByText('In', { exact: true }).isVisible() && await p.getByText('Out', { exact: true }).isVisible(), 'full top card with In and Out boxes');
  await p.getByRole('radio', { name: 'Other', exact: true }).click();
  await p.getByLabel('What was it?').waitFor();
  const order = async () => p.evaluate(() => [...document.querySelectorAll('[aria-label^="Use "]')].map((e) => e.getAttribute('aria-label').slice(4)));
  ok(JSON.stringify(await order()) === '["Haircut","Tuition","Coffee","Parking"]', 'most used first, then A to Z: ' + JSON.stringify(await order()));
  await p.getByRole('button', { name: 'Pin Parking' }).click();
  await p.waitForTimeout(200);
  ok((await order())[0] === 'Parking' && (await p.getByRole('button', { name: 'Unpin Parking' }).isVisible()), 'pinning puts Parking on top');
  ok(JSON.stringify((await store(p)).s.pinned) === '["Parking"]', 'the pin is saved');
  // rename Haircut -> Barber, past entries too
  await p.getByRole('button', { name: 'Edit Haircut' }).click();
  const nn = p.getByLabel('New name for Haircut');
  await nn.waitFor();
  ok(await p.getByText('Rename my 5 past entries too').isVisible(), 'edit says how many past entries');
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${SHOTS}/edit-name.png` });
  await nn.fill('Barber');
  await p.getByRole('button', { name: 'Save', exact: true }).last().click();
  await p.waitForTimeout(400);
  let st = await store(p);
  ok(st.s.categories.includes('Barber') && !st.s.categories.includes('Haircut'), 'list renamed to Barber');
  ok(st.e.filter((e) => e.category === 'Barber').length === 5 && !st.e.some((e) => e.category === 'Haircut'), 'the 5 past entries renamed too');
  // rename into an existing name merges
  await p.getByRole('button', { name: 'Edit Tuition' }).click();
  await p.getByLabel('New name for Tuition').fill('coffee');
  ok(await p.getByText('is already in your list', { exact: false }).isVisible(), 'renaming onto another name warns it merges');
  await p.getByRole('button', { name: 'Save', exact: true }).last().click();
  await p.waitForTimeout(400);
  st = await store(p);
  ok(!st.s.categories.includes('Tuition') && st.s.categories.filter((c) => c === 'Coffee').length === 1 && st.e.filter((e) => e.category === 'Coffee').length === 3, 'merged into Coffee with its 3 entries');
  // remove keeps past entries
  await p.getByRole('button', { name: 'Edit Barber' }).click();
  await p.getByRole('button', { name: 'Remove Barber from my list' }).click();
  await p.waitForTimeout(400);
  st = await store(p);
  ok(!st.s.categories.includes('Barber') && st.e.filter((e) => e.category === 'Barber').length === 5, 'removed from the list; past entries keep their name');
  // search
  await p.getByLabel('What was it?').fill('par');
  const hits = (await order()).filter((n) => n !== 'par');
  ok(JSON.stringify(hits) === '["Parking"]', 'search narrows the list: ' + JSON.stringify(hits));
  await p.getByRole('button', { name: 'Use Parking' }).click();
  await p.waitForTimeout(350);
  ok(await p.getByRole('radio', { name: 'Other: Parking' }).isVisible(), 'tapping a name picks it');
  // Undo bar floats above the tab bar and leaves when she starts the next one
  await p.getByLabel('Amount').fill('40');
  await p.getByRole('button', { name: /^Save/ }).last().click();
  await p.getByRole('button', { name: 'Save it' }).click();
  await p.waitForTimeout(400);
  ok(await p.getByText('Saved ₱40.00 for Parking.').isVisible(), 'Undo bar shows after saving');
  await p.getByRole('radio', { name: 'Food' }).click();
  await p.waitForTimeout(200);
  ok(!(await p.getByText('Saved ₱40.00 for Parking.').isVisible()), 'Undo bar steps aside once she logs the next one');
  ok(errors.length === 0, 'no console errors: ' + errors.join(' | '));
  await ctx.close();
}

// ---------- History: one tap shows the details, Edit at the top ----------
{
  const { p, ctx, errors } = await fresh();
  await p.getByLabel('Amount').fill('185');
  await p.getByRole('radio', { name: 'Food' }).click();
  await p.getByRole('button', { name: 'Add a note' }).click();
  await p.getByLabel('Note').fill('Jollibee lunch with the team');
  await p.getByRole('button', { name: /^Save/ }).last().click();
  await p.getByRole('button', { name: 'Save it' }).click();
  await p.waitForTimeout(300);
  await tab(p, 'History');
  const row = p.getByRole('button', { name: /^Food, minus ₱185\.00\. Tap for details\./ });
  await row.click();
  const edit = p.getByRole('button', { name: 'Edit this expense' });
  await edit.waitFor();
  ok(await p.getByText('Jollibee lunch with the team').last().isVisible(), 'one tap: details pop-up with the note');
  ok(await p.getByText('Paid with').isVisible() && await p.getByText('Added').isVisible(), 'details list wallet and time added');
  ok(!(await p.getByText('Edit expense').isVisible()), 'tapping never opens editing by itself');
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${SHOTS}/details.png` });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  ok(!(await edit.isVisible()) && (await p.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')) === 'true', 'Back closes the details, stays on History');
  await row.click();
  await p.getByRole('button', { name: 'Close', exact: true }).last().click();
  await p.waitForTimeout(400);
  ok(!(await edit.isVisible()), 'Close closes the details');
  await row.click();
  await edit.click();
  await p.getByText('Edit expense').waitFor();
  ok(await p.getByText('Edit expense').isVisible(), 'Edit opens the edit sheet');
  await p.waitForTimeout(500); // the details pop-up fades out
  ok(!(await edit.isVisible()), 'details pop-up gone behind the edit sheet');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  ok(!(await p.getByText('Edit expense').isVisible()), 'Back closes the edit sheet');
  ok((await store(p)).e.length === 1 && (await store(p)).e[0].cents === 18500, 'looking and backing out changed nothing');
  // dark
  await tab(p, 'Settings');
  await p.getByRole('radio', { name: 'Dark' }).click();
  await p.waitForTimeout(900);
  await tab(p, 'History');
  await row.click();
  await edit.waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${SHOTS}/details-dark.png` });
  ok(errors.length === 0, 'no console errors: ' + errors.join(' | '));
  await ctx.close();
}
await b.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
