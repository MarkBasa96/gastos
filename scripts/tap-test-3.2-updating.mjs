// Tap-through test for 3.2 "Gastos is updating" (Joe's C1). Plays the server's part with request routing:
// the switch (rpc/app_status), the database gate (503 GASTOS_UPDATING on writes), and dropped signal.
// Run: npx expo export -p web && node scripts/write-sw.mjs dist && npx http-server dist -p 8099 -s
//      then: node scripts/tap-test-3.2-updating.mjs /tmp/shots   (needs the playwright package and a Chromium)
import { chromium } from 'playwright';
import fs from 'fs';
const APP = 'http://localhost:8099/';
const SHOTS = process.argv[2] || 'shots';
fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const REF = 'vlhkbmpjlqpcphxipwqk';
const UID = '11111111-2222-4333-8444-555555555555';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', aud: 'authenticated', exp, email: 'test@example.invalid' })}.sig`;
const SESSION = {
  access_token: jwt, token_type: 'bearer', expires_in: 30 * 86400, expires_at: exp, refresh_token: 'fake-refresh',
  user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};

// The fake server. `status` = what rpc/app_status answers ('fail' = no signal); `gate` = writes refused.
const srv = { status: null, gate: false, upserts: [], unknown: [] };
const statusBody = (updating, windowId, backMin = 45) => ({
  updating, window_id: windowId, min_build: 0, now: new Date().toISOString(),
  back_at: updating ? new Date(Date.now() + backMin * 60_000).toISOString() : null,
});

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(({ REF, SESSION, UID }) => {
  if (localStorage.getItem('gastos.v1.lastUser')) return; // only the first load: keep what the app saved since
  localStorage.setItem(`sb-${REF}-auth-token`, JSON.stringify(SESSION));
  localStorage.setItem('gastos.v1.lastUser', UID);
  localStorage.setItem('gastos.v1.onboarded', '1');
  localStorage.setItem('gastos.v1.settings', JSON.stringify({ currency: 'PHP', appearance: 'light', categories: [], pinned: [], paymentLabels: [], sounds: false, colorTheme: 'green' }));
}, { REF, SESSION, UID });

await ctx.route('**/*', async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  if (u.hostname === 'localhost') return route.continue();
  if (!u.hostname.startsWith(REF)) return route.abort();
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
  const path = u.pathname;
  if (path.endsWith('/rpc/app_status')) {
    if (srv.status === 'fail') return route.abort('internetdisconnected');
    return json(200, srv.status);
  }
  if (path.endsWith('/rpc/pin_status')) return json(200, { enabled: false, epoch: null, locked: false, tries_left: 5, can_reset: true });
  const gated = { code: 'GASTOS_UPDATING', message: 'Gastos is updating', details: null, hint: null };
  if (path.endsWith('/rest/v1/expenses')) {
    if (req.method() === 'GET') return json(200, []);
    const rows = JSON.parse(req.postData() || '[]');
    srv.upserts.push({ gate: srv.gate, n: Array.isArray(rows) ? rows.length : 1 });
    return srv.gate ? json(503, gated) : json(201);
  }
  if (path.endsWith('/rest/v1/user_settings')) {
    if (req.method() === 'GET') {
      return (req.headers()['accept'] || '').includes('vnd.pgrst.object')
        ? json(406, { code: 'PGRST116', message: 'no rows', details: null, hint: null })
        : json(200, []);
    }
    return srv.gate ? json(503, gated) : json(201);
  }
  srv.unknown.push(req.method() + ' ' + path);
  return json(200, {});
});

const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
const dirty = () => p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('gastos.v1.dirty') || '{}')).length);
const chip = (label) => p.getByLabel(`Sync status: ${label}`);
const logOne = async (amt) => {
  await p.getByLabel('Amount').fill(String(amt));
  await p.getByRole('radio', { name: 'Food', exact: true }).click();
  await p.getByRole('button', { name: /^Save/ }).last().click();
  await p.getByRole('button', { name: 'Save it' }).click();
  await p.waitForTimeout(400);
};

// 1. Switch on, online: the update screen, with the return time and one button.
srv.status = statusBody(true, 'w1');
await p.goto(APP);
const title = p.getByText('Gastos is updating', { exact: true });
await title.waitFor({ timeout: 15000 });
ok(await p.getByText(/^Back around \d/).isVisible(), '1a shows "Back around <time>"');
ok(await p.getByRole('button', { name: 'Keep logging offline' }).isVisible(), '1b one button: Keep logging offline');
ok(!(await p.getByRole('tab', { name: 'Log' }).isVisible().catch(() => false)), '1c the tabs are hidden behind it');
ok(srv.upserts.length === 0, '1d nothing uploaded while updating: ' + srv.upserts.length);
await p.waitForTimeout(700);
await p.screenshot({ path: `${SHOTS}/updating.png` });
// On a wide laptop screen the button stays centred under the text (Joe's live test found it on the left).
await p.setViewportSize({ width: 1400, height: 900 });
await p.waitForTimeout(300);
const off = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('[role="button"]')].find((e) => e.textContent === 'Keep logging offline').getBoundingClientRect();
  const head = [...document.querySelectorAll('[role="heading"]')].find((e) => e.textContent === 'Gastos is updating').getBoundingClientRect();
  return Math.round(Math.abs(btn.left + btn.width / 2 - (head.left + head.width / 2)));
});
ok(off <= 2, '1e wide screen: the button is centred under the title (off by ' + off + 'px)');
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(300);

