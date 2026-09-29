import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const jobs = [];
for (const m of ['light','dark']) {
  for (const s of ['log','other','confirm','settings','themes','faq']) jobs.push([s,'green',m,`${s}-${m}`]);
  for (const th of ['green','pink','lavender','ocean','teal','coral','sunflower','latte']) jobs.push(['filled',th,m,`theme-${th}-${m}`]);
}
import fs from 'fs'; fs.mkdirSync('out',{recursive:true});
for (const [s,th,m,name] of jobs) {
  await p.goto(`file://${process.cwd()}/mock.html?s=${s}&th=${th}&m=${m}`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `out/${name}.png` });
}
await b.close(); console.log(jobs.length,'shots');
