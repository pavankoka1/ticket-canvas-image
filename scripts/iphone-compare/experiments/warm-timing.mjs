/** Time-to-canvas-ready, cold IDB then warm IDB, at DPR 3. */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5173/';
const DPR = Number(process.env.DPR || '3');
const VIEWPORT = { width: Number(process.env.VW || '430'), height: Number(process.env.VH || '932') };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ deviceScaleFactor: DPR, viewport: VIEWPORT });
const page = await context.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (/atlas-warm|catalog-svg-warm|catalog-warm/.test(t)) console.log('  [page]', t.slice(0, 160));
});

const timeToReady = async (label) => {
  const t0 = Date.now();
  await page.waitForFunction(
    () => document.querySelector('.stat strong, .toolbar strong') !== null,
    null,
    { timeout: 60000 },
  ).catch(() => {});
  await page
    .waitForFunction(
      () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
      null,
      { timeout: 90000 },
    )
    .catch(() => console.log(`  ${label}: never reached ready`));
  console.log(`${label}: canvas ready in ${Date.now() - t0} ms`);
};

console.log('--- cold (empty IDB) ---');
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await timeToReady('cold');

console.log('--- warm (IDB populated) ---');
await page.reload({ waitUntil: 'domcontentloaded' });
await timeToReady('warm');

console.log('--- warm again ---');
await page.reload({ waitUntil: 'domcontentloaded' });
await timeToReady('warm2');

await browser.close();
