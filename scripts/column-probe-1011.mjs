import { chromium, webkit } from "playwright";

const URL = process.env.CATALOG_URL ?? "http://localhost:5175/";

async function probe(launch, w, h) {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const data = await page.evaluate(() => ({
    inner: [window.innerWidth, window.innerHeight],
    vv: window.visualViewport
      ? [window.visualViewport.width, window.visualViewport.height]
      : null,
    mqLandscape: window.matchMedia("(orientation: landscape)").matches,
    aspectLandscape: window.innerWidth > window.innerHeight,
    layout: [...document.querySelectorAll("strong")].find((s) =>
      s.textContent?.includes("col"),
    )?.textContent,
    frameW: document.querySelector(".catalogFrame")?.clientWidth,
  }));
  await browser.close();
  return data;
}

for (const [w, h] of [
  [1011, 700],
  [1011, 1100],
  [1024, 700],
]) {
  const chromiumR = await probe(() => chromium.launch({ headless: true }), w, h);
  const webkitR = await probe(() => webkit.launch({ headless: true }), w, h);
  console.log(JSON.stringify({ w, h, chromium: chromiumR, webkit: webkitR }, null, 2));
}
