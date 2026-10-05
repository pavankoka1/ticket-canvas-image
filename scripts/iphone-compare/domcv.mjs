/**
 * DOM-vs-canvas capture for every /compare stack (local Chrome).
 * Asserts render mode `svg-all` before each preset. Cold and warm phases.
 *
 *   OUT=./evidence/domcv COMPARE_URL=http://localhost:5173/compare DPR=2 \
 *     node scripts/iphone-compare/domcv.mjs
 *
 * After capture, runs analyze.py and exits 1 if any row reports displacement.
 */
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ANALYZE = join(ROOT, 'scripts/iphone-compare/analyze.py');

const URL = process.env.COMPARE_URL || 'http://localhost:5173/compare';
const OUT = resolve(process.env.OUT || join(ROOT, 'evidence/domcv'));
const DPR = Number(process.env.DPR || '2');
const MODE = 'svg-all';
const PRESETS = [
  'desktopMedium',
  'desktopSmall',
  'mobile',
  'mobileLarge',
  'mobileCompact',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function displacementFailures(analyzeStdout) {
  const failures = [];
  for (const line of analyzeStdout.split('\n')) {
    if (!line.includes(' | ')) continue;
    if (line.includes('no displacement detected')) continue;
    if (line.includes('MISSING') || line.includes('SIZE MISMATCH') || line.includes('unknown preset')) {
      failures.push(line);
      continue;
    }
    if (/\(inconclusive\)/.test(line)) {
      failures.push(line);
      continue;
    }
    if (/~\([0-9.-]+,[0-9.-]+\)/.test(line)) {
      failures.push(line);
      continue;
    }
    const minShift = Number(process.env.DOMCV_MIN_SHIFT || '1');
    const moves = line.matchAll(/\(([+-]?[\d.]+),([+-]?[\d.]+)\)\//g);
    for (const m of moves) {
      const dx = Number(m[1]);
      const dy = Number(m[2]);
      if (Math.abs(dx) >= minShift || Math.abs(dy) >= minShift) failures.push(line);
    }
  }
  return failures;
}

async function clearAtlasDb(page) {
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('bingo-cell-atlas');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });
}

async function waitReady(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        'section[data-renderer] canvas[data-ready="true"]',
      ).length >= 6,
    { timeout: 180_000 },
  );
  await page.waitForTimeout(800);
}

async function assertSvgAll(page) {
  return page.evaluate((mode) => {
    const stacks = [...document.querySelectorAll('section[data-renderer]')];
    if (stacks.length < 6) return { ok: false, why: 'stacks', count: stacks.length };
    for (const st of stacks) {
      if (st.dataset.renderMode !== mode) {
        return {
          ok: false,
          why: 'mode',
          ticket: st.dataset.ticket,
          mode: st.dataset.renderMode,
        };
      }
      const card = st.querySelector('.ticketCard');
      if (!card?.querySelector('.ticketCard__svgOverlay')) {
        return { ok: false, why: 'overlay', ticket: st.dataset.ticket };
      }
    }
    return { ok: true };
  }, MODE);
}

async function captureStacks(page, outDir, preset) {
  mkdirSync(outDir, { recursive: true });
  const meta = await page.evaluate(() =>
    [...document.querySelectorAll('section[data-renderer] .compare__stack')].map(
      (st) => ({
        renderer: st.closest('section').dataset.renderer,
        ticket: st.closest('section').dataset.ticket,
      }),
    ),
  );

  for (let i = 0; i < meta.length; i++) {
    const { renderer, ticket } = meta[i];
    const tag = `${preset}-${renderer}-${ticket}`;
    const stack = page.locator('section[data-renderer] .compare__stack').nth(i);
    await stack.scrollIntoViewIfNeeded();

    await page.evaluate(
      ({ index, domVis, cvOpacity }) => {
        const st = document.querySelectorAll(
          'section[data-renderer] .compare__stack',
        )[index];
        const card = st.querySelector('.ticketCard');
        card.style.visibility = domVis;
        const c = st.querySelector('canvas');
        c.style.opacity = String(cvOpacity);
        c.style.mixBlendMode = 'normal';
      },
      { index: i, domVis: 'visible', cvOpacity: '0' },
    );
    await sleep(300);
    await stack.screenshot({ path: join(outDir, `${tag}-dom.png`) });

    await page.evaluate(
      ({ index }) => {
        const st = document.querySelectorAll(
          'section[data-renderer] .compare__stack',
        )[index];
        st.querySelector('.ticketCard').style.visibility = 'hidden';
        st.querySelector('canvas').style.opacity = '1';
      },
      { index: i },
    );
    await sleep(300);
    await stack.screenshot({ path: join(outDir, `${tag}-cv.png`) });

    await page.evaluate(
      ({ index }) => {
        const st = document.querySelectorAll(
          'section[data-renderer] .compare__stack',
        )[index];
        st.querySelector('.ticketCard').style.visibility = 'visible';
        st.querySelector('canvas').style.opacity = '1';
      },
      { index: i },
    );
  }
  return meta.length;
}

async function runPhase(page, phaseDir, { warmFirst }) {
  mkdirSync(phaseDir, { recursive: true });
  writeFileSync(
    join(phaseDir, 'manifest.json'),
    JSON.stringify({ phase: warmFirst ? 'warm' : 'cold', url: URL, dpr: DPR, mode: MODE }, null, 2),
  );

  if (warmFirst) {
    for (const preset of PRESETS) {
      await page.locator('select').nth(0).selectOption(preset);
      await waitReady(page);
    }
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.locator('select').nth(1).selectOption(MODE);
    await sleep(500);
  }

  for (const preset of PRESETS) {
    await page.locator('select').nth(0).selectOption(preset);
    await waitReady(page);
    const modeCheck = await assertSvgAll(page);
    if (!modeCheck.ok) {
      throw new Error(`svg-all assert failed @ ${preset}: ${JSON.stringify(modeCheck)}`);
    }
    const n = await captureStacks(page, phaseDir, preset);
    console.log(`${warmFirst ? 'warm' : 'cold'} · ${preset} · ${n} stacks`);
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--window-size=1400,1400'],
  });

  const coldDir = join(OUT, `dpr${DPR}`, 'cold');
  const warmDir = join(OUT, `dpr${DPR}`, 'warm');

  {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1400 },
      deviceScaleFactor: DPR,
    });
    const page = await context.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await clearAtlasDb(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('select').nth(1).selectOption(MODE);
    await runPhase(page, coldDir, { warmFirst: false });
    await context.close();
  }

  {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1400 },
      deviceScaleFactor: DPR,
    });
    const page = await context.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.locator('select').nth(1).selectOption(MODE);
    await runPhase(page, warmDir, { warmFirst: true });
    await context.close();
  }

  await browser.close();

  let failed = false;
  for (const dir of [coldDir, warmDir]) {
    const r = spawnSync('python3', [ANALYZE, dir], {
      encoding: 'utf8',
      env: { ...process.env, ANALYZE_DPR: String(DPR) },
    });
    console.log(`\n--- analyze ${dir} ---\n${r.stdout}`);
    if (r.status !== 0) {
      console.error(r.stderr);
      failed = true;
      continue;
    }
    const bad = displacementFailures(r.stdout);
    if (bad.length) {
      failed = true;
      console.error(`DISPLACEMENT @ ${dir}:\n${bad.join('\n')}`);
    }
  }

  if (failed) process.exit(1);
}

await main();
