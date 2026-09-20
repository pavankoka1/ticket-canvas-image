import { snapdom } from "@zumer/snapdom";

import {
  bitmapToPngBlob,
  blobToBitmap,
  deleteAtlas,
  listAtlasKeys,
  loadAtlas,
  saveAtlas,
} from "./atlasStore";
import { getActiveLayout, type CatalogLayout } from "./catalogLayout";
import {
  applyCellBoxCssVars,
  resolveCellBoxModel,
  setLiveCellBoxModel,
  snapCss,
  type CellBox,
  type CellBoxModel,
} from "./cellBoxModel";
import { applyTicketCssVars, type TicketMetrics } from "./ticketPresets";
import { applyTicketCellLayout, createTicketDom } from "./ticketCardElement";

export type { CellBox };

export type TicketGeometry = {
  cells: CellBox[];
  dpr: number;
  cardWidth: number;
  cellW: number;
  cellH: number;
  /**
   * Vertical device-px correction BAKED into every sprite so the glyph ink
   * lands where native DOM text sits. Fixes mechanism B: SnapDOM's
   * foreignObject raster draws the digit ~0.8 CSS px higher than native.
   * Informational once baked (sprites already corrected); persisted for debug.
   */
  inkShift?: number;
};

export type AtlasSource = "ram" | "idb" | "snap" | "empty";

type AtlasEntry = {
  key: string;
  bitmaps: Map<number, ImageBitmap>;
  geometry: TicketGeometry;
};

/** Snapshot from real ticket DOM; cellW = (cw − 6) / 6. Sprites ink-shifted to native. */
const ATLAS_VERSION = "v19-realcells";

const ramCache = new Map<string, AtlasEntry>();

let active: AtlasEntry | null = null;
let warmPromise: Promise<AtlasSource> | null = null;
let warmPromiseKey: string | null = null;
let buildGen = 0;

export function getCellBitmap(n: number): ImageBitmap | undefined {
  return active?.bitmaps.get(n);
}

/** PNG data-URL of a cached sprite — for DOM overlay A-vs-B test. */
export function getCellSpriteDataUrl(n: number): string | null {
  const bmp = active?.bitmaps.get(n);
  if (!bmp) return null;
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0);
  return c.toDataURL("image/png");
}

export function cellAtlasSize(): number {
  return active?.bitmaps.size ?? 0;
}

export function getTicketGeometry(): TicketGeometry | null {
  return active?.geometry ?? null;
}

export function getActiveAtlasKey(): string | null {
  return active?.key ?? null;
}

export function ramAtlasCount(): number {
  return ramCache.size;
}

export function fontIdentity(sizePx: number): string {
  const spec = `700 ${sizePx}px "MB-Onest"`;
  const specOnest = `700 ${sizePx}px Onest`;
  const check = document.fonts?.check?.bind(document.fonts);
  if (!check) return "fonts-api-missing";
  if (check(spec)) return "MB-Onest";
  if (check(specOnest)) return "Onest";
  return "fallback-system";
}

export function atlasCacheKey(
  layout: CatalogLayout = getActiveLayout(),
  model?: CellBoxModel,
): string {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const m = layout.metrics;
  const box = model ?? resolveCellBoxModel(layout, dpr);
  return [
    ATLAS_VERSION,
    m.id,
    `cw=${layout.cardWidth}`,
    `dpr=${dpr}`,
    `cell=${box.cellW}x${box.cellH}`,
    `num=${m.numberFontSize}/${m.numberLineHeight}`,
    `font=${fontIdentity(m.numberFontSize)}`,
    `sep=${m.separatorWidth}`,
    `padY=${m.bodyPaddingY}`,
  ].join("|");
}

export function resetCellAtlasRam(key?: string): void {
  buildGen += 1;
  if (key) {
    const entry = ramCache.get(key);
    if (entry) {
      for (const b of entry.bitmaps.values()) b.close();
      ramCache.delete(key);
      if (active?.key === key) active = null;
    }
  } else {
    for (const entry of ramCache.values()) {
      for (const b of entry.bitmaps.values()) b.close();
    }
    ramCache.clear();
    active = null;
  }
  warmPromise = null;
  warmPromiseKey = null;
}

export function clearCellAtlas(): void {
  const key = active?.key ?? warmPromiseKey;
  resetCellAtlasRam();
  if (key) void deleteAtlas(key);
}

