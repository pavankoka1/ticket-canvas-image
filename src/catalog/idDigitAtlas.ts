import { snapdom } from "@zumer/snapdom";

import { blobToBitmap, loadSprites, saveSprites, bitmapToPngBlob } from "./atlasStore";
import { getActiveLayout, type CatalogLayout } from "./catalogLayout";
import { activeDpr } from "./cellBoxModel";
import { fontIdentity } from "./cellAtlas";
import { applyTicketCssVars, type TicketMetrics } from "./ticketPresets";
import { ensureTicketFont } from "./ticketFont";
import { createTicketDom } from "./ticketCardElement";

/**
 * Header text (ticket ID + win amount) as **whole-string** SnapDOM sprites.
 *
 * Per-glyph composition always left a ±0.5px seam vs the DOM's continuous run
 * (and SnapDOM warned that inline captures need `reconcile: true`). Capturing
 * the real `.ticketCard__id` / `.ticketCard__win` node with its text is the same
 * philosophy as the cell atlas: the sprite *is* the DOM raster, so canvas cannot
 * drift. Cache is keyed by (text, color, layout, dpr, font); viewport strings
 * are few and ids repeat while scrolling.
 */

const ID_VERSION = "id-v6-string";

export type GlyphColor = "idNormal" | "idGold" | "win";

export type HeaderTextEntry = { text: string; color: GlyphColor };

type Rgb = { r: number; g: number; b: number };

const COLORS: Record<GlyphColor, Rgb> = {
  idNormal: { r: 177, g: 151, b: 151 }, // #B19797
  idGold: { r: 159, g: 128, b: 128 }, // #9F8080
  win: { r: 112, g: 79, b: 79 }, // #704F4F
};

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
  // Required for shrink-wrapped header spans — without it SnapDOM keeps
  // natural/fallback width and the string reflows vs the live DOM.
  reconcile: true,
};

/** RAM: full cache key → sprite. */
const ramCache = new Map<string, ImageBitmap>();
/** Active layout's sprite height (header × dpr), for paint. */
let activeSpriteH = 0;
let activeLayoutKey = "";
let warmPromise: Promise<boolean> | null = null;
let warmKey: string | null = null;
let gen = 0;
/** layoutKey → vertical ink-shift (mechanism B), measured once. */
const inkShiftByLayout = new Map<string, number>();

function layoutKey(layout: CatalogLayout, dpr: number): string {
  const m = layout.metrics;
  return [
    ID_VERSION,
    m.id,
    `meta=${m.metaFontSize}`,
    `hdr=${m.headerHeight}`,
    `dpr=${dpr}`,
    `font=${fontIdentity(m.metaFontSize)}`,
  ].join("|");
}

function entryKey(
  layoutKeyStr: string,
  text: string,
  color: GlyphColor,
): string {
  return `${layoutKeyStr}|${color}|${text}`;
}

export function idGlyphsReady(): boolean {
  return activeSpriteH > 0;
}

/** Strings cached for the active layout (stat display). */
export function idGlyphCount(): number {
  if (!activeLayoutKey) return 0;
  let n = 0;
  for (const k of ramCache.keys()) {
    if (k.startsWith(activeLayoutKey + "|")) n++;
  }
  return n;
}

export function getHeaderSprite(
  text: string,
  color: GlyphColor,
): ImageBitmap | undefined {
  if (!text || !activeLayoutKey) return undefined;
  return ramCache.get(entryKey(activeLayoutKey, text, color));
}

export function getGlyphSpriteHeightDev(): number {
  return activeSpriteH;
}

/** @deprecated per-glyph API removed — whole-string sprites only. */
export function getGlyphSprite(
  _char: string,
  _color: GlyphColor,
): ImageBitmap | undefined {
  return undefined;
}

/** @deprecated */
export function getGlyphAdvanceDev(_char: string): number {
  return 0;
}

/** @deprecated */
export function getGlyphAdvanceDevFloat(_char: string): number {
  return 0;
}

export const ID_GLYPH_TOTAL = 12; // retained for Catalog stat fallback label

export function resetIdGlyphsRam(): void {
  gen += 1;
  for (const b of ramCache.values()) b.close();
  ramCache.clear();
  inkShiftByLayout.clear();
  activeSpriteH = 0;
  activeLayoutKey = "";
  warmPromise = null;
  warmKey = null;
}

/**
 * Warm header string sprites for `entries` (deduped). Pass every visible
 * ticket's `no` / `win` so paint never falls back to fillText.
 */
export function warmIdGlyphs(
  host: HTMLElement,
  layout: CatalogLayout = getActiveLayout(),
  entries: readonly HeaderTextEntry[] = SEED_ENTRIES,
): Promise<boolean> {
  const dpr = activeDpr();
  const key = layoutKey(layout, dpr);
  const uniq = dedupeEntries(entries);
  const missing = uniq.filter(
    (e) => !ramCache.has(entryKey(key, e.text, e.color)),
  );

  activeLayoutKey = key;
  activeSpriteH = Math.round(layout.metrics.headerHeight * dpr);

  if (missing.length === 0) {
    console.info("[atlas:id]", {
      src: "ram",
      strings: uniq.length,
      dpr,
      font: fontIdentity(layout.metrics.metaFontSize),
    });
    return Promise.resolve(true);
  }

  const runKey = `${key}|n=${missing.length}|${missing.map((e) => e.text).join(",")}`;
  if (warmPromise && warmKey === runKey) return warmPromise;
  gen += 1;
  const myGen = gen;
  warmKey = runKey;
  warmPromise = buildHeaderStrings(host, layout, key, dpr, missing, myGen).finally(
    () => {
      if (warmKey === runKey) {
        warmPromise = null;
        warmKey = null;
      }
    },
  );
  return warmPromise;
}

