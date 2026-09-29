// README screenshots from a real build, with sample data, signed in (a fake session; the server is played by
// request routing, so nothing touches the real database). Each image is 780×1688 with the "© Joemark Basa" pill.
// Run: npx expo export -p web && node scripts/write-sw.mjs dist && npx http-server dist -p 8099 -s
//      then: node scripts/readme-shots.mjs docs/screenshots   (needs the playwright package and a Chromium)
// MPIN screens (mpin-login.png, mpin-keypad.png) are not retaken here: they need a real account.
import { chromium } from 'playwright';
import fs from 'fs';
const APP = 'http://localhost:8099/';
const COIN_MS = Number(process.env.COIN_MS || 1400); // which moment of the coin shower becomes coin-shower.png
const OUT = process.argv[2] || 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const REF = 'vlhkbmpjlqpcphxipwqk';
const UID = '11111111-2222-4333-8444-555555555555';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', aud: 'authenticated', exp })}.sig`;
const SESSION = {
  access_token: jwt, token_type: 'bearer', expires_in: 30 * 86400, expires_at: exp, refresh_token: 'fake-refresh',
  user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'juan@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};

// Sample month: ₱14,250 in, ₱6,536.28 out, so "left this month" is ₱7,713.72.
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
let seq = 0;
const row = (kind, category, pesos, note, paidWith, daysAgo) => ({
  id: 'sample' + ++seq, kind, category, cents: Math.round(pesos * 100), note,
  method: paidWith === 'Cash' || paidWith === '' ? 'cash' : 'card', paidWith: paidWith === 'Cash' ? '' : paidWith,
  currency: 'PHP', date: day(daysAgo), createdAt: Date.now() - daysAgo * 86400_000 - seq * 60_000,
});
const EXPENSES = [
  row('expense', 'Food', 185, 'Jollibee lunch', 'Cash', 0),
  row('expense', 'Load', 99, 'Globe promo', 'GCash', 0),
  row('expense', 'Transport', 312.4, 'Grab to Ortigas', 'GCash', 1),
  row('income', 'Salary', 14250, 'Cutoff pay', 'Cash', 1),
  row('expense', 'Groceries', 2480.88, 'SM Supermarket', 'Maya', 2),
  row('expense', 'Padala', 1500, 'For Nanay', 'GCash', 3),
  row('expense', 'Bills', 1488, 'Meralco', 'BPI Visa', 4),
  row('expense', 'Health', 471, 'Mercury Drug', 'Cash', 5),
];
const SETTINGS = (colorTheme, appearance) => ({
  currency: 'PHP', appearance, sounds: false, colorTheme,
  categories: ['Groceries', 'Haircut', 'Tuition', 'Coffee', 'Parking', 'Laundry'], pinned: ['Groceries'],
  paymentLabels: [{ n: 'GCash', g: 'ewallet' }, { n: 'Maya', g: 'ewallet' }, { n: 'GoTyme', g: 'ewallet' }, { n: 'BPI Visa', g: 'card' }],
});

const b = await chromium.launch();
async function open({ theme = 'green', mode = 'light', updating = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: mode });
  await ctx.addInitScript(({ REF, SESSION, UID, EXPENSES, S }) => {
    localStorage.setItem(`sb-${REF}-auth-token`, JSON.stringify(SESSION));
    localStorage.setItem('gastos.v1.lastUser', UID);
    localStorage.setItem('gastos.v1.onboarded', '1');
    localStorage.setItem('gastos.v1.expenses', JSON.stringify(EXPENSES));
    localStorage.setItem('gastos.v1.settings', JSON.stringify(S));
  }, { REF, SESSION, UID, EXPENSES, S: SETTINGS(theme, mode) });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost') return route.continue();
    if (!u.hostname.startsWith(REF)) return route.abort();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
    if (u.pathname.endsWith('/rpc/app_status')) {
      return json(200, { updating, window_id: 'readme', min_build: 0, now: new Date().toISOString(),
        back_at: updating ? new Date(Date.now() + 45 * 60_000).toISOString() : null });
    }
    if (u.pathname.endsWith('/rpc/pin_status')) return json(200, { enabled: false, epoch: null, locked: false, tries_left: 5, can_reset: true });
    if (route.request().method() === 'GET') {
      return (route.request().headers()['accept'] || '').includes('vnd.pgrst.object')
        ? json(406, { code: 'PGRST116', message: 'no rows', details: null, hint: null })
        : json(200, []);
    }
    return json(201);
  });
  const p = await ctx.newPage();
  await p.goto(APP);
  if (!updating) {
    await p.getByLabel('Amount').waitFor({ timeout: 15000 });
    await p.getByLabel('Sync status: Synced').waitFor({ timeout: 10000 });
  }
  await p.waitForTimeout(900); // count-ups and ring draw-in finish
  return { p, ctx };
}
async function shot(p, name) {
  await p.evaluate(() => {
    document.getElementById('readme-credit')?.remove();
    const pill = document.createElement('div');
    pill.id = 'readme-credit';
    pill.textContent = '© Joemark Basa';
    pill.style.cssText = 'position:fixed;right:15px;bottom:2px;z-index:99999;background:#4a4f4c;color:#fff;' +
      'font:700 10.5px Poppins,Inter,sans-serif;padding:4px 10px;border-radius:12px;opacity:.95;pointer-events:none';
    document.body.appendChild(pill);
  });
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log('saved', name);
}
const tab = (p, n) => p.getByRole('tab', { name: n }).click();

