/**
 * Interleaved A/B of the tile paint inner loop against two dev servers.
 *
 * Run the baseline in a git worktree on its own port and the change on
 * another, then alternate rounds so both sides see the same machine noise.
 * Reports the minimum per side — the min of many samples is what survives a
 * loaded box; a median still tracks whatever else is running.
 *
 *   A=http://localhost:5200/ B=http://localhost:5199/ ROUNDS=8 bun paint-ab.mjs
 */
import { chromium } from 'playwright-core';

const A = process.env.A || 'http://localhost:5200/';
const B = process.env.B || 'http://localhost:5199/';
const LABEL_A = process.env.LABEL_A || 'before';
const LABEL_B = process.env.LABEL_B || 'after';
const DPR = Number(process.env.DPR || '3');
const PAINTS = Number(process.env.PAINTS || '3000');
const ROUNDS = Number(process.env.ROUNDS || '8');
const INNER = Number(process.env.INNER || '5');

const IN_PAGE = async ({ paints, inner }) => {
  const paint = await import('/src/ticketCatalog/canvas/paint/catalogSvgPaint.ts');
  const layoutMod = await import('/src/ticketCatalog/layout/catalogLayout.ts');
  const boxMod = await import('/src/ticketCatalog/layout/cellBoxModel.ts');
  const layout = layoutMod.getActiveLayout();
  const dpr = boxMod.activeDpr();
  if (!paint.isCatalogSvgPaintReady(layout)) return { error: 'pack not ready' };

  const make = (i) => {
    const hits = i % 4 === 0 ? [] : i % 4 === 1 ? [0, 2] : [0, 1, 3, 4];
    return {
      id: `bench-${i}`,
      no: String(100 + i),
      balls: [3, 14, 22, 31, 40, 55],
      hits,
      multipliers: i % 4 === 3 ? { 1: 5, 4: 10 } : {},
      win: hits.length >= 2 ? '$120.00' : '',
      disabled: i % 8 === 7,
    };
  };
  // Three quarters of the mix carry ink, so this is pessimistic for a catalog
  // that spends most of its life before the first ball.
  const mixed = Array.from({ length: 24 }, (_, i) => make(i));
  const plain = Array.from({ length: 24 }, (_, i) => ({ ...make(i), hits: [], multipliers: {}, win: '' }));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.columns * (layout.cardWidth + layout.gap) * dpr);
  canvas.height = Math.round(40 * (layout.metrics.cardHeight + layout.gap) * dpr);
  const c2d = canvas.getContext('2d');
  c2d.setTransform(1, 0, 0, 1, 0, 0);
  c2d.imageSmoothingEnabled = false;

  const once = (tickets) => {
    const t0 = performance.now();
    for (let i = 0; i < paints; i++) {
      paint.paintCatalogTicketSvgAll(
        c2d,
        tickets[i % tickets.length],
        Math.round((i % layout.columns) * (layout.cardWidth + layout.gap) * dpr),
        Math.round((Math.floor(i / layout.columns) % 40) * (layout.metrics.cardHeight + layout.gap) * dpr),
        layout,
        dpr,
      );
    }
    return performance.now() - t0;
  };

  once(mixed);
  once(plain);
  const out = { mixed: Infinity, plain: Infinity };
  for (let r = 0; r < inner; r++) {
    out.mixed = Math.min(out.mixed, once(mixed));
    out.plain = Math.min(out.plain, once(plain));
  }
  return { cardW: layout.cardWidth, dpr, ...out };
};

/**
 * One browser per sample. Two pages in one browser skew each other badly —
 * whichever opened first kept winning — so each side gets its own process and
 * the sides alternate, which keeps machine drift common to both.
 */
async function sample(url) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ctx = await browser.newContext({ deviceScaleFactor: DPR, viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
      null,
      { timeout: 90000 },
    );
    return await page.evaluate(IN_PAGE, { paints: PAINTS, inner: INNER });
  } finally {
    await browser.close();
  }
}

const best = { [LABEL_A]: { mixed: Infinity, plain: Infinity }, [LABEL_B]: { mixed: Infinity, plain: Infinity } };
let card = '';
for (let r = 0; r < ROUNDS; r++) {
  for (const [label, url] of [
    [LABEL_A, A],
    [LABEL_B, B],
  ]) {
    const got = await sample(url);
    if (got.error) throw new Error(`${label}: ${got.error}`);
    card = `${got.cardW}px/dpr${got.dpr}`;
    best[label].mixed = Math.min(best[label].mixed, got.mixed);
    best[label].plain = Math.min(best[label].plain, got.plain);
  }
}

const us = (ms) => +((ms / PAINTS) * 1000).toFixed(2);
console.log(
  `\n${PAINTS} paints at ${card}, best of ${ROUNDS * INNER} samples ` +
    `across ${ROUNDS} alternating browser launches per side\n`,
);
for (const mix of ['plain', 'mixed']) {
  const a = us(best[LABEL_A][mix]);
  const b = us(best[LABEL_B][mix]);
  const delta = (((b - a) / a) * 100).toFixed(1);
  console.log(
    `  ${mix.padEnd(6)}  ${LABEL_A} ${String(a).padStart(7)} µs/ticket   ` +
      `${LABEL_B} ${String(b).padStart(7)} µs/ticket   ${delta > 0 ? '+' : ''}${delta}%`,
  );
}
