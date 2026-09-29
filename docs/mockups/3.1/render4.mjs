import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const jobs = [];
for (const m of ['light','dark']) for (const s of ['hero','herofilled']) jobs.push([s,'green',m,`r4-${s}-${m}`]);
jobs.push(['herofilled','pink','light','r4-herofilled-pink'], ['hero','green','light','r4-hero-740', 740], ['hero','green','light','r4-hero-667', 667], ['hero','green','light','r4-hero-915', 915]);
for (const [s,th,m,name,h] of jobs) {
  const p = await b.newPage({ viewport: { width: 390, height: h || 844 }, deviceScaleFactor: 2 });
  await p.goto(`file://${process.cwd()}/mock.html?s=${s}&th=${th}&m=${m}`);
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150);
  await p.screenshot({ path: `out/${name}.png` });
  await p.close();
}
await b.close();
