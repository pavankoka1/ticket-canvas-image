/**
 * End-to-end main-thread budget for one fixed catalog session.
 *
 * Drives the same script every run — warm, 1000 tickets, a full scroll sweep,
 * six draws — and reports CDP's scripting/style/layout totals plus the frame
 * deltas observed during the sweep. Run before and after a change; the ticket
 * data is seeded so the only variable is the code.
 *
 *   CATALOG_URL=http://localhost:5199/ LABEL=before node perf-budget.mjs
 */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5199/';
const LABEL = process.env.LABEL || 'run';
const DPR = Number(process.env.DPR || '3');
const REPEATS = Number(process.env.REPEATS || '3');

const SEED_SCRIPT = () => {
  let seed = 123456789;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
};

/** rAF deltas while the catalog is driven through a scripted scroll sweep. */
const SWEEP = async ({ stepPx, stepCount, stepMs }) => {
  const el = document.querySelector('.ticketCatalog');
  const frames = [];
  let last = performance.now();
  let running = true;
  const tick = (now) => {
    frames.push(now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  for (let i = 1; i <= stepCount; i++) {
    el.scrollTop = i * stepPx;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  running = false;
  await new Promise((r) => setTimeout(r, 50));
  // The first delta is the gap since the sweep started, not a rendered frame.
  return frames.slice(1);
};

async function metrics(client) {
  const { metrics: list } = await client.send('Performance.getMetrics');
  const pick = (name) => list.find((m) => m.name === name)?.value ?? 0;
  return {
    script: pick('ScriptDuration'),
    style: pick('RecalcStyleDuration'),
    layout: pick('LayoutDuration'),
    task: pick('TaskDuration'),
    nodes: pick('Nodes'),
    jsHeap: pick('JSHeapUsedSize'),
  };
}

async function runOnce() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    deviceScaleFactor: DPR,
    viewport: { width: 430, height: 932 },
  });
  const page = await ctx.newPage();
  await page.addInitScript(SEED_SCRIPT);

  const client = await ctx.newCDPSession(page);
  await client.send('Performance.enable');

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
    null,
    { timeout: 90000 },
  );
  const warmMs = Date.now() - t0;
  const afterWarm = await metrics(client);

  for (let i = 0; i < 10; i++) {
    await page.click('[data-add-count="100"]');
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(800);
  const afterAdds = await metrics(client);

  await page.evaluate(() => document.querySelector('.ticketCatalog').scrollTo({ top: 0 }));
  await page.waitForTimeout(600);

  const frames = await page.evaluate(SWEEP, { stepPx: 160, stepCount: 60, stepMs: 50 });
  await page.waitForTimeout(800);
  const afterScroll = await metrics(client);

  await page.evaluate(() => document.querySelector('.ticketCatalog').scrollTo({ top: 0 }));
  await page.waitForTimeout(700);
  for (let i = 0; i < 6; i++) {
    await page.click('[data-action="draw"]');
    await page.waitForTimeout(2600);
  }
  const afterDraws = await metrics(client);

  await browser.close();

  const span = (a, b) => ({
    script: +(b.script - a.script).toFixed(3),
    style: +(b.style - a.style).toFixed(3),
    layout: +(b.layout - a.layout).toFixed(3),
    task: +(b.task - a.task).toFixed(3),
  });

  const sorted = [...frames].sort((x, y) => x - y);
  const at = (q) => +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0).toFixed(1);

  return {
    warmMs,
    warm: span({ script: 0, style: 0, layout: 0, task: 0 }, afterWarm),
    adds: span(afterWarm, afterAdds),
    scroll: span(afterAdds, afterScroll),
    draws: span(afterScroll, afterDraws),
    total: span({ script: 0, style: 0, layout: 0, task: 0 }, afterDraws),
    heapMb: +(afterDraws.jsHeap / 1048576).toFixed(1),
    frames: {
      count: frames.length,
      p50: at(0.5),
      p95: at(0.95),
      max: +Math.max(...frames).toFixed(1),
      over32: frames.filter((f) => f > 32).length,
      over50: frames.filter((f) => f > 50).length,
    },
  };
}

const runs = [];
for (let i = 0; i < REPEATS; i++) runs.push(await runOnce());

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const med = (path) => +median(runs.map((r) => path.split('.').reduce((o, k) => o[k], r))).toFixed(2);

console.log(`\n${LABEL}  (median of ${REPEATS} runs, dpr ${DPR}, 1000 tickets)`);
console.log(`  warm to canvas-ready   ${med('warmMs')} ms`);
for (const phase of ['warm', 'adds', 'scroll', 'draws', 'total']) {
  console.log(
    `  ${phase.padEnd(7)} script ${String(med(`${phase}.script`)).padStart(7)}s` +
      `  style ${String(med(`${phase}.style`)).padStart(6)}s` +
      `  layout ${String(med(`${phase}.layout`)).padStart(6)}s` +
      `  task ${String(med(`${phase}.task`)).padStart(7)}s`,
  );
}
console.log(
  `  scroll frames          p50 ${med('frames.p50')}ms  p95 ${med('frames.p95')}ms  ` +
    `max ${med('frames.max')}ms  >32ms ${med('frames.over32')}  >50ms ${med('frames.over50')}`,
);
console.log(`  js heap after draws    ${med('heapMb')} MB\n`);