const SNAP_OPTS = {
  embedFonts: true,
  outerTransforms: true,
  outerShadows: false,
  // Capture over WHITE — on Linux/FreeType the glyph rasterises at a different
  // sub-pixel baseline over transparent vs opaque, which shifted alignment.
  // We keep the proven opaque raster and un-matte the white to transparent in
  // normalizeBitmap so the sprite still composites over the canvas gradient.
  backgroundColor: "#FFFFFF" as const,
  fast: true,
  cache: "disabled" as const,
  compress: false,
  scale: 1,
  burst: true,
};

function yieldToMain(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } })
    .scheduler;
  if (sched?.yield) return sched.yield();
  return new Promise((r) => setTimeout(r, 0));
}

function activate(entry: AtlasEntry): void {
  active = entry;
  ramCache.set(entry.key, entry);
  setLiveCellBoxModel({
    dpr: entry.geometry.dpr,
    cardWidth: entry.geometry.cardWidth,
    cellW: entry.geometry.cellW,
    cellH: entry.geometry.cellH,
    padX: entry.geometry.cells[0]?.x ?? 0,
    bodyTop: entry.geometry.cells[0]?.y ?? 0,
    sep: getActiveLayout().metrics.separatorWidth,
    cells: entry.geometry.cells,
  });
}

export async function warmCellAtlas(
  host: HTMLElement,
  onProgress?: (ready: number, source: AtlasSource) => void,
): Promise<AtlasSource> {
  // Wait for the webfont BEFORE computing the cache key. atlasCacheKey embeds
  // fontIdentity() (document.fonts.check), so a cold load would key on
  // "fallback-system" and the next (font cached) load on "MB-Onest" — a
  // guaranteed IndexedDB miss that forces a needless SnapDOM rebuild every time.
  try {
    await document.fonts.ready;
  } catch {
    // fonts API unavailable — key falls back deterministically, still fine.
  }

  const layout = getActiveLayout();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const model = resolveCellBoxModel(layout, dpr);
  setLiveCellBoxModel(model);
  applyTicketCssVars(host, layout.metrics);
  applyCellBoxCssVars(host, model, layout.metrics);

  const key = atlasCacheKey(layout, model);
  const hit = ramCache.get(key);
  if (hit && hit.bitmaps.size === 60) {
    activate(hit);
    onProgress?.(60, "ram");
    return "ram";
  }

  if (warmPromise && warmPromiseKey === key) return warmPromise;

  buildGen += 1;
  const gen = buildGen;
  warmPromiseKey = key;
  warmPromise = buildAtlas(host, key, model, gen, onProgress).finally(() => {
    if (warmPromiseKey === key) {
      warmPromise = null;
      warmPromiseKey = null;
    }
  });
  return warmPromise;
}

/**
 * Build a real ticket card (same DOM/CSS as live), snapshot the *first* cell
 * for numbers 1…60. Separators stay out of the sprite — canvas paints them
 * between blits.
 */
