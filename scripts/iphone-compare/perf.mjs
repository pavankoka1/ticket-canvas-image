/**
 * Production /compare timing: cold IndexedDB + reload (local Chrome).
 *
 *   npm run build && npm run preview -- --host 127.0.0.1 --port 4173
 *   COMPARE_URL=http://127.0.0.1:4173/compare node scripts/iphone-compare/perf.mjs
 */
import { chromium } from 'playwright-core';

const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.COMPARE_URL || 'http://127.0.0.1:4173/compare';
const DPR = Number(process.env.DPR || '2');
const MODE = 'svg-all';

async function clearAtlasDb(page) {
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('bingo-cell-atlas');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });
}

async function waitToolbarReady(page) {
  await page.waitForFunction(
    () => {
      const t = document.querySelector('.compare__status')?.textContent ?? '';
      return t.includes('ready ·');
    },
    { timeout: 180_000 },
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        'section[data-renderer] canvas[data-ready="true"]',
      ).length >= 6,
    { timeout: 180_000 },
  );
}

async function runOnce(page, label) {
  const atlasLogs = [];
  const handler = (msg) => {
    const text = msg.text();
    if (text.includes('[atlas-warm]')) {
      atlasLogs.push(text);
      console.log(text);
    }
  };
  page.on('console', handler);

  const t0 = performance.now();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('select').nth(1).selectOption(MODE);
  await waitToolbarReady(page);
  const ms = Math.round(performance.now() - t0);

  page.off('console', handler);
  console.log(JSON.stringify({ label, ms, atlasWarmLines: atlasLogs.length }));
  return { ms, atlasLogs };
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [`--force-device-scale-factor=${DPR}`, '--window-size=1400,1200'],
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  const page = await context.newPage();

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await clearAtlasDb(page);

  const cold = await runOnce(page, 'cold');
  const reload = await runOnce(page, 'reload');

  console.log(
    JSON.stringify(
      {
        url: URL,
        dpr: DPR,
        mode: MODE,
        coldMs: cold.ms,
        reloadMs: reload.ms,
        coldAtlasWarm: cold.atlasLogs,
        reloadAtlasWarm: reload.atlasLogs,
      },
      null,
      2,
    ),
  );

  await browser.close();
}

await main();
