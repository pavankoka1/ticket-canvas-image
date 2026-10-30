/**
 * CPU profile of the tile paint inner loop, aggregated by self time.
 * Same driver as paint-bench.mjs, but with the V8 sampling profiler on, so the
 * cost of `paintCatalogTicketSvgAll` can be attributed to named functions.
 */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5199/';
const DPR = Number(process.env.DPR || '3');
const PAINTS = Number(process.env.PAINTS || '20000');

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

await page.evaluate(async () => {
  const paint = await import('/src/ticketCatalog/canvas/paint/catalogSvgPaint.ts');
  const layoutMod = await import('/src/ticketCatalog/layout/catalogLayout.ts');
  const boxMod = await import('/src/ticketCatalog/layout/cellBoxModel.ts');
  const layout = layoutMod.getActiveLayout();
  const dpr = boxMod.activeDpr();
  const tickets = [];
  for (let i = 0; i < 24; i++) {
    const hits = i % 4 === 0 ? [] : i % 4 === 1 ? [0, 2] : [0, 1, 3, 4];
    tickets.push({
      id: `bench-${i}`,
      no: String(100 + i),
      balls: [3, 14, 22, 31, 40, 55],
      hits,
      multipliers: i % 4 === 3 ? { 1: 5, 4: 10 } : {},
      win: hits.length >= 2 ? '$120.00' : '',
      disabled: i % 8 === 7,
    });
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.columns * (layout.cardWidth + layout.gap) * dpr);
  canvas.height = Math.round(40 * (layout.metrics.cardHeight + layout.gap) * dpr);
  const c2d = canvas.getContext('2d');
  window.__benchPaint = (n) => {
    for (let i = 0; i < n; i++) {
      paint.paintCatalogTicketSvgAll(
        c2d,
        tickets[i % tickets.length],
        Math.round((i % layout.columns) * (layout.cardWidth + layout.gap) * dpr),
        Math.round((Math.floor(i / layout.columns) % 40) * (layout.metrics.cardHeight + layout.gap) * dpr),
        layout,
        dpr,
      );
    }
  };
  window.__benchPaint(2000);
});

const client = await ctx.newCDPSession(page);
await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 50 });
await client.send('Profiler.start');
await page.evaluate((n) => window.__benchPaint(n), PAINTS);
const { profile } = await client.send('Profiler.stop');

const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) {
  const node = byId.get(profile.samples[i]);
  if (!node) continue;
  const f = node.callFrame;
  const name = `${f.functionName || '(anonymous)'}  ${f.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]}:${f.lineNumber + 1}`;
  self.set(name, (self.get(name) ?? 0) + 1);
}
const total = profile.samples.length;
console.log(`\n${total} samples over ${PAINTS} paints\n`);
for (const [name, count] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) {
  console.log(`  ${((count / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
}

await browser.close();