{ const { p, ctx } = await open(); await shot(p, 'log-light'); await ctx.close(); }
{ const { p, ctx } = await open({ mode: 'dark' }); await shot(p, 'log-dark'); await ctx.close(); }
{
  const { p, ctx } = await open();
  await p.getByLabel('Amount').fill('185');
  await p.getByRole('radio', { name: 'Food', exact: true }).click();
  await p.getByRole('button', { name: 'Add a note' }).click();
  await p.getByLabel('Note').fill('Jollibee lunch');
  await p.getByRole('button', { name: /^Save/ }).last().click();
  await p.getByRole('button', { name: 'Save it' }).waitFor();
  await p.waitForTimeout(500);
  await shot(p, 'confirm-save');
  await ctx.close();
}
{
  const { p, ctx } = await open();
  await p.getByLabel('Piggy bank').click();
  // The shower lasts about 3 s; mid-fall is where it reads best.
  for (const ms of [1000, 1400, 1800, 2200]) {
    await p.waitForTimeout(ms === 1000 ? 1000 : 400);
    await shot(p, ms === COIN_MS ? 'coin-shower' : `_coin-${ms}`);
  }
  await ctx.close();
}
{
  const { p, ctx } = await open();
  await tab(p, 'History');
  await p.waitForTimeout(1100);
  await shot(p, 'history');
  await p.getByRole('radio', { name: 'Dates' }).click();
  await p.waitForTimeout(800);
  await shot(p, 'pick-dates');
  await ctx.close();
}
{
  const { p, ctx } = await open();
  await tab(p, 'History');
  await p.getByRole('button', { name: /^Food, minus ₱185\.00\. Tap for details\./ }).click();
  await p.getByRole('button', { name: 'Edit this expense' }).waitFor();
  await p.waitForTimeout(500);
  await shot(p, 'entry-details');
  await p.getByRole('button', { name: 'Edit this expense' }).click();
  await p.waitForTimeout(800);
  await shot(p, 'edit');
  await ctx.close();
}
{
  const { p, ctx } = await open();
  await tab(p, 'Settings');
  await p.waitForTimeout(500);
  await shot(p, 'settings');
  await p.getByRole('button', { name: /^Color theme/ }).click();
  await p.getByText('Pick the color you like.', { exact: false }).waitFor();
  await p.waitForTimeout(600);
  await shot(p, 'color-themes');
  await ctx.close();
}
{
  const { p, ctx } = await open();
  await tab(p, 'Settings');
  await p.getByRole('button', { name: 'FAQ' }).click();
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'How safe is my data?' }).click();
  await p.waitForTimeout(500);
  await shot(p, 'faq');
  await ctx.close();
}
{
  const { p, ctx } = await open();
  await tab(p, 'Settings');
  await p.getByRole('button', { name: 'Cards and e-wallets' }).click();
  await p.waitForTimeout(700);
  await shot(p, 'cards-and-wallets');
  await ctx.close();
}
{
  const { p, ctx } = await open();
  await p.getByRole('radio', { name: 'Other', exact: true }).click();
  await p.getByLabel('What was it?').waitFor();
  await p.waitForTimeout(600);
  await shot(p, 'your-list');
  await ctx.close();
}
{
  const { p, ctx } = await open({ updating: true });
  await p.getByText('Gastos is updating', { exact: true }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(600);
  await shot(p, 'updating');
  await ctx.close();
}
await b.close();
