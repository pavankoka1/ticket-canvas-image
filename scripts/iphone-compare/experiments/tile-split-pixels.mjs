/**
 * Does the tile split move any canvas pixel? Seeds the ticket data, parks the
 * scroll, composites every tile into one bitmap and hashes it. Run once per
 * `canvasTileTickets` value and compare the hashes.
 */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5173/';
const LABEL = process.env.LABEL || 'run';
const TOP = Number(process.env.TOP || '1200');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: 3, viewport: { width: 430, height: 932 } });
const page = await ctx.newPage();

// Same tickets in every run, so a pixel difference can only come from paint.
await page.addInitScript(() => {
  let seed = 123456789;
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
await page.click('[data-add-count="100"]');
await page.waitForTimeout(2500);
await page.evaluate((top) => document.querySelector('.ticketCatalog').scrollTo({ top }), TOP);
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  const host = document.querySelector('.catalog__canvas');
  const tiles = [...host.querySelectorAll('canvas')].filter((c) => c.width > 0);
  // Composite every live tile at its content offset, so the result is independent
  // of how the catalog happens to be split into tiles.
  const dpr = 3;
  let maxBottom = 0;
  const placed = tiles.map((c) => {
    const m = /translate3d\(0px,\s*([-\d.]+)px/.exec(c.style.transform);
    const y = Math.round(Number(m?.[1] ?? 0) * dpr);
    maxBottom = Math.max(maxBottom, y + c.height);
    return { c, y };
  });
  const width = Math.max(...tiles.map((c) => c.width));
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = maxBottom;
  const sctx = sheet.getContext('2d');
  sctx.imageSmoothingEnabled = false;
  for (const { c, y } of placed) sctx.drawImage(c, 0, y);
  const data = sctx.getImageData(0, 0, sheet.width, sheet.height).data;
  // FNV-1a over the composited pixels.
  let hash = 2166136261;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) ink += 1;
    for (let k = 0; k < 4; k++) {
      hash ^= data[i + k];
      hash = Math.imul(hash, 16777619);
    }
  }
  // Card placement shows up as which device rows and columns carry ink. Digits
  // only add ink inside an already opaque card, so these profiles isolate
  // geometry from content — a one-pixel shift anywhere changes them.
  const rowSpans = [];
  let runStart = -1;
  for (let y = 0; y < sheet.height; y++) {
    let lit = false;
    for (let x = 0; x < sheet.width; x++) {
      if (data[(y * sheet.width + x) * 4 + 3] > 0) {
        lit = true;
        break;
      }
    }
    if (lit && runStart < 0) runStart = y;
    if (!lit && runStart >= 0) {
      rowSpans.push([runStart, y - 1]);
      runStart = -1;
    }
  }
  if (runStart >= 0) rowSpans.push([runStart, sheet.height - 1]);

  const colSpans = [];
  const probeRow = rowSpans[0] ? Math.floor((rowSpans[0][0] + rowSpans[0][1]) / 2) : 0;
  runStart = -1;
  for (let x = 0; x < sheet.width; x++) {
    const lit = data[(probeRow * sheet.width + x) * 4 + 3] > 0;
    if (lit && runStart < 0) runStart = x;
    if (!lit && runStart >= 0) {
      colSpans.push([runStart, x - 1]);
      runStart = -1;
    }
  }
  if (runStart >= 0) colSpans.push([runStart, sheet.width - 1]);

  const cards = [...document.querySelectorAll('.catalog__dom .ticketCard')]
    .slice(0, 2)
    .map((c) => c.textContent.replace(/\s+/g, ' ').trim());

  return {
    tiles: tiles.length,
    sheet: `${sheet.width}×${sheet.height}`,
    hash: (hash >>> 0).toString(16),
    ink,
    rowSpans: JSON.stringify(rowSpans),
    colSpans: JSON.stringify(colSpans),
    cards,
  };
});

const fnv = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
};
console.log(`${LABEL}: ${out.tiles} live tiles, sheet ${out.sheet}, ink ${out.ink} px`);
console.log(`  row spans  ${fnv(out.rowSpans)}  (${JSON.parse(out.rowSpans).length} bands)`);
console.log(`  col spans  ${fnv(out.colSpans)}  ${out.colSpans}`);
console.log(`  pixel hash ${out.hash}`);
console.log(`  first cards: ${out.cards.join(' / ')}`);

await browser.close();
