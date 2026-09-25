import { snapdom } from "@zumer/snapdom";

import { blobToBitmap, loadSprites, saveSprites, bitmapToPngBlob } from "./atlasStore";
import { getActiveLayout, type CatalogLayout } from "./catalogLayout";
import { activeDpr } from "./cellBoxModel";
import { fontIdentity } from "./cellAtlas";
import { applyTicketCssVars, type TicketMetrics } from "./ticketPresets";
import { ensureTicketFont } from "./ticketFont";
import { createTicketDom } from "./ticketCardElement";
import { isWinTicket, type Ticket } from "./tickets";

/**
 * Header text (ticket ID + win amount) as **full-header** SnapDOM sprites.
 *
 * Capture the real `.ticketCard__header` at live card width so id/win sit in the
 * same flex slots as DOM. Shrink-wrap + right-align paint drifted horizontally
 * (and broke across ticket sizes). Sprite = cardWidth × headerHeight; paint at
 * ticket origin. Cache keyed by (text, color, cardWidth, layout, dpr, font).
 */

const ID_VERSION = "id-v13-edgeX";
/** Bust old header bitmaps while proving edge X lock (same as SKIP_BADGE_IDB). */
const SKIP_ID_IDB = true;

export type GlyphColor = "idNormal" | "idGold" | "win";

export type HeaderTextEntry = { text: string; color: GlyphColor };

/** Ticket nos (and wins) to warm — same set /compare uses for header sprites. */
export function headerEntriesForTickets(
  tickets: readonly Ticket[],
): HeaderTextEntry[] {
  const out: HeaderTextEntry[] = [];
  for (const t of tickets) {
    if (t.disabled) continue;
    const idColor: GlyphColor = isWinTicket(t) ? "idGold" : "idNormal";
    out.push({ text: t.no, color: idColor });
    if (isWinTicket(t) && t.win) out.push({ text: t.win, color: "win" });
  }
  return out;
}

type Rgb = { r: number; g: number; b: number };

const COLORS: Record<GlyphColor, Rgb> = {
  idNormal: { r: 177, g: 151, b: 151 }, // #B19797
  idGold: { r: 159, g: 128, b: 128 }, // #9F8080
  win: { r: 112, g: 79, b: 79 }, // #704F4F
};

const SNAP_OPTS = {
  embedFonts: true,
  outerTransforms: false,
  outerShadows: false,
  backgroundColor: "#FFFFFF" as const,
  fast: true,
  cache: "disabled" as const,
  compress: false,
  scale: 1,
  burst: true,
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
    `cw=${layout.cardWidth}`,
    `meta=${m.metaFontSize}`,
    `hdr=${m.headerHeight}`,
    `pad=${m.headerPadX}`,
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

/** PNG data-URL for /compare overlay + download. */
export function getHeaderSpriteDataUrl(
  text: string,
  color: GlyphColor,
): string | null {
  const bmp = getHeaderSprite(text, color);
  if (!bmp) return null;
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  return c.toDataURL("image/png");
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
  if (!SKIP_ID_IDB) {
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
  } else {
    console.info("[atlas:id] SKIP_ID_IDB — forcing SnapDOM");
  }

  applyTicketCssVars(host, m);
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";

  // Mechanism-B ink shift Y — measure once per layout key (do NOT retune for X).
  let inkShiftY = inkShiftByLayout.get(key) ?? null;
  if (inkShiftY == null) {
    const probe = await captureRawString(host, m, dpr, "8", "idNormal", true);
    inkShiftY = 0;
    if (probe) {
      const nativeCentre = nativeHeaderInkCentreDevice(host, m, dpr);
      const ink8 = scanInkBBoxY(probe.raw);
      if (ink8 && nativeCentre != null) {
        inkShiftY = Math.round(nativeCentre - ink8.center);
      }
      console.log("[id:INK-FIX]", {
        preset: m.id,
        dpr,
        nativeInkCentre: nativeCentre == null ? "n/a" : +nativeCentre.toFixed(2),
        spriteInkCentre: ink8 ? +ink8.center.toFixed(2) : "n/a",
        inkShift: inkShiftY,
        note: "Y only — X = id right-edge / win left-edge vs sprite ink",
      });
    }
    inkShiftByLayout.set(key, inkShiftY);
  }
  if (myGen !== gen) return false;

  const blobs: Blob[] = [];
  for (const e of entries) {
    if (myGen !== gen) return false;
    const captured = await captureRawString(host, m, dpr, e.text, e.color, false);
    if (!captured) continue;
    const { raw, shiftX, probe } = captured;
    if (probe) {
      console.info("[compare:probe]", {
        dpr,
        id: {
          text: e.text,
          color: e.color,
          ...probe,
          shiftX,
          evidence:
            e.color === "win"
              ? probe.domRect.left < probe.spriteInkBBox.left - 0.5
                ? "win: dom left of sprite ink → canvas sits RIGHT of DOM"
                : "win left≈aligned"
              : probe.domRect.right < probe.spriteInkBBox.right - 0.5
                ? "id: dom right of sprite ink → canvas sits RIGHT of DOM"
                : "id right≈aligned",
        },
        cellOrigin: null,
      });
    }
    const mask = toCoverageMask(raw);
    if (!mask) continue;
    const spriteW = Math.round(layout.cardWidth * dpr);
    const spriteH = Math.round(m.headerHeight * dpr);
    // Y = mechanism-B; X = id right-edge / win left-edge lock.
    const norm = fitMaskBox(mask, spriteW, spriteH, inkShiftY, shiftX);
    const tinted = await tint(norm, COLORS[e.color]);
    ramCache.set(entryKey(key, e.text, e.color), tinted);
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
    inkShiftY,
  });

  if (!SKIP_ID_IDB) {
    try {
      await saveSprites({
        key: setKey,
        meta: { entries, inkShiftY, spriteH: activeSpriteH },
        blobs,
      });
    } catch (err) {
      console.warn("[id-atlas] persist failed", err);
    }
  }
  return true;
}

