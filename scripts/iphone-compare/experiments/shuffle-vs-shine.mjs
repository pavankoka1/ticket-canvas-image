/** Does the shuffle FLIP start before the shine animation finishes? */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5173/';
const DPR = Number(process.env.DPR || '3');
const SLOWDOWN = Number(process.env.SLOWDOWN || '1');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: DPR, viewport: { width: 430, height: 932 } });
const page = await ctx.newPage();

await page.addInitScript(() => {
  const events = [];
  window.__animEvents = events;
  const base = Element.prototype.animate;
  Element.prototype.animate = function patched(keyframes, options) {
    const anim = base.call(this, keyframes, options);
    const cls = this.className && String(this.className);
    const kind = /shineBand/.test(cls || '')
      ? 'shine'
      : /sparkle/i.test(cls || '')
        ? 'sparkle'
        : /ticketCard$|ticketCard /.test(cls || '') && JSON.stringify(keyframes).includes('translate')
          ? 'flip'
          : null;
    if (kind) {
      const createdAt = performance.now();
      events.push({ kind, phase: 'create', t: createdAt });
      anim.finished.then(
        () => events.push({ kind, phase: 'finish', t: performance.now() }),
        () => {},
      );
    }
    return anim;
  };
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
  null,
  { timeout: 90000 },
);
// Enough tickets that a draw produces winners and a reorder.
await page.click('[data-add-count="100"]');
await page.waitForTimeout(5000);
await page.evaluate(() => document.querySelector('.ticketCatalog').scrollTo({ top: 0 }));
await page.waitForTimeout(500);

if (SLOWDOWN > 1) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
  console.log(`CPU throttled ${SLOWDOWN}×`);
}

for (let round = 1; round <= 6; round++) {
  await page.evaluate(() => (window.__animEvents.length = 0));
  await page.click('[data-action="draw"]');
  await page.waitForTimeout(4000);
  const events = await page.evaluate(() => window.__animEvents.slice());
  const lastShine = Math.max(...events.filter((e) => e.kind === 'shine' && e.phase === 'finish').map((e) => e.t), -Infinity);
  const lastSpark = Math.max(...events.filter((e) => e.kind === 'sparkle' && e.phase === 'finish').map((e) => e.t), -Infinity);
  const firstFlip = Math.min(...events.filter((e) => e.kind === 'flip' && e.phase === 'create').map((e) => e.t), Infinity);
  const gestureEnd = Math.max(lastShine, lastSpark);
  const counts = events.reduce((acc, e) => ((acc[`${e.kind}:${e.phase}`] = (acc[`${e.kind}:${e.phase}`] || 0) + 1), acc), {});
  if (!Number.isFinite(firstFlip) || !Number.isFinite(gestureEnd)) {
    console.log(`round ${round}: nothing to compare — ${JSON.stringify(counts)}`);
    continue;
  }
  const gap = firstFlip - gestureEnd;
  console.log(
    `round ${round}: gesture ends at ${gestureEnd.toFixed(0)}, flip starts at ${firstFlip.toFixed(0)} → ` +
      (gap >= 0 ? `OK, ${gap.toFixed(0)}ms after` : `OVERLAP, ${(-gap).toFixed(0)}ms early`),
  );
}

// The round must leave the canvas visible: the restore now races the shuffle.
await page.waitForTimeout(2500);
const canvasState = await page.evaluate(() => {
  const host = document.querySelector('.catalog__canvas');
  return {
    visibility: getComputedStyle(host).visibility,
    tiles: host.querySelectorAll('canvas').length,
  };
});
console.log(`after round: canvas ${canvasState.visibility}, ${canvasState.tiles} tiles`);
await page.evaluate(() => document.querySelector('.ticketCatalog').scrollTo({ top: 4000 }));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/iphone-compare/experiments/shuffle-after-round.png' });

await browser.close();
