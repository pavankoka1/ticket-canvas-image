/** G2: svg-all optimized vs full row — local Chrome, all presets (Playwright). */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.env.OUT;
const URL = `${process.env.COMPARE_URL || 'http://localhost:5173/compare'}`;
const DPR = Number(process.env.DPR || '2');
const PRESETS = ['desktopMedium', 'desktopSmall', 'mobile', 'mobileLarge', 'mobileCompact'];
const TICKETS = ['cmp-normal', 'cmp-dab', 'cmp-disabled'];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [`--force-device-scale-factor=${DPR}`],
});
const context = await browser.newContext({ deviceScaleFactor: DPR });
const page = await context.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.locator('select').nth(1).selectOption('svg-all');

const results = {};
for (const preset of PRESETS) {
  await page.locator('select').nth(0).selectOption(preset);
  await page.waitForTimeout(12000);
  const presetOut = {};
  for (const tid of TICKETS) {
    const stat = await page.evaluate((ticketId) => {
      const ref = document.querySelector(`[data-renderer=full][data-ticket="${ticketId}"] canvas`);
      const opt = document.querySelector(`[data-renderer=optimized][data-ticket="${ticketId}"] canvas`);
      if (!ref?.dataset.ready || !opt?.dataset.ready) return { err: 'not ready' };
      const w = ref.width;
      const h = ref.height;
      const r = ref.getContext('2d').getImageData(0, 0, w, h).data;
      const o = opt.getContext('2d').getImageData(0, 0, w, h).data;
      let changed = 0;
      let max = 0;
      let header = 0;
      const headerEnd = Math.round(26 * (w / ref.width));
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          let d = false;
          for (let c = 0; c < 4; c++) {
            const delta = Math.abs(r[i + c] - o[i + c]);
            if (delta) d = true;
            max = Math.max(max, delta);
          }
          if (!d) continue;
          changed++;
          if (y <= 26) header++;
        }
      return { changed, max, header, body: changed - header };
    }, tid);
    presetOut[tid] = stat;
  }
  results[preset] = presetOut;
  console.log('preset', preset, JSON.stringify(presetOut));
}

writeFileSync(`${OUT}/g2-dpr${DPR}.json`, JSON.stringify(results, null, 2));
await browser.close();
