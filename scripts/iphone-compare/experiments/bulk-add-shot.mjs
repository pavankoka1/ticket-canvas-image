/** Screenshot the scrollport partway through a +100 bulk add scroll. */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: 3, viewport: { width: 430, height: 932 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
  null,
  { timeout: 90000 },
);
for (let i = 0; i < 5; i++) {
  await page.click('[data-add-count="100"]');
  await page.waitForTimeout(1400);
}
await page.waitForTimeout(1200);

const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });

await page.click('[data-add-count="100"]');
await page.waitForTimeout(950);
const mid = await page.evaluate(() => {
  const s = document.querySelector('.ticketCatalog');
  const host = document.querySelector('.catalog__canvas');
  const live = [...host.querySelectorAll('canvas')].filter((c) => c.width > 0).length;
  return { top: Math.round(s.scrollTop), max: Math.round(s.scrollHeight - s.clientHeight), live };
});
await page.locator('.ticketCatalog').screenshot({ path: 'scripts/iphone-compare/experiments/bulk-add-midscroll.png' });
console.log(`mid-scroll: top=${mid.top} of ${mid.max}, ${mid.live} tiles holding pixels`);

await browser.close();
