/**
 * Frame timing through a full six-ball draw, under CPU throttling.
 *
 * The draw gesture runs on WAAPI, so a dropped frame shows as a long gap
 * between rAF callbacks. Reports the gap distribution for each ball plus the
 * shuffle that follows it.
 *
 *   CATALOG_URL=http://localhost:5199/ THROTTLE=6 bun draw-frames.mjs
 */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5199/';
const DPR = Number(process.env.DPR || '3');
const THROTTLE = Number(process.env.THROTTLE || '6');
const TICKETS = Number(process.env.TICKETS || '3');
const LABEL = process.env.LABEL || 'run';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: DPR, viewport: { width: 430, height: 932 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  let seed = 987654321;
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
for (let i = 0; i < TICKETS; i++) {
  await page.click('[data-add-count="100"]');
  await page.waitForTimeout(1500);
}
await page.evaluate(() => document.querySelector('.ticketCatalog').scrollTo({ top: 0 }));
await page.waitForTimeout(800);

const client = await ctx.newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

await page.evaluate(() => {
  window.__frames = [];
  window.__t0 = performance.now();
  let last = performance.now();
  const tick = (now) => {
    window.__frames.push([now - window.__t0, now - last]);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const rounds = [];
for (let ball = 1; ball <= 6; ball++) {
  await page.evaluate(() => {
    window.__frames.length = 0;
    window.__t0 = performance.now();
  });
  await page.click('[data-action="draw"]');
  await page.waitForTimeout(3200);
  const entries = (await page.evaluate(() => window.__frames)).slice(1);
  const frames = entries.map(([, gap]) => gap);
  const sorted = [...frames].sort((a, b) => a - b);
  rounds.push({
    ball,
    n: frames.length,
    p50: +(sorted[Math.floor(sorted.length * 0.5)] ?? 0).toFixed(1),
    p95: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
    max: +Math.max(...frames, 0).toFixed(1),
    over50: frames.filter((f) => f > 50).length,
    over100: frames.filter((f) => f > 100).length,
    // Where in the ball the stalls land, as "ms after the click: gap".
    when: entries
      .filter(([, gap]) => gap > 50)
      .map(([at, gap]) => `${Math.round(at)}ms:${Math.round(gap)}`)
      .join(' '),
  });
}

console.log(`\n${LABEL}: six-ball draw at ${THROTTLE}x CPU throttle, ${TICKETS * 100} tickets\n`);
for (const r of rounds) {
  console.log(
    `  ball ${r.ball}  ${String(r.n).padStart(3)} frames   p50 ${String(r.p50).padStart(5)}ms   ` +
      `p95 ${String(r.p95).padStart(6)}ms   max ${String(r.max).padStart(6)}ms   ` +
      `>50ms ${String(r.over50).padStart(2)}   stalls at ${r.when || '—'}`,
  );
}
const all = rounds.reduce((a, r) => a + r.over100, 0);
console.log(`\n  frames over 100 ms across the round: ${all}\n`);

await browser.close();
