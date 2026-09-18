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
const ATLAS_VERSION = "v13-transparent";

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

function fontIdentity(sizePx: number): string {
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
  // Transparent capture — the sprite is composited over the canvas body
  // gradient, same as the live DOM cell (background: transparent). An opaque
  // fill would paint a white box over the gradient (and over hit dabs).
  backgroundColor: "transparent" as const,
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

export function warmCellAtlas(
  host: HTMLElement,
  onProgress?: (ready: number, source: AtlasSource) => void,
): Promise<AtlasSource> {
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
    return Promise.resolve("ram");
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
  if (stored) {
    try {
      if (
        stored.geometry.cardWidth !== layout.cardWidth ||
        stored.geometry.cellW !== model.cellW ||
        stored.geometry.cellH !== model.cellH
      ) {
        await deleteAtlas(key);
      } else {
        const bitmaps = new Map<number, ImageBitmap>();
        for (let i = 0; i < 60; i++) {
          if (gen !== buildGen) return "empty";
          bitmaps.set(i + 1, await blobToBitmap(stored.blobs[i]!));
          onProgress?.(bitmaps.size, "idb");
        }
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

  await document.fonts.ready;
  const face = fontIdentity(m.numberFontSize);
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

  // Snapshot the first cell only (no ::before separator) — pure number styles.
  const captureCell = ticket.cellEls[0]!;
  // Transparent, like the live cell — glyph composites over the canvas gradient.
  captureCell.style.background = "transparent";

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

  // —— Fix mechanism B: bake a vertical shift so the digit ink lands where
  // native DOM text sits. Pre-capture "8", compare its ink centre to the
  // measured native ink centre; the delta is baked into every sprite below.
  let inkShift = 0;
  {
    const nativeCentre = nativeInkCentreDevice(host, m, captureH, dpr);
    ticket.cellTexts[0]!.data = "8";
    void captureCell.offsetWidth;
    // Warm-up: SnapDOM's very first toCanvas rasterises the cell differently
    // (cold style/font inlining), so measuring off it gives a shift that
    // doesn't match the warm sprites captured in the loop. Discard one capture
    // so the measured "8" matches what actually gets stored.
    await snapdom.toCanvas(captureCell, { ...SNAP_OPTS, dpr, invalidate: true });
    const raw8 = await snapdom.toCanvas(captureCell, {
      ...SNAP_OPTS,
      dpr,
      invalidate: true,
    });
    const ink8 = scanInkBBox(raw8);
    if (ink8 && nativeCentre != null) {
      inkShift = Math.round(nativeCentre - ink8.center);
    }
    console.log("[INK-FIX]", {
      preset: m.id,
      dpr,
      trueDpr: window.devicePixelRatio,
      rawSize: `${raw8.width}x${raw8.height}`,
      nativeInkCentre: nativeCentre == null ? "n/a" : +nativeCentre.toFixed(2),
      spriteInkCentre: ink8 ? +ink8.center.toFixed(2) : "n/a",
      inkShift, // device px baked into every sprite (>0 = push digit down)
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

  const bitmaps = new Map<number, ImageBitmap>();

  for (let n = 1; n <= 60; n++) {
    if (gen !== buildGen) {
      for (const b of bitmaps.values()) b.close();
      return "empty";
    }

    ticket.cellTexts[0]!.data = String(n);
    void captureCell.offsetWidth;

    // Natural size × dpr — never pass width/height (SnapDOM would rescale).
    const raw = await snapdom.toCanvas(captureCell, {
      ...SNAP_OPTS,
      dpr,
      invalidate: true,
    });

    if (n === 1) {
      console.info("[atlas] ticket-html snap", {
        raw: `${raw.width}x${raw.height}`,
        want: `${wantW}x${wantH}`,
        css: `${captureW}x${captureH}`,
        formula: `(${layout.cardWidth}-6)/6=${cellW}`,
        dpr,
      });
    }

    // —— Ink-drift diagnostic (mechanism B): where SnapDOM actually put the
    // glyph inside the raw sprite vs where native text sits.
    if (n === 8) logInkDiagnostic(host, raw, m, captureH, dpr);

    bitmaps.set(n, await normalizeBitmap(raw, wantW, wantH, inkShift));
    onProgress?.(bitmaps.size, "snap");
    await yieldToMain();
  }

  ticket.root.remove();

  if (gen !== buildGen) {
    for (const b of bitmaps.values()) b.close();
    return "empty";
  }

  activate({ key, bitmaps, geometry });
  onProgress?.(60, "snap");

  try {
    const blobs: Blob[] = [];
    for (let n = 1; n <= 60; n++) {
      blobs.push(await bitmapToPngBlob(bitmaps.get(n)!));
      if (n % 10 === 0) await yieldToMain();
    }
    if (gen !== buildGen) return "snap";
    const ok = await saveAtlas({ key, geometry, blobs });
    if (!ok) console.warn("[atlas] IndexedDB save failed for", key);
  } catch (err) {
    console.warn("[atlas] persist failed", err);
  }

  return "snap";
}

/**
 * Vertical ink bounding box of a captured sprite, in device px from its top.
 * Sprite is #704F4F digits on a transparent background, so alpha = ink.
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
      // Transparent capture: ink = pixels with coverage (alpha), not "dark".
      if (data[i + 3]! > 40) {
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

/**
 * Logs δ = (SnapDOM sprite ink centre) − (native ink centre), device px.
 * deltaDevice < 0 → SnapDOM drew the glyph HIGHER than native (canvas-up bug).
 * Compare across Mac / Windows / Linux — native centre is font-determined and
 * platform-invariant, so any delta swing is the foreignObject raster (B).
 */
function logInkDiagnostic(
  host: HTMLElement,
  raw: HTMLCanvasElement,
  m: TicketMetrics,
  captureHcss: number,
  dpr: number,
): void {
  const ink = scanInkBBox(raw);
  if (!ink) {
    console.warn("[INK] scan failed (blank or tainted canvas)");
    return;
  }
  const nativeCentre = nativeInkCentreDevice(host, m, captureHcss, dpr);
  console.log("[INK] digit 8 (raw sprite, pre-shift)", {
    preset: m.id,
    dprCapped: dpr,
    trueDpr: window.devicePixelRatio,
    rawSize: `${raw.width}x${raw.height}`,
    spriteInkTop: ink.top,
    spriteInkBottom: ink.bottom,
    spriteInkCentre: +ink.center.toFixed(2),
    spriteInkCentreFrac: +(ink.center / raw.height).toFixed(4),
    nativeInkCentre: nativeCentre == null ? "n/a" : +nativeCentre.toFixed(2),
    deltaDevice:
      nativeCentre == null ? "n/a" : +(ink.center - nativeCentre).toFixed(2),
  });
}

/** Pad/crop + optional vertical shift (device px). Never stretch. */
async function normalizeBitmap(
  src: HTMLCanvasElement,
  wantW: number,
  wantH: number,
  shiftY = 0,
): Promise<ImageBitmap> {
  if (shiftY === 0 && src.width === wantW && src.height === wantH) {
    return createImageBitmap(src);
  }
  const out = document.createElement("canvas");
  out.width = wantW;
  out.height = wantH;
  const ctx = out.getContext("2d");
  if (!ctx) return createImageBitmap(src);
  ctx.imageSmoothingEnabled = false;
  // Keep transparent — no white fill — so the sprite composites over the gradient.
  const sw = Math.min(src.width, wantW);
  const sh = Math.min(src.height, wantH);
  // shiftY > 0 pushes the glyph down; empty margins above/below absorb it.
  ctx.drawImage(src, 0, 0, sw, sh, 0, shiftY, sw, sh);
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
