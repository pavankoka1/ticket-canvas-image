/** Card edge + separator probe on local Chrome at DPR 3, before and after a resize. */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const URL = process.env.CATALOG_URL || 'http://localhost:5173/';
const DPR = Number(process.env.DPR || '3');
const START = { width: Number(process.env.VW || '1280'), height: Number(process.env.VH || '900') };
const AFTER = { width: Number(process.env.VW2 || '430'), height: Number(process.env.VH2 || '932') };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ deviceScaleFactor: DPR, viewport: START });
const page = await context.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (/catalog-svg-warm|host ink|chrome-probe\]/.test(t)) console.log('[page]', t.slice(0, 180));
});
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.__chromeProbe === 'function', null, { timeout: 30000 });
await page.waitForTimeout(Number(process.env.WARM_MS || '20000'));

// Tiles only exist for rows scrolled out of the DOM band.
const scrollAndSettle = async () => {
  await page.evaluate(() => {
    const port = document.querySelector('.ticketCatalog') ?? document.scrollingElement;
    if (port) port.scrollTop = 4000;
  });
  await page.waitForTimeout(2500);
};
await scrollAndSettle();

const before = await page.evaluate(() => window.__chromeProbe());
await page.setViewportSize(AFTER);
await page.waitForTimeout(800);
const resize800 = await page.evaluate(() => window.__chromeProbe());
await page.waitForTimeout(3200);
const resize4s = await page.evaluate(() => window.__chromeProbe());
await page.waitForTimeout(Number(process.env.RESIZE_MS || '16000'));
const after = await page.evaluate(() => window.__chromeProbe());

writeFileSync(
  process.env.OUT || '/tmp/chrome-edge-sep.json',
  JSON.stringify({ before, resize800, resize4s, after }, null, 2),
);
console.log('wrote', process.env.OUT);
await browser.close();