async function buildAtlas(
  host: HTMLElement,
  key: string,
  model: CellBoxModel,
  gen: number,
  onProgress?: (ready: number, source: AtlasSource) => void,
): Promise<AtlasSource> {
  const layout = getActiveLayout();
  const m = layout.metrics;

  const stored = await loadAtlas(key);
  if (gen !== buildGen) return "empty";
  console.info("[atlas] cache", { hit: !!stored, key });
  if (stored) {
    try {
      if (
        stored.geometry.cardWidth !== layout.cardWidth ||
        stored.geometry.cellW !== model.cellW ||
        stored.geometry.cellH !== model.cellH
      ) {
        console.warn("[atlas] STALE geometry — rebuilding", {
          storedCw: stored.geometry.cardWidth,
          cw: layout.cardWidth,
          storedCell: `${stored.geometry.cellW}x${stored.geometry.cellH}`,
          cell: `${model.cellW}x${model.cellH}`,
        });
        await deleteAtlas(key);
      } else {
        // Decode all 60 PNGs in parallel — sequential awaits made the IDB load
        // take seconds under CPU throttle. createImageBitmap decodes off-thread.
        const bmps = await Promise.all(
          stored.blobs.map((b) => blobToBitmap(b)),
        );
        if (gen !== buildGen) {
          for (const b of bmps) b.close();
          return "empty";
        }
        const bitmaps = new Map<number, ImageBitmap>();
        bmps.forEach((b, i) => bitmaps.set(i + 1, b));
        onProgress?.(60, "idb");
        activate({ key, bitmaps, geometry: stored.geometry as TicketGeometry });
        return "idb";
      }
    } catch {
      await deleteAtlas(key);
    }
  }

  if (gen !== buildGen) return "empty";

  prepareFactoryHost(host);
  applyTicketCssVars(host, m);
  applyCellBoxCssVars(host, model, m);

  // Explicitly load the 700 weight BEFORE capture. document.fonts.ready alone
  // can resolve before a specific weight is ready, so the sheet would rasterise
  // a thinner fallback while the live DOM later shows real Onest 700 — the
  // "thin numbers that re-adjust" seen on Linux.
  try {
    await Promise.all([
      document.fonts.load(`700 ${m.numberFontSize}px "MB-Onest"`),
      document.fonts.load(`700 ${m.numberFontSize}px Onest`),
    ]);
  } catch {
    // ignore — fontIdentity below records what actually resolved
  }
  await document.fonts.ready;
  const face = fontIdentity(m.numberFontSize);
  console.info("[atlas] font", {
    face,
    mbOnest700: document.fonts.check(`700 ${m.numberFontSize}px "MB-Onest"`),
    onest700: document.fonts.check(`700 ${m.numberFontSize}px Onest`),
    onest400: document.fonts.check(`400 ${m.numberFontSize}px Onest`),
  });
  if (face === "fallback-system") {
    console.warn(
      "[atlas] ticket font not loaded — capturing with fallback (key marks it)",
    );
  }

  const { cellW, cellH, dpr } = model;

  // Real ticket HTML — identical structure/classes to live pool tickets.
  const ticket = createTicketDom();
  ticket.root.classList.add("ticketCard_atlas");
  ticket.root.style.position = "relative";
  ticket.root.style.visibility = "visible";
  ticket.root.style.filter = "none";
  ticket.root.style.boxShadow = "none";
  applyTicketCellLayout(ticket.root, ticket.cellEls, model);
  ticket.idText.data = "0001";
  // Fill siblings so flex/margin layout matches a live 6-cell row.
  for (let i = 0; i < ticket.cellTexts.length; i++) {
    ticket.cellTexts[i]!.data = String(i + 1);
  }
  host.appendChild(ticket.root);
  void ticket.root.offsetWidth;

  // —— Y-drift diagnostic (run on Linux fractional DPR) ——
  const cardR = ticket.root.getBoundingClientRect();
  const cell0R = ticket.cellEls[0]!.getBoundingClientRect();
  const actualTop = cell0R.top - cardR.top;
  const trueDpr = window.devicePixelRatio || 1;
  console.log("[YDRIFT]", {
    dpr: trueDpr,
    dprCapped: dpr,
    modelBodyTop: model.bodyTop,
    actualCellTop: actualTop,
    modelDeviceTop: Math.round(model.bodyTop * trueDpr),
    actualDeviceTop: actualTop * trueDpr,
    metricBodyTop: m.headerHeight + m.bodyPaddingY,
  });

  // Measure the real cell for geometry + glyph colour, then discard the ticket.
  const captureCell = ticket.cellEls[0]!;
  const glyph = parseRgb(getComputedStyle(captureCell).color) ?? {
    r: 112,
    g: 79,
    b: 79,
  };

  const rect = captureCell.getBoundingClientRect();
  const measuredW = snapCss(rect.width, dpr);
  const measuredH = snapCss(rect.height, dpr);
  if (
    Math.abs(measuredW - cellW) > 0.01 ||
    Math.abs(measuredH - cellH) > 0.01
  ) {
    console.warn("[atlas] measured cell ≠ model", {
      measuredW,
      measuredH,
      cellW,
      cellH,
    });
  }
  const captureW = measuredW > 0 ? measuredW : cellW;
  const captureH = measuredH > 0 ? measuredH : cellH;
  const wantW = Math.round(captureW * dpr);
  const wantH = Math.round(captureH * dpr);

  // Geometry from Chrome's real layout — not metric-derived bodyTop snaps.
  // Fixes mechanism A: independent snap(19.5) vs absolute pixel-snap diverge on fractional DPR.
  const measuredCells = ticket.cellEls.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.left - cardR.left,
      y: r.top - cardR.top,
      w: captureW,
      h: captureH,
    };
  });

  // Native ink centre (for the mechanism-B shift), measured from the real cell.
  const nativeCentre = nativeInkCentreDevice(host, m, captureH, dpr);
  ticket.root.remove();
  if (gen !== buildGen) return "empty";

  // —— ONE SnapDOM sheet built from REAL ticket cells (identical classes &
  // inherited font to the live cell and the old per-cell capture), cropped by
  // MEASURED positions. A plain-<div> grid rendered the glyph at a subtly
  // different size in the foreignObject → "numbers shrink on settle". Still one
  // capture (10 ticket-rows × 6 cells), so the Safari-speed win stays. ——
  const SHEET_ROWS = 10; // 10 rows × 6 cells = 60 numbers
  const container = document.createElement("div");
  container.style.cssText = [
    "position:absolute",
    "left:0",
    "top:0",
    "margin:0",
    "padding:0",
    "background:#FFFFFF",
    "display:flex",
    "flex-direction:column",
  ].join(";");
  const orderedCells: HTMLElement[] = [];
  for (let r = 0; r < SHEET_ROWS; r++) {
    const t = createTicketDom();
    t.root.style.position = "relative";
    t.root.style.background = "#FFFFFF";
    t.root.style.boxShadow = "none";
    t.root.style.filter = "none";
    applyTicketCellLayout(t.root, t.cellEls, model);
    for (let c = 0; c < t.cellEls.length; c++) {
      t.cellEls[c]!.style.background = "#FFFFFF"; // opaque for un-matte
      const n = r * 6 + c + 1;
      if (n <= 60) {
        t.cellTexts[c]!.data = String(n);
        orderedCells[n - 1] = t.cellEls[c]!;
      } else {
        t.cellTexts[c]!.data = "";
      }
    }
    container.appendChild(t.root);
  }
  host.appendChild(container);
  void container.offsetWidth;

  // Measure each cell's real device position (robust to flex/separator layout).
  const containerRect = container.getBoundingClientRect();
  const cellRects = orderedCells.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      sx: Math.round((r.left - containerRect.left) * dpr),
      sy: Math.round((r.top - containerRect.top) * dpr),
    };
  });

  // Natural size × dpr — never pass width/height (SnapDOM would rescale).
  const sheetCanvas = await snapdom.toCanvas(container, {
    ...SNAP_OPTS,
    dpr,
    invalidate: true,
  });
  container.remove();
  if (gen !== buildGen) return "empty";

  const cellOrigin = (i: number) => cellRects[i]!;

  // Mechanism-B shift: crop "8" (index 7), scan its ink, compare to native.
  let inkShift = 0;
  {
    const { sx, sy } = cellOrigin(7);
    const eight = cropRegionCanvas(sheetCanvas, sx, sy, wantW, wantH);
    const ink8 = eight ? scanInkBBox(eight) : null;
    if (ink8 && nativeCentre != null) {
      inkShift = Math.round(nativeCentre - ink8.center);
    }
    console.log("[INK-FIX]", {
      preset: m.id,
      dpr,
      trueDpr: window.devicePixelRatio,
      sheet: `${sheetCanvas.width}x${sheetCanvas.height}`,
      nativeInkCentre: nativeCentre == null ? "n/a" : +nativeCentre.toFixed(2),
      spriteInkCentre: ink8 ? +ink8.center.toFixed(2) : "n/a",
      inkShift,
      residualAfterFix:
        ink8 && nativeCentre != null
          ? +(ink8.center + inkShift - nativeCentre).toFixed(2)
          : "n/a",
    });
  }

  const geometry: TicketGeometry = {
    dpr,
    cardWidth: layout.cardWidth,
    cellW: captureW,
    cellH: captureH,
    cells: measuredCells,
    inkShift,
  };

  // Crop + un-matte + shift each cell — parallel, no SnapDOM in this loop.
  const bitmaps = new Map<number, ImageBitmap>();
  const built = await Promise.all(
    Array.from({ length: 60 }, (_, i) => {
      const { sx, sy } = cellOrigin(i);
      return sheetCellBitmap(sheetCanvas, sx, sy, wantW, wantH, inkShift, glyph);
    }),
  );
  if (gen !== buildGen) {
    for (const b of built) b?.close();
    return "empty";
  }
  built.forEach((b, i) => {
    if (b) bitmaps.set(i + 1, b);
  });
  onProgress?.(60, "snap");
  console.info("[atlas] sheet snap", {
    sheet: `${sheetCanvas.width}x${sheetCanvas.height}`,
    want: `${wantW}x${wantH}`,
    css: `${captureW}x${captureH}`,
    dpr,
  });

  // Persist FIRST, always, under the exact key we built for — even if a newer
  // warm superseded this one. The key encodes the layout, so a stale-layout
  // build is still a valid cache entry for that layout. Skipping the save here
  // (the old behaviour) meant a re-warm mid-build → atlas thrown away → rebuild
  // on every refresh. Converting bitmaps to blobs does not consume them.
  const superseded = gen !== buildGen;
  try {
    const blobs: Blob[] = [];
    for (let n = 1; n <= 60; n++) {
      blobs.push(await bitmapToPngBlob(bitmaps.get(n)!));
      if (n % 10 === 0) await yieldToMain();
    }
    const ok = await saveAtlas({ key, geometry, blobs });
    console.info("[atlas] saved", { key, ok, superseded });
  } catch (err) {
    console.warn("[atlas] persist failed", err);
  }

  if (superseded) {
    for (const b of bitmaps.values()) b.close();
    return "empty";
  }

  activate({ key, bitmaps, geometry });
  onProgress?.(60, "snap");
  return "snap";
}