function yieldToMain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

type InkBBox2D = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

type DomRectDev = InkBBox2D;

type CaptureResult = {
  raw: HTMLCanvasElement;
  shiftX: number;
  /** Required probe for Bug A (ticket id). */
  probe: { domRect: DomRectDev; spriteInkBBox: InkBBox2D } | null;
};

/**
 * SnapDOM the live `.ticketCard__header` on a ticket so CSS vars stay inherited.
 * X lock: id → right edges; win → left edges (atlas shiftX). Y stays mechanism-B.
 */
async function captureRawString(
  host: HTMLElement,
  m: TicketMetrics,
  dpr: number,
  text: string,
  color: GlyphColor,
  warm: boolean,
): Promise<CaptureResult | null> {
  const cardWidth = getActiveLayout().cardWidth;
  const ticket = createTicketDom();
  ticket.root.style.position = "relative";
  ticket.root.style.width = `${cardWidth}px`;
  ticket.root.style.height = `${m.cardHeight}px`;
  ticket.root.style.background = "#FFFFFF";
  ticket.root.style.boxShadow = "none";
  applyTicketCssVars(ticket.root, m);

  const header = ticket.root.querySelector(
    ".ticketCard__header",
  ) as HTMLElement;
  header.style.background = "#FFFFFF";
  header.style.overflow = "hidden";

  const idEl = ticket.root.querySelector(".ticketCard__id") as HTMLElement;
  const winEl = ticket.root.querySelector(".ticketCard__win") as HTMLElement;
  idEl.style.color = "#000000";
  winEl.style.color = "#000000";

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
      await snapdom.toCanvas(header, { ...SNAP_OPTS, dpr, invalidate: true });
    }
    const raw = (await snapdom.toCanvas(header, {
      ...SNAP_OPTS,
      dpr,
      invalidate: true,
    })) as HTMLCanvasElement;

    const targetEl = color === "win" ? winEl : idEl;
    const domRect = textRectDev(targetEl, header, dpr);
    const spriteInkBBox = scanInkBBox2D(raw);
    let shiftX = 0;
    if (domRect && spriteInkBBox) {
      // Id is right-aligned; win is left-aligned at headerPadX.
      shiftX =
        color === "win"
          ? Math.round(domRect.left - spriteInkBBox.left)
          : Math.round(domRect.right - spriteInkBBox.right);
    }

    return {
      raw,
      shiftX,
      probe:
        domRect && spriteInkBBox ? { domRect, spriteInkBBox } : null,
    };
  } catch {
    return null;
  } finally {
    ticket.root.remove();
  }
}

/** Live text ink via Range, device px relative to `root` (header = sprite space). */
function textRectDev(
  el: HTMLElement,
  root: HTMLElement,
  dpr: number,
): DomRectDev | null {
  const node = el.firstChild;
  if (!node) return null;
  const range = document.createRange();
  range.selectNodeContents(node);
  const r = range.getBoundingClientRect();
  const rootR = root.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  const left = (r.left - rootR.left) * dpr;
  const top = (r.top - rootR.top) * dpr;
  const right = (r.right - rootR.left) * dpr;
  const bottom = (r.bottom - rootR.top) * dpr;
  return {
    left,
    top,
    right,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    width: right - left,
    height: bottom - top,
  };
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

/** Exact header device box; shiftX/Y move ink to match live DOM (atlas-side). */
function fitMaskBox(
  mask: ImageData,
  wantW: number,
  wantH: number,
  shiftY = 0,
  shiftX = 0,
): ImageData {
  if (
    mask.width === wantW &&
    mask.height === wantH &&
    shiftY === 0 &&
    shiftX === 0
  ) {
    return mask;
  }
  const c = document.createElement("canvas");
  c.width = mask.width;
  c.height = mask.height;
  c.getContext("2d")!.putImageData(mask, 0, 0);
  const out = document.createElement("canvas");
  out.width = wantW;
  out.height = wantH;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(c, shiftX, shiftY);
  return octx.getImageData(0, 0, wantW, wantH);
}

/** 2D ink bbox in device px (white or transparent face). */
function scanInkBBox2D(canvas: HTMLCanvasElement): InkBBox2D | null {
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
  let left = w;
  let right = -1;
  let top = h;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3]! / 255;
      if (a < 0.02) continue;
      const r = data[i]! * a + 255 * (1 - a);
      const g = data[i + 1]! * a + 255 * (1 - a);
      const b = data[i + 2]! * a + 255 * (1 - a);
      if (r < 200 || g < 200 || b < 200) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < left || bottom < top) return null;
  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right + 1) / 2,
    centerY: (top + bottom + 1) / 2,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

/** Vertical-only ink centre (existing mechanism-B probe). */
function scanInkBBoxY(
  canvas: HTMLCanvasElement,
): { top: number; bottom: number; height: number; center: number } | null {
  const box = scanInkBBox2D(canvas);
  if (!box) return null;
  return {
    top: box.top,
    bottom: box.bottom,
    height: box.height,
    center: box.centerY,
  };
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
