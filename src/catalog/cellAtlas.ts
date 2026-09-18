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
import { applyTicketCssVars } from "./ticketPresets";
import { applyTicketCellLayout, createTicketDom } from "./ticketCardElement";

export type { CellBox };

export type TicketGeometry = {
  cells: CellBox[];
  dpr: number;
  cardWidth: number;
  cellW: number;
  cellH: number;
};

export type AtlasSource = "ram" | "idb" | "snap" | "empty";

type AtlasEntry = {
  key: string;
  bitmaps: Map<number, ImageBitmap>;
  geometry: TicketGeometry;
};

/** Snapshot from real ticket DOM; cellW = (cw − 6) / 6. */
const ATLAS_VERSION = "v10-measured-y";

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
  // Opaque face for AA; live cells are transparent over the body gradient.
  captureCell.style.background = "#FFFFFF";

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

  const geometry: TicketGeometry = {
    dpr,
    cardWidth: layout.cardWidth,
    cellW: captureW,
    cellH: captureH,
    cells: measuredCells,
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

    bitmaps.set(n, await normalizeBitmap(raw, wantW, wantH));
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

/** Pad/crop only — never stretch. */
async function normalizeBitmap(
  src: HTMLCanvasElement,
  wantW: number,
  wantH: number,
): Promise<ImageBitmap> {
  if (src.width === wantW && src.height === wantH) {
    return createImageBitmap(src);
  }
  const out = document.createElement("canvas");
  out.width = wantW;
  out.height = wantH;
  const ctx = out.getContext("2d");
  if (!ctx) return createImageBitmap(src);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, wantW, wantH);
  const sw = Math.min(src.width, wantW);
  const sh = Math.min(src.height, wantH);
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, sw, sh);
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