/**
 * Vertical ink bounding box of a captured sprite, in device px from its top.
 * The raw capture is opaque white (alpha 255), so compositing over white is a
 * no-op and this is just the original "any channel < 200" ink test; the general
 * form also handles straight-alpha input if the capture ever changes.
 */
function scanInkBBox(
  canvas: HTMLCanvasElement,
): { top: number; bottom: number; height: number; center: number } | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return null; // tainted canvas — can't read pixels
  }
  const w = canvas.width;
  const h = canvas.height;
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    let ink = false;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3]! / 255;
      if (a === 0) continue;
      // Straight-alpha pixel composited over white == the old opaque capture.
      const r = data[i]! * a + 255 * (1 - a);
      const g = data[i + 1]! * a + 255 * (1 - a);
      const b = data[i + 2]! * a + 255 * (1 - a);
      if (r < 200 || g < 200 || b < 200) {
        ink = true;
        break;
      }
    }
    if (ink) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  if (top < 0) return null;
  return { top, bottom, height: bottom - top + 1, center: (top + bottom + 1) / 2 };
}

/**
 * Real text baseline, in CSS px from the cell top, MEASURED (not analytic).
 * A zero-height inline-block strut with vertical-align:baseline sits its box on
 * the baseline; a block probe with the cell's font + line-height gives the
 * baseline within the line box, and align-items:center centres that line box in
 * the cell. Same native text pipeline the live DOM cell uses.
 */
