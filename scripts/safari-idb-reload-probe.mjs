import { webkit } from "playwright";
import { createHash } from "crypto";
import { readFileSync } from "fs";

const URL = process.env.CATALOG_URL ?? "http://localhost:5175/";

const browser = await webkit.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

page.on("console", (msg) => {
  if (msg.text().includes("[atlas-warm]")) console.log(msg.text());
});

async function capture(label) {
  if (label === "reload") await page.reload({ waitUntil: "networkidle" });
  else await page.goto(URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "+100" }).click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const el = document.querySelector(".ticketCatalog");
    if (el) el.scrollTop = 400;
  });
  await page.waitForTimeout(1500);
  const path = `/tmp/wk-${label}.png`;
  await page.screenshot({ path });
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
  const probe = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return null;
    const d = ctx.getImageData(120, 200, 80, 30).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 30) ink++;
    return { canvas: [canvas.width, canvas.height], ink, dpr: devicePixelRatio };
  });
  return { label, path, hash, probe };
}

console.log(await capture("first"));
console.log(await capture("reload"));
await browser.close();
