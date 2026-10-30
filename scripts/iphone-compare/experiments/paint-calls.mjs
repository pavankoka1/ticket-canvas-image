/**
 * Exact canvas-2D call counts for one `paintCatalogTicketSvgAll`, per face and
 * ink state. The profile says the paint path is ~94% canvas API, so the only
 * useful question is how many calls there are and how big each blit is.
 */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5199/';
const DPR = Number(process.env.DPR || '3');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  deviceScaleFactor: DPR,
  viewport: { width: 430, height: 932 },
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
  null,
  { timeout: 90000 },
);

const out = await page.evaluate(async () => {
  const paint = await import('/src/ticketCatalog/canvas/paint/catalogSvgPaint.ts');
  const layoutMod = await import('/src/ticketCatalog/layout/catalogLayout.ts');
  const boxMod = await import('/src/ticketCatalog/layout/cellBoxModel.ts');
  const layout = layoutMod.getActiveLayout();
  const dpr = boxMod.activeDpr();

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.cardWidth * dpr) + 32;
  canvas.height = Math.round(layout.metrics.cardHeight * dpr) + 32;
  const real = canvas.getContext('2d');

  const cases = {
    'plain (no hits)': { hits: [], multipliers: {}, win: '', disabled: false },
    'gold, 3 dabs': { hits: [0, 2, 4], multipliers: {}, win: '$150.00', disabled: false },
    'gold, 2 multipliers': { hits: [0, 1, 3, 4], multipliers: { 1: 5, 4: 10 }, win: '$6000.00', disabled: false },
    'disabled (round over)': { hits: [1], multipliers: {}, win: '', disabled: true },
  };

  const report = {};
  for (const [label, shape] of Object.entries(cases)) {
    const calls = [];
    const spy = new Proxy(real, {
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        return (...args) => {
          if (prop === 'drawImage') {
            const w = args.length >= 8 ? args[7] : (args[1]?.width ?? 0);
            const h = args.length >= 8 ? args[8] : (args[1]?.height ?? 0);
            calls.push(`drawImage ${Math.round(w)}x${Math.round(h)}`);
          } else {
            calls.push(prop);
          }
          return value.apply(target, args);
        };
      },
    });

    paint.paintCatalogTicketSvgAll(
      spy,
      { id: 'x', no: '847', balls: [3, 14, 22, 31, 40, 55], ...shape },
      0,
      0,
      layout,
      dpr,
    );

    const byName = {};
    let blitPixels = 0;
    for (const c of calls) {
      const head = c.split(' ')[0];
      byName[head] = (byName[head] ?? 0) + 1;
      const size = /drawImage (\d+)x(\d+)/.exec(c);
      if (size) blitPixels += Number(size[1]) * Number(size[2]);
    }
    report[label] = { total: calls.length, byName, blitPixels, detail: calls };
  }
  return { report, card: `${layout.cardWidth}x${layout.metrics.cardHeight}`, dpr };
});

console.log(`\ncard ${out.card} css at dpr ${out.dpr}\n`);
for (const [label, r] of Object.entries(out.report)) {
  console.log(`${label}: ${r.total} canvas calls, ${(r.blitPixels / 1000).toFixed(0)}k blit px`);
  console.log(`  ${Object.entries(r.byName).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
  console.log(`  ${r.detail.join(' · ')}\n`);
}

await browser.close();