function measureBaselineFromCellTop(
  host: HTMLElement,
  m: TicketMetrics,
  cellHcss: number,
): number | null {
  const probe = document.createElement("div");
  probe.style.cssText = [
    "position:absolute",
    "left:-9999px",
    "top:0",
    "visibility:hidden",
    "margin:0",
    "padding:0",
    "white-space:nowrap",
    "font-family:MB-Onest, Onest, system-ui, sans-serif",
    "font-weight:700",
    `font-size:${m.numberFontSize}px`,
    `line-height:${m.numberLineHeight}px`,
    "-webkit-font-smoothing:antialiased",
    "text-rendering:geometricPrecision",
  ].join(";");
  probe.textContent = "8";
  const strut = document.createElement("span");
  strut.style.cssText =
    "display:inline-block;width:0;height:0;vertical-align:baseline";
  probe.appendChild(strut);
  host.appendChild(probe);
  const pr = probe.getBoundingClientRect();
  const sr = strut.getBoundingClientRect();
  probe.remove();
  if (pr.height <= 0) return null;
  const baselineWithinLineBox = sr.top - pr.top;
  const lineBoxTopInCell = Math.max(0, (cellHcss - m.numberLineHeight) / 2);
  return lineBoxTopInCell + baselineWithinLineBox;
}

