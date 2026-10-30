/**
 * Pixel golden for the composited catalog — live DOM band over canvas tiles.
 *
 * `paint-golden.mjs` only covers canvas paint. This one screenshots the whole
 * scrollport at rest through a full session (fresh, scrolled, mid-round,
 * shuffled, resized), so a change to the DOM overlay or the band hand-off has
 * to show up here.
 *
 *   DIR=/tmp/catalog-before bun catalog-golden.mjs
 *   bun catalog-golden.mjs --diff /tmp/catalog-before /tmp/catalog-after
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { PNG } from 'pngjs';

if (process.argv[2] === '--diff') {
  const [dirA, dirB] = [process.argv[3], process.argv[4]];
  const files = readdirSync(dirA).filter((f) => f.endsWith('.png')).sort();
  let clean = 0;
  for (const file of files) {
    let a;
    let b;
    try {
      a = PNG.sync.read(readFileSync(`${dirA}/${file}`));
      b = PNG.sync.read(readFileSync(`${dirB}/${file}`));
    } catch (err) {
      console.log(`  MISS  ${file}: ${err.message}`);
      continue;
    }
    if (a.width !== b.width || a.height !== b.height) {
      console.log(`  SIZE  ${file}: ${a.width}x${a.height} -> ${b.width}x${b.height}`);
      continue;
    }
    let diffPx = 0;
    let firstRow = -1;
    for (let i = 0; i < a.data.length; i += 4) {
      if (
        a.data[i] !== b.data[i] ||
        a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2] ||
        a.data[i + 3] !== b.data[i + 3]
      ) {
        diffPx += 1;
        if (firstRow < 0) firstRow = Math.floor(i / 4 / a.width);
      }
    }
    if (diffPx === 0) clean += 1;
    else console.log(`  DIFF  ${file}: ${diffPx} px, first at device row ${firstRow}`);
  }
  console.log(`${clean}/${files.length} frames pixel-identical`);
  process.exit(clean === files.length ? 0 : 1);
}

const URL = process.env.CATALOG_URL || 'http://localhost:5199/';
const DIR = process.env.DIR || '/tmp/catalog-golden';
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });

for (const [label, width, height, dpr] of [
  ['phone', 390, 844, 3],
  ['desktop', 1440, 820, 2],
]) {
  const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width, height } });
  const page = await ctx.newPage();
  // Same tickets every run, so a pixel difference can only come from code.
  await page.addInitScript(() => {
    let seed = 20261030;
    Math.random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
    null,
    { timeout: 90000 },
  );

  const shot = async (name) => {
    await page.waitForTimeout(400);
    await page
      .locator('.ticketCatalog')
      .screenshot({ path: `${DIR}/${label}-${name}.png`, scale: 'device' });
  };

  await page.click('[data-add-count="100"]');
  await page.waitForTimeout(2500);
  await shot('01-added');

  await page.evaluate(() => document.querySelector('.ticketCatalog').scrollTo({ top: 900 }));
  await page.waitForTimeout(1400);
  await shot('02-scrolled');

  // Mid-scroll draw: hit tickets are split across the DOM band and canvas tiles.
  await page.click('[data-action="draw"]');
  await page.waitForTimeout(2600);
  await shot('03-dab-midscroll');

  await page.evaluate(() => document.querySelector('.ticketCatalog').scrollTo({ top: 0 }));
  await page.waitForTimeout(1400);
  await shot('04-back-to-top');

  // Rounds 3, 5 and 6 are multiplier draws; each one shuffles at the top.
  for (let i = 2; i <= 6; i++) {
    await page.click('[data-action="draw"]');
    await page.waitForTimeout(3000);
  }
  await shot('05-round-over');

  await page.evaluate(() => document.querySelector('.ticketCatalog').scrollTo({ top: 1500 }));
  await page.waitForTimeout(1400);
  await shot('06-scrolled-round-over');

  await page.setViewportSize({ width: Math.round(width * 0.82), height });
  await page.waitForTimeout(2200);
  await shot('07-resized');

  console.log(`${label} ${width}x${height} dpr${dpr}: 7 frames`);
  await ctx.close();
}

console.log(`\nwrote frames to ${DIR}`);
await browser.close();
