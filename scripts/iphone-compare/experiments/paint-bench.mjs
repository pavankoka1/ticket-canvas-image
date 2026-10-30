/**
 * Per-ticket cost of `paintCatalogTicketSvgAll`, the tile paint inner loop.
 *
 * Pulls the module straight out of the Vite dev graph (dev only — nothing is
 * added to shipped code), then paints a fixed mix of faces into a scratch
 * canvas the size of one tile. Reports microseconds per ticket, so a change to
 * the paint path shows up without the noise of scroll, warm and layout.
 *
 *   CATALOG_URL=http://localhost:5199/ LABEL=before bun paint-bench.mjs
 */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5199/';
const LABEL = process.env.LABEL || 'run';
const DPR = Number(process.env.DPR || '3');
const PAINTS = Number(process.env.PAINTS || '4000');
const REPEATS = Number(process.env.REPEATS || '5');

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

const result = await page.evaluate(async ({ paints, repeats }) => {
  const paint = await import('/src/ticketCatalog/canvas/paint/catalogSvgPaint.ts');
  const layoutMod = await import('/src/ticketCatalog/layout/catalogLayout.ts');
  const boxMod = await import('/src/ticketCatalog/layout/cellBoxModel.ts');

  const layout = layoutMod.getActiveLayout();
  const dpr = boxMod.activeDpr();
  if (!paint.isCatalogSvgPaintReady(layout)) return { error: 'paint pack not ready' };

  // One of each face and ink state, so the mix matches a mid-round catalog.
  const tickets = [];
  for (let i = 0; i < 24; i++) {
    const hits = i % 4 === 0 ? [] : i % 4 === 1 ? [0, 2] : [0, 1, 3, 4];
    const multipliers = i % 4 === 3 ? { 1: 5, 4: 10 } : {};
    tickets.push({
      id: `bench-${i}`,
      no: String(100 + i),
      balls: [3, 14, 22, 31, 40, 55],
      hits,
      multipliers,
      win: hits.length >= 2 ? '$120.00' : '',
      disabled: i % 8 === 7,
    });
  }

  const cardW = layout.cardWidth;
  const cardH = layout.metrics.cardHeight;
  const cols = layout.columns;
  const rows = Math.ceil(paints / cols);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((cols * (cardW + layout.gap)) * dpr);
  canvas.height = Math.min(16384, Math.round(Math.min(rows, 40) * (cardH + layout.gap) * dpr));
  const c2d = canvas.getContext('2d');

  const once = () => {
    const t0 = performance.now();
    for (let i = 0; i < paints; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols) % 40;
      paint.paintCatalogTicketSvgAll(
        c2d,
        tickets[i % tickets.length],
        Math.round(col * (cardW + layout.gap) * dpr),
        Math.round(row * (cardH + layout.gap) * dpr),
        layout,
        dpr,
      );
    }
    return performance.now() - t0;
  };

  once(); // warm JIT and the header-measure cache for these ticket numbers
  const samples = [];
  for (let r = 0; r < repeats; r++) samples.push(once());
  samples.sort((a, b) => a - b);

  return {
    paints,
    cardW,
    dpr,
    medianMs: +samples[Math.floor(samples.length / 2)].toFixed(2),
    bestMs: +samples[0].toFixed(2),
    perTicketUs: +((samples[Math.floor(samples.length / 2)] / paints) * 1000).toFixed(2),
  };
}, { paints: PAINTS, repeats: REPEATS });

if (result.error) console.log(`${LABEL}: ${result.error}`);
else
  console.log(
    `${LABEL}: ${result.paints} paints at ${result.cardW}px/dpr${result.dpr} — ` +
      `median ${result.medianMs} ms, best ${result.bestMs} ms, ${result.perTicketUs} µs/ticket`,
  );

await browser.close();
