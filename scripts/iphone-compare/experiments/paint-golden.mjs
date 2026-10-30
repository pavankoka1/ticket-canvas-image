/**
 * Pixel golden for `paintCatalogTicketSvgAll` across every ticket preset, DPR,
 * face and ink state.
 *
 * Reads pixels with a compositor screenshot rather than `getImageData`: the
 * multiplier host sheet taints the canvas, so a paint that includes a
 * multiplier is not readable from script.
 *
 *   DIR=/tmp/golden-before bun paint-golden.mjs
 *   DIR=/tmp/golden-after  bun paint-golden.mjs
 *   bun paint-golden.mjs --diff /tmp/golden-before /tmp/golden-after
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { PNG } from 'pngjs';

/** Same ink states the golden renders, in grid order. */
const SHAPES = [];
for (const [name, hits, multipliers] of [
  ['none', [], {}],
  ['dab-first', [0], {}],
  ['dab-last', [5], {}],
  ['dab-ends', [0, 5], {}],
  ['dab-all', [0, 1, 2, 3, 4, 5], {}],
  ['mult-first', [0, 3], { 0: 10 }],
  ['mult-last', [2, 5], { 5: 10 }],
  ['mult-all', [0, 1, 2, 3, 4, 5], { 0: 2, 1: 3, 2: 5, 3: 10, 4: 2, 5: 5 }],
]) {
  for (const disabled of [false, true]) {
    for (const balls of [
      [1, 2, 3, 4, 5, 6],
      [10, 29, 38, 47, 56, 60],
      [7, 11, 23, 34, 45, 59],
    ]) {
      SHAPES.push({ label: `${name}|${disabled ? 'disabled' : 'live'}|b${balls[0]}`, hits, multipliers, disabled, balls });
    }
  }
}

if (process.argv[2] === '--diff') {
  const [dirA, dirB] = [process.argv[3], process.argv[4]];
  const files = readdirSync(dirA).filter((f) => f.endsWith('.png')).sort();
  let clean = 0;
  for (const file of files) {
    const a = PNG.sync.read(readFileSync(`${dirA}/${file}`));
    const b = PNG.sync.read(readFileSync(`${dirB}/${file}`));
    if (a.width !== b.width || a.height !== b.height) {
      console.log(`  SIZE  ${file}: ${a.width}x${a.height} -> ${b.width}x${b.height}`);
      continue;
    }
    const cellH = a.height / SHAPES.length;
    const bad = new Set();
    let diffPx = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      if (
        a.data[i] !== b.data[i] ||
        a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2] ||
        a.data[i + 3] !== b.data[i + 3]
      ) {
        diffPx += 1;
        bad.add(Math.floor(Math.floor(i / 4 / a.width) / cellH));
      }
    }
    if (diffPx === 0) {
      clean += 1;
      continue;
    }
    console.log(
      `  DIFF  ${file}: ${diffPx} px across ${bad.size} case(s) — ` +
        `${[...bad].slice(0, 6).map((r) => SHAPES[r]?.label ?? `row${r}`).join(', ')}`,
    );
  }
  console.log(`${clean}/${files.length} sheets pixel-identical (${SHAPES.length} cases each)`);
  process.exit(clean === files.length ? 0 : 1);
}

const URL = process.env.CATALOG_URL || 'http://localhost:5199/';
const DIR = process.env.DIR || '/tmp/paint-golden';
mkdirSync(DIR, { recursive: true });

/** Viewports chosen to land on each `resolvePresetId` branch. */
const VIEWPORTS = [
  ['desktopMedium', 1440, 820],
  ['desktopSmall', 1200, 760],
  ['mobile', 900, 600],
  ['mobilePhone', 390, 844],
  ['mobileTablet', 700, 1000],
  ['mobileCompact', 340, 600],
];
const DPRS = [2, 3];

const browser = await chromium.launch({ channel: 'chrome', headless: true });

for (const [label, width, height] of VIEWPORTS) {
  for (const dpr of DPRS) {
    const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
      null,
      { timeout: 90000 },
    );

    const meta = await page.evaluate(async (shapes) => {
      const paint = await import('/src/ticketCatalog/canvas/paint/catalogSvgPaint.ts');
      const layoutMod = await import('/src/ticketCatalog/layout/catalogLayout.ts');
      const boxMod = await import('/src/ticketCatalog/layout/cellBoxModel.ts');
      const layout = layoutMod.getActiveLayout();
      const dpr = boxMod.activeDpr();
      if (!paint.isCatalogSvgPaintReady(layout)) return { error: 'pack not ready' };

      const w = Math.round(layout.cardWidth * dpr);
      const h = Math.round(layout.metrics.cardHeight * dpr);
      const canvas = document.createElement('canvas');
      canvas.id = 'paintGolden';
      canvas.width = w;
      canvas.height = h * shapes.length;
      // On-screen at exactly one backing px per device px, so the screenshot
      // is the buffer and not a resample of it.
      canvas.style.cssText =
        `position:fixed;left:0;top:0;z-index:99999;width:${w / dpr}px;height:${(h * shapes.length) / dpr}px`;
      document.body.append(canvas);
      const c2d = canvas.getContext('2d');
      c2d.setTransform(1, 0, 0, 1, 0, 0);
      c2d.imageSmoothingEnabled = false;
      // Opaque backdrop: a screenshot flattens alpha, so an alpha-only change
      // would otherwise hide. Magenta is in no ticket palette.
      c2d.fillStyle = '#ff00ff';
      c2d.fillRect(0, 0, canvas.width, canvas.height);

      shapes.forEach((shape, i) => {
        paint.paintCatalogTicketSvgAll(
          c2d,
          {
            id: `g-${i}`,
            no: String((i + 1) * 37),
            balls: shape.balls,
            hits: shape.hits,
            multipliers: shape.multipliers,
            win: shape.hits.length >= 2 ? '$1250.00' : '',
            disabled: shape.disabled,
          },
          0,
          i * h,
          layout,
          dpr,
        );
      });
      return { preset: layout.metrics.id, cardWidth: layout.cardWidth, dpr, w, h };
    }, SHAPES);

    if (meta.error) {
      console.log(`${label} dpr${dpr}: ${meta.error}`);
      await ctx.close();
      continue;
    }
    const name = `${meta.preset}-cw${meta.cardWidth}-dpr${meta.dpr}.png`;
    await page.locator('#paintGolden').screenshot({ path: `${DIR}/${name}`, scale: 'device' });
    console.log(`${label} dpr${dpr}: ${name} (${SHAPES.length} cases, card ${meta.w}x${meta.h})`);
    await ctx.close();
  }
}

console.log(`\nwrote sheets to ${DIR}`);
await browser.close();
