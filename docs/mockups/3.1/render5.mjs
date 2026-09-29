import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
for (const m of ['light','dark']) for (const s of ['olist','oedit']) {
  await p.goto(`file://${process.cwd()}/mock.html?s=${s}&th=green&m=${m}`);
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150);
  await p.screenshot({ path: `out/r${s==='olist'?'2':'5'}-${s}-${m}.png` });
}
await b.close();