const SEED_ENTRIES: HeaderTextEntry[] = [
  { text: "8", color: "idNormal" },
  { text: "8", color: "idGold" },
  { text: "1,234.56", color: "win" },
];

function dedupeEntries(
  entries: readonly HeaderTextEntry[],
): HeaderTextEntry[] {
  const seen = new Set<string>();
  const out: HeaderTextEntry[] = [];
  for (const e of entries) {
    if (!e.text) continue;
    const k = `${e.color}|${e.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

async function buildHeaderStrings(
  host: HTMLElement,
  layout: CatalogLayout,
  key: string,
  dpr: number,
  entries: HeaderTextEntry[],
  myGen: number,
): Promise<boolean> {
  const m = layout.metrics;
  const { face, mbOnest700, onest700 } = await ensureTicketFont(m.metaFontSize);
  console.info("[atlas:id] font", { face, mbOnest700, onest700 });
  if (myGen !== gen) return false;

  activeLayoutKey = key;
  activeSpriteH = Math.round(m.headerHeight * dpr);

  // Try IDB for the missing set as one blob pack keyed by content hash.
  const setKey = `${key}|vals=${entries.map((e) => `${e.color}:${e.text}`).join(";")}`;
  const stored = await loadSprites(setKey);
  if (myGen !== gen) return false;
  if (stored && stored.blobs.length === entries.length) {
    try {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        const bmp = await blobToBitmap(stored.blobs[i]!);
        ramCache.set(entryKey(key, e.text, e.color), bmp);
      }
      console.info("[atlas:id]", {
        src: "idb",
        strings: entries.length,
        dpr,
        font: fontIdentity(m.metaFontSize),
      });
      return true;
    } catch {
      // fall through
    }
  }

  applyTicketCssVars(host, m);
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";

  // Mechanism-B ink shift — measure once per layout key, reuse across string batches.
  let inkShift = inkShiftByLayout.get(key) ?? null;
  if (inkShift == null) {
    const probe = await captureRawString(host, m, dpr, "8", "idNormal", true);
    inkShift = 0;
    if (probe) {
      const nativeCentre = nativeHeaderInkCentreDevice(host, m, dpr);
      const ink8 = scanInkBBox(probe);
      if (ink8 && nativeCentre != null) {
        inkShift = Math.round(nativeCentre - ink8.center);
      }
      console.log("[id:INK-FIX]", {
        preset: m.id,
        dpr,
        nativeInkCentre: nativeCentre == null ? "n/a" : +nativeCentre.toFixed(2),
        spriteInkCentre: ink8 ? +ink8.center.toFixed(2) : "n/a",
        inkShift,
      });
    }
    inkShiftByLayout.set(key, inkShift);
  }
  if (myGen !== gen) return false;

  const blobs: Blob[] = [];
  for (const e of entries) {
    if (myGen !== gen) return false;
    const raw = await captureRawString(host, m, dpr, e.text, e.color, false);
    if (!raw) continue;
    const mask = toCoverageMask(raw);
    if (!mask) continue;
    const spriteH = Math.round(m.headerHeight * dpr);
    // Keep full string width; only normalise height + ink-shift.
    const norm = fitMaskHeight(mask, spriteH, inkShift);
    const tinted = await tint(norm, COLORS[e.color]);
    ramCache.set(entryKey(key, e.text, e.color), tinted);
    // Persist the already-tinted sprite (color is part of the entry key).
    blobs.push(await bitmapToPngBlob(tinted));
    await yieldToMain();
  }

  if (myGen !== gen) return false;

  console.info("[atlas:id]", {
    src: "snap",
    strings: entries.length,
    dpr,
    font: fontIdentity(m.metaFontSize),
    spriteH: activeSpriteH,
    inkShift,
  });

  try {
    await saveSprites({
      key: setKey,
      meta: { entries, inkShift, spriteH: activeSpriteH },
      blobs,
    });
  } catch (err) {
    console.warn("[id-atlas] persist failed", err);
  }
  return true;
}

function yieldToMain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * SnapDOM a real header id/win span (shrink-wrapped) with black ink over white.
 * Discard cold first capture when `warm` is true.
 */
async function captureRawString(
  host: HTMLElement,
  m: TicketMetrics,
  dpr: number,
  text: string,
  color: GlyphColor,
  warm: boolean,
): Promise<HTMLCanvasElement | null> {
  const ticket = createTicketDom();
  ticket.root.style.position = "relative";
  ticket.root.style.width = `${getActiveLayout().cardWidth}px`;
  ticket.root.style.height = `${m.cardHeight}px`;
  ticket.root.style.background = "#FFFFFF";
  ticket.root.style.boxShadow = "none";
  applyTicketCssVars(ticket.root, m);

  if (color === "idGold") ticket.root.classList.add("ticketCard_win");

  const target =
    color === "win"
      ? (ticket.root.querySelector(".ticketCard__win") as HTMLElement)
      : (ticket.root.querySelector(".ticketCard__id") as HTMLElement);

  // Shrink-wrap so the sprite is the text run, not the flex:1 half-header.
  target.style.flex = "0 0 auto";
  target.style.width = "max-content";
  target.style.minWidth = "0";
  target.style.background = "#FFFFFF";
  target.style.color = "#000000";

  if (color === "win") {
    ticket.winText.data = text;
    ticket.idText.data = "";
  } else {
    ticket.idText.data = text;
    ticket.winText.data = "";
  }

  host.appendChild(ticket.root);
  void ticket.root.offsetWidth;

  try {
    if (warm) {
      await snapdom.toCanvas(target, { ...SNAP_OPTS, dpr, invalidate: true });
    }
    const raw = (await snapdom.toCanvas(target, {
      ...SNAP_OPTS,
      dpr,
      invalidate: true,
    })) as HTMLCanvasElement;
    return raw;
  } catch {
    return null;
  } finally {
    ticket.root.remove();
  }
}

function toCoverageMask(raw: HTMLCanvasElement): ImageData | null {
  const ctx = raw.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, raw.width, raw.height);
  } catch {
    return null;
  }
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
    const cov = (255 - lum) / 255;
    d[i] = 0;
    d[i + 1] = 0;
    d[i + 2] = 0;
    d[i + 3] = Math.round(cov * 255);
  }
  return img;
}

async function tint(mask: ImageData, color: Rgb): Promise<ImageBitmap> {
  const c = document.createElement("canvas");
  c.width = mask.width;
  c.height = mask.height;
  const ctx = c.getContext("2d")!;
  const out = ctx.createImageData(mask.width, mask.height);
  const src = mask.data;
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    dst[i] = color.r;
    dst[i + 1] = color.g;
    dst[i + 2] = color.b;
    dst[i + 3] = src[i + 3]!;
  }
  ctx.putImageData(out, 0, 0);
  return createImageBitmap(c);
}

/** Pad/crop vertically to header height; keep full string width. */
function fitMaskHeight(mask: ImageData, wantH: number, shiftY = 0): ImageData {
  if (mask.height === wantH && shiftY === 0) return mask;
  const c = document.createElement("canvas");
  c.width = mask.width;
  c.height = mask.height;
  c.getContext("2d")!.putImageData(mask, 0, 0);
  const out = document.createElement("canvas");
  out.width = mask.width;
  out.height = wantH;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(c, 0, 0, mask.width, mask.height, 0, shiftY, mask.width, mask.height);
  return octx.getImageData(0, 0, mask.width, wantH);
}

function scanInkBBox(
  canvas: HTMLCanvasElement,
): { top: number; bottom: number; height: number; center: number } | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return null;
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

function inkOffsetFromBaseline(fontSizePx: number): number | null {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.font = `700 ${fontSizePx}px MB-Onest, Onest, system-ui, sans-serif`;
  const tm = ctx.measureText("8");
  if (
    typeof tm.actualBoundingBoxAscent !== "number" ||
    typeof tm.actualBoundingBoxDescent !== "number"
  ) {
    return null;
  }
  return (tm.actualBoundingBoxDescent - tm.actualBoundingBoxAscent) / 2;
}

function nativeHeaderInkCentreDevice(
  host: HTMLElement,
  m: TicketMetrics,
  dpr: number,
): number | null {
  const probe = document.createElement("div");
  probe.style.cssText = [
    "position:absolute",
    "left:-9999px",
    "top:0",
    "visibility:hidden",
    "display:flex",
    "flex-direction:column",
    "justify-content:flex-end",
    "align-items:flex-start",
    "margin:0",
    "padding:0",
    `width:40px`,
    `height:${m.headerHeight}px`,
    `font-size:${m.metaFontSize}px`,
    "font-weight:700",
    "font-family:MB-Onest, Onest, system-ui, sans-serif",
    "line-height:normal",
    "-webkit-font-smoothing:antialiased",
    "text-rendering:geometricPrecision",
  ].join(";");
  const line = document.createElement("span");
  line.style.cssText = "display:block;white-space:nowrap;margin:0;padding:0";
  const strut = document.createElement("span");
  strut.style.cssText =
    "display:inline-block;width:0;height:0;vertical-align:baseline";
  line.append(document.createTextNode("8"), strut);
  probe.appendChild(line);
  host.appendChild(probe);
  const pr = probe.getBoundingClientRect();
  const sr = strut.getBoundingClientRect();
  const baselineCss = sr.top - pr.top;
  probe.remove();
  const inkOffsetCss = inkOffsetFromBaseline(m.metaFontSize);
  if (inkOffsetCss == null) return null;
  return (baselineCss + inkOffsetCss) * dpr;
}
