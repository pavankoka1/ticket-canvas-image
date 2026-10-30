/**
 * What a post-gesture canvas restore costs before it paints anything.
 *
 * The draw hides and `clear()`s the tile pool so WAAPI owns the GPU, so every
 * in-view tile has to reallocate its backing store on the way back. This
 * reports the real tile sizes and times the bare allocate-and-zero.
 */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5199/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });

for (const [label, width, height, dpr] of [
  ['phone', 390, 844, 3],
  ['desktop', 1440, 820, 2],
]) {
  const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
    null,
    { timeout: 90000 },
  );
  await page.click('[data-add-count="100"]');
  await page.waitForTimeout(2500);

  const out = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('canvas')].filter((c) => c.width > 0);
    const scrollH = document.querySelector('.ticketCatalog')?.clientHeight ?? 0;
    const sizes = tiles.map((c) => ({ w: c.width, h: c.height, mb: (c.width * c.height * 4) / 1e6 }));
    if (sizes.length === 0) return { sizes, scrollH, allocMs: 0 };
    // Time allocate + implicit zero-fill for one tile of the real size.
    const { w, h } = sizes[0];
    const probe = document.createElement('canvas');
    const pctx = probe.getContext('2d');
    let best = Infinity;
    for (let i = 0; i < 12; i++) {
      const t = performance.now();
      probe.width = w;
      probe.height = h;
      pctx.clearRect(0, 0, w, h);
      // Force the buffer to actually exist before stopping the clock.
      pctx.getImageData(w - 1, h - 1, 1, 1);
      best = Math.min(best, performance.now() - t);
    }
    return { sizes, scrollH, allocMs: best };
  });

  const liveMb = out.sizes.reduce((a, s) => a + s.mb, 0);
  console.log(
    `${label} ${width}x${height} dpr${dpr}: scrollport ${out.scrollH} css px\n` +
      `  ${out.sizes.length} live tiles, ${liveMb.toFixed(1)} MB total\n` +
      `  tile ${out.sizes[0]?.w}x${out.sizes[0]?.h} device px = ${out.sizes[0]?.mb.toFixed(1)} MB ` +
      `(${(out.sizes[0]?.h / dpr / (out.scrollH || 1)).toFixed(1)}x the scrollport)\n` +
      `  allocate + zero one tile: ${out.allocMs.toFixed(1)} ms (best of 12, unthrottled)`,
  );
  await ctx.close();
}

await browser.close();