// 2. Tap the button: Log, "Sync paused", and the window is remembered.
await p.getByRole('button', { name: 'Keep logging offline' }).click();
await p.getByLabel('Amount').waitFor();
ok(await chip('Sync paused').isVisible(), '2a Log opens with "Sync paused"');
ok((await p.evaluate(() => localStorage.getItem('gastos.v1.updateSeen'))) === 'w1', '2b this window is remembered (w1)');

// 3. Log while paused: saved on the phone, queued, not uploaded, still "Sync paused" (not Offline).
await logOne(150);
ok((await dirty()) === 1, '3a the entry is saved and queued (1 waiting)');
await p.waitForTimeout(2200); // past the 1.5 s sync debounce
ok(srv.upserts.length === 0, '3b nothing uploaded while paused');
ok(await chip('Sync paused').isVisible(), '3c still "Sync paused", not Offline');
await p.screenshot({ path: `${SHOTS}/paused-log.png` });

// 4. Tap the status: the explainer sheet.
await chip('Sync paused').click();
ok(await p.getByText('Joe’s doing some work behind the scenes', { exact: false }).isVisible(), '4a tapping it explains in plain words');
await p.screenshot({ path: `${SHOTS}/paused-sheet.png` });
await p.getByRole('button', { name: 'Got it' }).click();

// 5. Settings: same words, no "Sync now", and renaming past entries says "paused".
await p.getByRole('tab', { name: 'Settings' }).click();
ok(await p.getByText('Sync paused', { exact: true }).isVisible(), '5a Settings card says "Sync paused"');
ok(await p.getByText('Gastos is updating.', { exact: false }).isVisible(), '5b and explains it');
ok(!(await p.getByRole('button', { name: 'Sync now' }).isVisible().catch(() => false)), '5c no "Sync now" while paused');
await p.screenshot({ path: `${SHOTS}/paused-settings.png` });
await p.getByRole('tab', { name: 'Log' }).click();

// 6. Reopen the app in the same window: no screen again, straight to Log, still paused.
await p.reload();
await p.getByLabel('Amount').waitFor({ timeout: 15000 });
// Wait for the server's answer first, so 6a can't pass just because the check hadn't happened yet.
ok(await chip('Sync paused').waitFor({ timeout: 8000 }).then(() => true, () => false), '6b still "Sync paused" after reopening');
ok(!(await title.isVisible()), '6a same window: the screen does not come back');
ok((await dirty()) === 1, '6c the queued entry survived the reopen');

// 7. Switch turns off while she's on Log: next check syncs everything (chip tap = check now).
srv.status = statusBody(false, 'w1');
await chip('Sync paused').click();
await p.getByRole('button', { name: 'Got it' }).click().catch(() => {});
await p.waitForTimeout(2500);
ok(srv.upserts.some((u) => !u.gate && u.n >= 1), '7a switch off: the queue uploads: ' + JSON.stringify(srv.upserts));
ok((await dirty()) === 0, '7b nothing left waiting');
ok(await chip('Synced').isVisible(), '7c back to "Synced"');

// 8. The switch flips between the check and the upload: the database gate refuses, the entry stays queued.
srv.status = statusBody(false, 'w1');
srv.gate = true;
const before = srv.upserts.length;
await logOne(90);
await p.waitForTimeout(2500);
ok(!(await p.getByText('Joe’s doing some work behind the scenes', { exact: false }).isVisible()), '8x the explainer does not pop up by itself');
ok(srv.upserts.length > before && srv.upserts.slice(before).every((u) => u.gate), '8a the upload was tried and refused by the gate');
ok(srv.upserts.length - before <= 3, '8b no retry storm: ' + (srv.upserts.length - before) + ' tries');
ok((await dirty()) === 1, '8c the entry stays queued (not dropped as "bad data")');
ok(await chip('Sync paused').isVisible(), '8d the refusal alone pauses the app');
await p.getByRole('tab', { name: 'Settings' }).click();
ok(!(await p.getByText('couldn’t be saved online', { exact: false }).isVisible().catch(() => false)), '8e no "couldn’t be saved" warning');
await p.getByRole('tab', { name: 'Log' }).click();

// 9. Gate lifts: it syncs.
srv.gate = false;
srv.status = statusBody(false, 'w1');
await chip('Sync paused').click();
await p.getByRole('button', { name: 'Got it' }).click().catch(() => {});
await p.waitForTimeout(2500);
ok((await dirty()) === 0, '9a gate lifted: the entry uploads');

// 10. A new update window: the screen shows again once.
srv.status = statusBody(true, 'w2');
await p.reload();
await title.waitFor({ timeout: 15000 });
ok(true, '10a new window (w2): the screen shows again');

// 11. No signal: a failed check is never "updating". She just sees Log.
srv.status = 'fail';
await p.evaluate(() => localStorage.removeItem('gastos.v1.updateSeen'));
await p.reload();
await p.getByLabel('Amount').waitFor({ timeout: 15000 });
await p.waitForTimeout(5000); // past the 4 s status timeout
ok(!(await title.isVisible()), '11a no signal: no update screen');
ok(!(await chip('Sync paused').isVisible()), '11b and not "Sync paused"');

// 12. Junk answers: only an exact true counts.
srv.status = { ...statusBody(true, 'w3'), updating: 'true' };
await p.reload();
await p.getByLabel('Amount').waitFor({ timeout: 15000 });
await p.waitForTimeout(1500);
ok(!(await title.isVisible()), '12a updating: "true" (a string) is not updating');

ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
console.log('unrouted server calls:', [...new Set(srv.unknown)].join(', ') || 'none');
await b.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
