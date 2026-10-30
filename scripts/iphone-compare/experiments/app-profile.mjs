/**
 * Whole-app CPU profile for one phase of the catalog session, aggregated by
 * self time. PHASE=adds | scroll | draw.
 */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5199/';
const DPR = Number(process.env.DPR || '3');
const PHASE = process.env.PHASE || 'scroll';
const PRELOAD = Number(process.env.PRELOAD || '10');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  deviceScaleFactor: DPR,
  viewport: { width: 430, height: 932 },
});
const page = await ctx.newPage();
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

const preload = PHASE === 'adds' ? 0 : PRELOAD;
for (let i = 0; i < preload; i++) {
  await page.click('[data-add-count="100"]');
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(800);

const client = await ctx.newCDPSession(page);
if (process.env.THROTTLE) {
  await client.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) });
}
await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 100 });
await client.send('Profiler.start');

if (PHASE === 'adds') {
  for (let i = 0; i < PRELOAD; i++) {
    await page.click('[data-add-count="100"]');
    await page.waitForTimeout(1500);
  }
} else if (PHASE === 'scroll') {
  await page.evaluate(async () => {
    const el = document.querySelector('.ticketCatalog');
    for (let i = 1; i <= 80; i++) {
      el.scrollTop = i * 140;
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    await new Promise((r) => setTimeout(r, 900));
  });
} else {
  await page.evaluate(() => document.querySelector('.ticketCatalog').scrollTo({ top: 0 }));
  await page.waitForTimeout(600);
  for (let i = 0; i < 6; i++) {
    await page.click('[data-action="draw"]');
    await page.waitForTimeout(2600);
  }
}

const { profile } = await client.send('Profiler.stop');

const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (const id of profile.samples) {
  const node = byId.get(id);
  if (!node) continue;
  const f = node.callFrame;
  const where = f.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const name = `${f.functionName || '(anonymous)'}  ${where}${where ? `:${f.lineNumber + 1}` : ''}`;
  self.set(name, (self.get(name) ?? 0) + 1);
}
// Total (subtree) time per app function: a sample counts for every app frame
// on its stack, so an orchestrator shows the cost of everything it calls.
const parent = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
const subtree = new Map();
for (const id of profile.samples) {
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const node = byId.get(cur);
    if (!node) break;
    const f = node.callFrame;
    if (!f.url.includes('/src/')) continue;
    const name = `${f.functionName || '(anonymous)'}  ${f.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]}:${f.lineNumber + 1}`;
    if (seen.has(name)) continue;
    seen.add(name);
    subtree.set(name, (subtree.get(name) ?? 0) + 1);
  }
}

const total = profile.samples.length;
const durMs = (profile.endTime - profile.startTime) / 1000;
const idle = (self.get('(idle)  ') ?? 0) + (self.get('(program)  ') ?? 0);
console.log(`\nphase ${PHASE}: ${total} samples over ${durMs.toFixed(0)} ms wall, ${(((total - idle) / total) * 100).toFixed(1)}% busy\n`);
const ms = (count) => `${Math.round((count / total) * durMs)} ms`;
console.log('self time:');
for (const [name, count] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${((count / total) * 100).toFixed(1).padStart(5)}%  ${ms(count).padStart(7)}  ${name}`);
}
console.log('\ntotal time, app frames only:');
for (const [name, count] of [...subtree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)) {
  console.log(`  ${((count / total) * 100).toFixed(1).padStart(5)}%  ${ms(count).padStart(7)}  ${name}`);
}

await browser.close();