/** Ink centre offset from baseline (CSS px, negative = above), via measureText. */
function inkOffsetFromBaseline(fontSizePx: number): number | null {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.font = `700 ${fontSizePx}px MB-Onest, Onest, system-ui, sans-serif`;
  ctx.textBaseline = "alphabetic";
  const tm = ctx.measureText("8");
  const iAsc = tm.actualBoundingBoxAscent;
  const iDesc = tm.actualBoundingBoxDescent;
  if (typeof iAsc !== "number" || typeof iDesc !== "number") return null;
  return (iDesc - iAsc) / 2;
}

/**
 * Native digit-ink centre in device px from cell top: measured baseline + the
 * font's ink offset. Baseline is pixel-true; only the ink offset uses
 * measureText (which is exactly what actualBoundingBox is reliable for).
 */
function nativeInkCentreDevice(
  host: HTMLElement,
  m: TicketMetrics,
  cellHcss: number,
  dpr: number,
): number | null {
  const baselineCss = measureBaselineFromCellTop(host, m, cellHcss);
  const inkOffsetCss = inkOffsetFromBaseline(m.numberFontSize);
  if (baselineCss == null || inkOffsetCss == null) return null;
  return (baselineCss + inkOffsetCss) * dpr;
}

type Rgb = { r: number; g: number; b: number };

/** Parse "rgb(112, 79, 79)" / "rgba(...)". */
function parseRgb(s: string): Rgb | null {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return { r: +m[1]!, g: +m[2]!, b: +m[3]! };
}

/**
 * Convert a white-matted glyph to straight-alpha transparent, in place.
 * For a pixel C = glyph·cov + white·(1−cov), coverage per channel is
 * (255 − C) / (255 − glyph); we take the strongest channel, then rewrite the
 * pixel as the glyph colour at that alpha. Grayscale AA (font-smoothing:
 * antialiased) makes this exact; the result composites over the gradient like
 * the live DOM cell — without changing the glyph's raster position.
 */
function unmatteFromWhite(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  F: Rgb,
): void {
  const dr = 255 - F.r;
  const dg = 255 - F.g;
  const db = 255 - F.b;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue; // untouched margin — already transparent
    const cr = dr > 0 ? (255 - d[i]!) / dr : 0;
    const cg = dg > 0 ? (255 - d[i + 1]!) / dg : 0;
    const cb = db > 0 ? (255 - d[i + 2]!) / db : 0;
    let cov = Math.max(cr, cg, cb);
    cov = cov < 0 ? 0 : cov > 1 ? 1 : cov;
    d[i] = F.r;
    d[i + 1] = F.g;
    d[i + 2] = F.b;
    d[i + 3] = Math.round(cov * 255);
  }
  ctx.putImageData(img, 0, 0);
}


/** Copy a cell region of the sheet into an opaque canvas (for ink scanning). */
function cropRegionCanvas(
  sheet: HTMLCanvasElement,
  sx: number,
  sy: number,
  w: number,
  h: number,
): HTMLCanvasElement | null {
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  const srcW = Math.min(w, sheet.width - sx);
  const srcH = Math.min(h, sheet.height - sy);
  ctx.drawImage(sheet, sx, sy, srcW, srcH, 0, 0, srcW, srcH);
  return out;
}

/** Crop a cell region + vertical shift + un-matte white → transparent sprite. */
async function sheetCellBitmap(
  sheet: HTMLCanvasElement,
  sx: number,
  sy: number,
  wantW: number,
  wantH: number,
  shiftY: number,
  glyph: Rgb,
): Promise<ImageBitmap | null> {
  const out = document.createElement("canvas");
  out.width = wantW;
  out.height = wantH;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  const srcW = Math.min(wantW, sheet.width - sx);
  const srcH = Math.min(wantH, sheet.height - sy);
  // shiftY > 0 pushes the glyph down; empty margins above/below absorb it.
  ctx.drawImage(sheet, sx, sy, srcW, srcH, 0, shiftY, srcW, srcH);
  unmatteFromWhite(ctx, wantW, wantH, glyph);
  return createImageBitmap(out);
}

function prepareFactoryHost(host: HTMLElement): void {
  const s = host.style;
  s.position = "fixed";
  s.left = "-10000px";
  s.top = "0";
  s.pointerEvents = "none";
  s.opacity = "1";
  s.zIndex = "-1";
  host.setAttribute("aria-hidden", "true");
  host.replaceChildren();
}

export async function debugAtlasKeys(): Promise<string[]> {
  return listAtlasKeys();
}
