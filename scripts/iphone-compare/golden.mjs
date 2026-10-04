/**
 * Golden capture / compare for /compare at DPR 2 and 3 (local Google Chrome).
 *
 *   node scripts/iphone-compare/golden.mjs [outDir]
 *   node scripts/iphone-compare/golden.mjs --compare <goldenDir>
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.COMPARE_URL || 'http://localhost:5173/compare';
const PRESETS = [
  'desktopMedium',
  'desktopSmall',
  'mobile',
  'mobileLarge',
  'mobileCompact',
];
const DPRS = [2, 3];

const argv = process.argv.slice(2);
const compareIdx = argv.indexOf('--compare');
const compareDir =
  compareIdx >= 0 ? resolve(argv[compareIdx + 1] || 'golden') : null;
const outRoot = resolve(
  compareDir ?? argv[0] ?? join(dirname(fileURLToPath(import.meta.url)), '../../golden'),
);

function dataUrlToPngBuffer(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64, 'base64');
}

function diffPng(aBuf, bBuf) {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return {
      differing: -1,
      max: 255,
      reason: `size ${a.width}x${a.height} vs ${b.width}x${b.height}`,
    };
  }
  let differing = 0;
  let max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let pixelDiff = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(a.data[i + c] - b.data[i + c]);
      if (delta) pixelDiff = true;
      max = Math.max(max, delta);
    }
    if (pixelDiff) differing++;
  }
  return { differing, max };
}

async function waitReady(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        'section[data-renderer] canvas[data-ready="true"]',
      ).length >= 6,
    { timeout: 180_000 },
  );
  await page.waitForTimeout(1000);
}

async function capturePreset(page, preset, dpr) {
  await page.locator('select').nth(0).selectOption(preset);
  await waitReady(page);

  const frames = await page.evaluate(() =>
    [...document.querySelectorAll('section[data-renderer]')].map((section) => {
      const canvas = section.querySelector('canvas');
      if (!canvas || canvas.dataset.ready !== 'true') {
        throw new Error(`canvas not ready: ${section.dataset.ticket}`);
      }
      return {
        renderer: section.dataset.renderer,
        ticket: section.dataset.ticket,
        dataUrl: canvas.toDataURL('image/png'),
      };
    }),
  );

  const dir = join(outRoot, String(dpr));
  mkdirSync(dir, { recursive: true });
  const written = [];
  for (const { renderer, ticket, dataUrl } of frames) {
    const name = `${preset}-${renderer}-${ticket}.png`;
    const buf = dataUrlToPngBuffer(dataUrl);
    const path = join(dir, name);
    if (compareDir) {
      const refPath = join(compareDir, String(dpr), name);
      if (!existsSync(refPath)) {
        console.log(`${name}: FAIL (missing reference ${refPath})`);
        written.push({ name, pass: false, differing: -1, max: 255 });
        continue;
      }
      const ref = readFileSync(refPath);
      const { differing, max, reason } = diffPng(ref, buf);
      const pass = differing === 0;
      const detail = reason ? ` (${reason})` : '';
      console.log(
        `${name}: ${pass ? 'PASS' : 'FAIL'} · ${differing} pixels differ · max Δ ${max}${detail}`,
      );
      written.push({ name, pass, differing, max });
    } else {
      writeFileSync(path, buf);
      written.push({ name, path });
    }
  }
  return written;
}

async function runDpr(dpr) {
  const atlasLogs = [];
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [`--force-device-scale-factor=${dpr}`, '--window-size=1400,1200'],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[atlas-warm]')) {
      const slice = text.slice(text.indexOf('{'));
      let parsed;
      try {
        parsed = JSON.parse(slice);
      } catch {
        const m = slice.match(/preset:\s*(\w+),\s*captures:\s*(\d+),\s*ms:\s*(\d+)/);
        parsed = m
          ? { preset: m[1], captures: Number(m[2]), ms: Number(m[3]) }
          : { raw: text };
      }
      atlasLogs.push({ dpr, ...parsed });
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('select').nth(1).selectOption('svg-all');

  const summary = [];
  for (const preset of PRESETS) {
    const result = await capturePreset(page, preset, dpr);
    summary.push({ preset, frames: result });
    console.log(compareDir ? `compared ${preset} @ DPR ${dpr}` : `captured ${preset} @ DPR ${dpr}`);
  }

  if (!compareDir) {
    const logPath = join(outRoot, String(dpr), 'atlas-warm.json');
    writeFileSync(logPath, JSON.stringify(atlasLogs, null, 2));
    console.log(`wrote ${logPath} (${atlasLogs.length} log lines)`);
  }

  await browser.close();
  return { dpr, summary, atlasLogs };
}

let failed = false;
const allLogs = [];
for (const dpr of DPRS) {
  const { summary, atlasLogs } = await runDpr(dpr);
  allLogs.push(...atlasLogs);
  if (compareDir) {
    for (const { frames } of summary) {
      for (const f of frames) {
        if (!f.pass) failed = true;
      }
    }
  }
}

if (!compareDir) {
  writeFileSync(join(outRoot, 'atlas-warm-all.json'), JSON.stringify(allLogs, null, 2));
}

if (compareDir && failed) process.exit(1);
