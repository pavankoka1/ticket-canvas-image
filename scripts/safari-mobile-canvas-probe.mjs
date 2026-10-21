import { webkit, chromium } from "playwright";

const URL = process.env.CATALOG_URL ?? "http://localhost:5175/";

async function probe(browserName, launch, viewport) {
  const browser = await launch();
  const page = await browser.newPage({ viewport });
  page.on("console", (msg) => {
    if (msg.text().includes("[atlas-warm]")) console.log(`[${browserName}]`, msg.text());
  });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "+100" }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const el = document.querySelector(".ticketCatalog");
    if (el) el.scrollTop = Math.floor(el.scrollHeight * 0.35);
  });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { error: "no canvas" };
    const ctx = canvas.getContext("2d");
    const scroll = document.querySelector(".ticketCatalog");
    const layout = [...document.querySelectorAll("strong")].find((s) =>
      s.textContent?.includes("col"),
    )?.textContent;
    function inkAt(x, y, w, h) {
      if (x < 0 || y < 0 || x + w > canvas.width || y + h > canvas.height) return -1;
      const d = ctx.getImageData(x, y, w, h).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 30) n++;
      return n;
    }
    const cardH = 41;
    const scrollTop = scroll?.scrollTop ?? 0;
    const rowSamples = [];
    for (let row = 0; row < 8; row++) {
      const yCss = row * cardH - scrollTop + 25;
      const y = Math.round(yCss);
      rowSamples.push({
        row,
        inkCell: inkAt(80, y, 50, 12),
        inkHeader: inkAt(40, y - 12, 40, 10),
        yCss,
      });
    }
    return {
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      layout,
      canvas: [canvas.width, canvas.height],
      scrollTop,
      rowSamples,
    };
  });

  const shot = `/tmp/catalog-${browserName}-${viewport.width}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();
  return { browserName, viewport, screenshot: shot, ...result };
}

const engines = [
  ["chromium", () => chromium.launch({ headless: true })],
  ["webkit", () => webkit.launch({ headless: true })],
];

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1200, height: 800 },
]) {
  for (const [name, launch] of engines) {
    try {
      const r = await probe(name, launch, viewport);
      console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      console.error(name, viewport, e);
    }
  }
}
