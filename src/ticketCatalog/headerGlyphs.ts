/**
 * Header text for the catalog canvas.
 *
 * Ticket ids: ten digit bitmaps per face color, pre-warmed at atlas time (IDB).
 * Paint stacks them right-to-left — same model as the 5032e76 catalog path.
 * Win amounts: whole-string bitmaps when that payout string first appears.
 */

import { loadSprites, saveSprites } from "./atlasStore";
import { activeDpr } from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { decodePngBlobsToCanvases } from "./spriteDecodeClient";
import {
  decodeSvgBlobToCanvas,
  rasterizeTicketSvg,
  rasterSvgBlob,
  svgBlobToPngBlob,
} from "./ticketSvgRaster";
import { TicketCard } from "./ticketCardElement";
import { ensureTicketFont } from "./ticketFont";
import { isWinTicket, type Ticket } from "./tickets";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export type IdColor = "idNormal" | "idGold" | "idDisabled";

const ID_FACES: readonly { color: IdColor; win: boolean; disabled: boolean }[] = [
  { color: "idNormal", win: false, disabled: false },
  { color: "idGold", win: true, disabled: false },
  { color: "idDisabled", win: false, disabled: true },
];

const TICKET_ID_DIGIT_PACK = "ticket-id-digits-v5-tight-png";
const TICKET_ID_DIGIT_PACK_LEGACY = "ticket-id-digits-v1";
const DIGIT_WARM_TOTAL = DIGITS.length * ID_FACES.length;

type InkBBox2D = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type Glyph = {
  canvas: HTMLCanvasElement;
  /** Ink left vs measureText slotLeft for digit in 8{digit}8 probe (device px). */
  inkOffsetDev: number;
  /** Ink bottom inset from header bottom at single-char capture (device px). */
  inkBottomInsetDev: number;
};

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
  return { left, right, top, bottom };
}

function glyphInk(canvas: HTMLCanvasElement): InkBBox2D {
  const box = scanInkBBox2D(canvas);
  return (
    box ?? {
      left: 0,
      right: canvas.width - 1,
      top: 0,
      bottom: canvas.height - 1,
    }
  );
}

const digits = new Map<string, Glyph>();
/** SVG blobs for IDB — never export tainted digit canvases. */
const digitExportBlobs = new Map<string, Blob>();
const amounts = new Map<string, HTMLCanvasElement>();
let digitPromise: Promise<void> | null = null;
let digitRunKey: string | null = null;
let hydratedDigitLayoutKey = "";

type StoredDigitMeta = {
  entries: { color: IdColor; digit: string }[];
};

export function headerStyleKey(): string {
  const layout = getActiveLayout();
  const m = layout.metrics;
  return `${m.id}|${layout.cardWidth}|hdr-v5|meta=${m.metaFontSize}`;
}

function styleKey(): string {
  return headerStyleKey();
}

/** Fixed digit order for catalog atlas pack (10 × 3 colors). */
export function catalogDigitPackEntries(): { color: IdColor; digit: string }[] {
  const entries: { color: IdColor; digit: string }[] = [];
  for (const face of ID_FACES) {
    for (const ch of DIGITS) entries.push({ color: face.color, digit: ch });
  }
  return entries;
}

export function idDigitPackIdbKey(): string {
  return `${TICKET_ID_DIGIT_PACK}|${styleKey()}`;
}

function digitPackKey(): string {
  return idDigitPackIdbKey();
}

function digitCacheKey(color: IdColor, ch: string): string {
  return `${styleKey()}|${color}|${ch}`;
}

function amountCacheKey(text: string): string {
  return `${styleKey()}|win|${text}`;
}

export function idColorFor(ticket: Ticket): IdColor {
  if (ticket.disabled) return "idDisabled";
  return isWinTicket(ticket) ? "idGold" : "idNormal";
}

function digitGlyphsReady(): boolean {
  const key = styleKey();
  return ID_FACES.every((face) => digits.has(`${key}|${face.color}|0`));
}

export function isTicketIdReady(ticket: Ticket): boolean {
  if (!ticket.no) return true;
  if (!digitGlyphsReady()) return false;
  const color = idColorFor(ticket);
  for (const ch of ticket.no) {
    if (!digits.has(digitCacheKey(color, ch))) return false;
  }
  return true;
}

export function isAmountReady(text: string): boolean {
  if (!text) return true;
  return amounts.has(amountCacheKey(text));
}

/** Fixed digit atlas: 10 digits × 3 header colors (independent of ticket count). */
export function ticketIdWarmProgress(_tickets: readonly Ticket[]): {
  ready: number;
  total: number;
} {
  const key = styleKey();
  let ready = 0;
  for (const face of ID_FACES) {
    for (const ch of DIGITS) {
      if (digits.has(`${key}|${face.color}|${ch}`)) ready += 1;
    }
  }
  return { ready, total: DIGIT_WARM_TOTAL };
}

function parseDigitCacheKey(
  cacheKey: string,
  layoutKey: string,
): { color: IdColor; digit: string } | null {
  if (!cacheKey.startsWith(`${layoutKey}|`)) return null;
  for (const face of ID_FACES) {
    const needle = `|${face.color}|`;
    const idx = cacheKey.indexOf(needle, layoutKey.length);
    if (idx !== layoutKey.length) continue;
    const digit = cacheKey.slice(idx + needle.length);
    if (digit.length !== 1) return null;
    return { color: face.color, digit };
  }
  return null;
}

export function resetDigitHydration(): void {
  hydratedDigitLayoutKey = "";
  digits.clear();
  digitExportBlobs.clear();
}

export function installDigitsFromPack(
  entries: readonly { color: IdColor; digit: string }[],
  canvases: readonly (HTMLCanvasElement | null)[],
  blobs: readonly Blob[],
): void {
  const layoutKey = styleKey();
  hydratedDigitLayoutKey = layoutKey;
  digits.clear();
  digitExportBlobs.clear();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const canvas = canvases[i];
    const blob = blobs[i];
    if (!canvas) continue;
    const cacheId = `${layoutKey}|${entry.color}|${entry.digit}`;
    digits.set(cacheId, { canvas, inkOffsetDev: 0, inkBottomInsetDev: 0 });
    if (blob) digitExportBlobs.set(cacheId, blob);
  }
}

export async function captureDigitPackPngs(
  host: HTMLElement,
): Promise<{ entries: { color: IdColor; digit: string }[]; blobs: Blob[] }> {
  await captureMissingDigits(host, false);
  const layoutKey = styleKey();
  const entries = catalogDigitPackEntries();
  const blobs: Blob[] = [];
  for (const entry of entries) {
    const cacheId = `${layoutKey}|${entry.color}|${entry.digit}`;
    const blob = digitExportBlobs.get(cacheId);
    if (!blob) throw new Error("digit pack capture incomplete");
    blobs.push(blob);
  }
  return { entries, blobs };
}

export function amountPackSection(): { entries: string[]; blobs: Blob[] } {
  const layoutKey = styleKey();
  const prefix = `${layoutKey}|win|`;
  const entries: string[] = [];
  const blobs: Blob[] = [];
  for (const [cacheId, canvas] of amounts) {
    if (!cacheId.startsWith(prefix)) continue;
    const text = cacheId.slice(prefix.length);
    const exportBlob = rasterSvgBlob(canvas);
    if (!exportBlob) continue;
    entries.push(text);
    blobs.push(exportBlob);
  }
  return { entries, blobs };
}

export async function hydrateAmountsFromPack(
  entries: readonly string[],
  blobs: readonly Blob[],
): Promise<void> {
  if (entries.length !== blobs.length) return;
  const pngLike = blobs[0]?.type.includes("png");
  for (let i = 0; i < entries.length; i++) {
    const text = entries[i]!;
    const blob = blobs[i]!;
    const cacheId = amountCacheKey(text);
    if (amounts.has(cacheId)) continue;
    const canvas = pngLike
      ? (await decodePngBlobsToCanvases([blob]))[0]
      : await decodeSvgBlobToCanvas(blob).catch(() => null);
    if (canvas) amounts.set(cacheId, canvas);
  }
}

export function rememberAmountCanvas(text: string, canvas: HTMLCanvasElement): void {
  amounts.set(amountCacheKey(text), canvas);
}

async function hydrateDigitsFromIdb(): Promise<void> {
  const layoutKey = styleKey();
  if (hydratedDigitLayoutKey === layoutKey && digitGlyphsReady()) return;
  digits.clear();
  digitExportBlobs.clear();

  let stored = await loadSprites(digitPackKey());
  let legacySvg = false;
  if (!stored?.blobs?.length) {
    stored = await loadSprites(`${TICKET_ID_DIGIT_PACK_LEGACY}|${layoutKey}`);
    legacySvg = !!stored?.blobs?.length;
  }
  if (!stored?.meta || !stored.blobs.length) {
    hydratedDigitLayoutKey = "";
    return;
  }
  const meta = stored.meta as StoredDigitMeta;
  if (!meta.entries || meta.entries.length !== stored.blobs.length) {
    hydratedDigitLayoutKey = "";
    return;
  }

  const canvases = legacySvg
    ? await Promise.all(
        stored.blobs.map((b) => decodeSvgBlobToCanvas(b).catch(() => null)),
      )
    : await decodePngBlobsToCanvases(stored.blobs);

  for (let i = 0; i < meta.entries.length; i++) {
    const entry = meta.entries[i]!;
    const cacheId = `${layoutKey}|${entry.color}|${entry.digit}`;
    const blob = stored.blobs[i]!;
    const canvas = canvases[i];
    if (!canvas) continue;
    digitExportBlobs.set(cacheId, blob);
    digits.set(cacheId, { canvas, inkOffsetDev: 0, inkBottomInsetDev: 0 });
  }

  if (legacySvg && digitGlyphsReady()) {
    void persistDigitsToIdb();
  }
  hydratedDigitLayoutKey = digitGlyphsReady() ? layoutKey : "";
}

async function persistDigitsToIdb(): Promise<void> {
  const layoutKey = styleKey();
  const prefix = `${layoutKey}|`;
  const entries: { color: IdColor; digit: string }[] = [];
  const blobs: Blob[] = [];
  for (const cacheId of digits.keys()) {
    if (!cacheId.startsWith(prefix)) continue;
    const parsed = parseDigitCacheKey(cacheId, layoutKey);
    if (!parsed) continue;
    let blob = digitExportBlobs.get(cacheId);
    if (!blob) continue;
    if (blob.type.includes("svg") || blob.type.includes("xml")) {
      const png = await svgBlobToPngBlob(blob);
      if (png) {
        blob = png;
        digitExportBlobs.set(cacheId, blob);
      }
    }
    entries.push(parsed);
    blobs.push(blob);
  }
  if (entries.length === 0) return;
  await saveSprites({ key: digitPackKey(), meta: { entries }, blobs });
}

function shrinkToInk(el: HTMLElement): void {
  el.style.flex = "none";
  el.style.width = "auto";
  el.style.height = "auto";
  el.style.display = "inline-flex";
  el.style.margin = "0";
  el.style.position = "static";
  el.style.whiteSpace = "nowrap";
}

function resetIdElForHeader(el: HTMLElement): void {
  el.style.flex = "";
  el.style.width = "";
  el.style.height = "";
  el.style.display = "";
  el.style.margin = "";
  el.style.position = "";
  el.style.whiteSpace = "";
}

function resetWinElForHeader(el: HTMLElement): void {
  el.style.flex = "";
  el.style.width = "";
  el.style.height = "";
  el.style.display = "";
  el.style.margin = "";
  el.style.position = "";
  el.style.whiteSpace = "";
}

function setElementText(el: HTMLElement, text: string): void {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      (node as Text).data = text;
      return;
    }
  }
}

function blankTicket(no: string, win: boolean, amount: string, disabled = false): Ticket {
  return {
    id: "header-glyph-src",
    no,
    balls: [1, 1, 1, 1, 1, 1],
    hits: win ? [0, 1] : [],
    multipliers: {},
    win: amount,
    disabled,
  };
}

async function withCard(
  host: HTMLElement,
  run: (card: TicketCard) => Promise<void>,
): Promise<void> {
  const card = new TicketCard();
  card.dom.style.position = "fixed";
  card.dom.style.left = "-10000px";
  card.dom.style.top = "0";
  host.appendChild(card.dom);
  try {
    await run(card);
  } finally {
    card.dom.remove();
  }
}

async function captureMissingDigits(
  host: HTMLElement,
  persistLegacyIdb = true,
): Promise<void> {
  await ensureTicketFont(getActiveLayout().metrics.metaFontSize);
  const paintDpr = activeDpr();
  let captured = 0;

  await withCard(host, async (card) => {
    const idEl = card.dom.querySelector(".ticketCard__id");
    if (!(idEl instanceof HTMLElement)) throw new Error("id glyph source missing");
    for (const face of ID_FACES) {
      for (const ch of DIGITS) {
        const cacheId = digitCacheKey(face.color, ch);
        if (digits.has(cacheId)) continue;
        card.bind(blankTicket(ch, face.win, "", face.disabled));
        resetIdElForHeader(idEl);
        setElementText(idEl, ch);
        shrinkToInk(idEl);
        const canvas = await rasterizeTicketSvg(idEl, paintDpr);
        digits.set(cacheId, { canvas, inkOffsetDev: 0, inkBottomInsetDev: 0 });
        const exportBlob = rasterSvgBlob(canvas);
        if (exportBlob) digitExportBlobs.set(cacheId, exportBlob);
        captured += 1;
      }
    }
  });

  if (captured > 0 && persistLegacyIdb) await persistDigitsToIdb();
}

/**
 * Hydrate digit sprites from IndexedDB, then SnapDOM any missing 0–9 glyphs
 * (× normal, gold, disabled). Runs at atlas warm — not when tickets are added.
 */
export function warmIdDigits(host: HTMLElement): Promise<void> {
  const layoutKey = styleKey();
  if (digitGlyphsReady()) return Promise.resolve();
  if (digitPromise && digitRunKey === layoutKey) return digitPromise;

  digitRunKey = layoutKey;
  const run = (async () => {
    await hydrateDigitsFromIdb();
    if (!digitGlyphsReady()) await captureMissingDigits(host);
  })().finally(() => {
    if (digitRunKey === layoutKey) {
      digitPromise = null;
      digitRunKey = null;
    }
  });
  digitPromise = run;
  return run;
}

export function idDigitCount(): number {
  const key = styleKey();
  let n = 0;
  for (const face of ID_FACES) {
    for (const ch of DIGITS) {
      if (digits.has(`${key}|${face.color}|${ch}`)) n += 1;
    }
  }
  return n;
}

/** Capture any win-amount string that is not already stored. */
export async function warmAmounts(
  host: HTMLElement,
  texts: readonly string[],
): Promise<void> {
  const missing = [...new Set(texts.filter((t) => t && !amounts.has(amountCacheKey(t))))];
  if (!missing.length) return;
  await ensureTicketFont(getActiveLayout().metrics.metaFontSize);
  const paintDpr = activeDpr();
  await withCard(host, async (card) => {
    const winEl = card.dom.querySelector(".ticketCard__win");
    if (!(winEl instanceof HTMLElement)) throw new Error("amount source missing");
    for (const text of missing) {
      const cacheId = amountCacheKey(text);
      if (amounts.has(cacheId)) continue;
      card.bind(blankTicket("1", true, text));
      resetWinElForHeader(winEl);
      setElementText(winEl, text);
      const canvas = await rasterizeTicketSvg(winEl, paintDpr);
      amounts.set(cacheId, canvas);
    }
  });
}

/** Sprite blobs for amounts in RAM (SVG pack bytes; PNG when encode works). */
export async function exportAmountPackBlobs(): Promise<{
  entries: string[];
  blobs: Blob[];
}> {
  const { entries, blobs: svgBlobs } = amountPackSection();
  if (entries.length === 0) return { entries: [], blobs: [] };
  const blobs: Blob[] = [];
  for (const svg of svgBlobs) {
    const png = await svgBlobToPngBlob(svg);
    blobs.push(png ?? svg);
  }
  return { entries, blobs };
}

/** Right-aligned id, bottom of header (fix-branch stack, paint-DPR sprites). */
export function paintIdDigits(
  ctx: CanvasRenderingContext2D,
  text: string,
  color: IdColor,
  originX: number,
  originY: number,
  cardWidth: number,
  paintDpr: number,
  scaleX: number,
  scaleY: number,
  digitInkLeftsDev?: readonly number[] | null,
): void {
  const m = getActiveLayout().metrics;
  const bottom = originY + Math.round(m.headerHeight * scaleY);

  if (digitInkLeftsDev && digitInkLeftsDev.length >= text.length) {
    for (let i = 0; i < text.length; i++) {
      const glyph = digits.get(digitCacheKey(color, text[i] ?? ""));
      if (!glyph) continue;
      const ink = glyphInk(glyph.canvas);
      const drawW = Math.round(glyph.canvas.width * scaleX / paintDpr);
      const drawH = Math.round(glyph.canvas.height * scaleY / paintDpr);
      const drawX =
        digitInkLeftsDev[i]! - Math.round(ink.left * scaleX / paintDpr);
      ctx.drawImage(
        glyph.canvas,
        drawX,
        bottom - drawH,
        drawW,
        drawH,
      );
    }
    return;
  }

  let x =
    originX +
    Math.round(cardWidth * scaleX) -
    Math.round(m.headerPadX * scaleX);
  for (let i = text.length - 1; i >= 0; i--) {
    const glyph = digits.get(digitCacheKey(color, text[i] ?? ""));
    if (!glyph) continue;
    const drawW = Math.round(glyph.canvas.width * scaleX / paintDpr);
    const drawH = Math.round(glyph.canvas.height * scaleY / paintDpr);
    x -= drawW;
    ctx.drawImage(glyph.canvas, x, bottom - drawH, drawW, drawH);
  }
}

/** Left-aligned amount, bottom of the header. */
export function paintAmount(
  ctx: CanvasRenderingContext2D,
  text: string,
  originX: number,
  originY: number,
  paintDpr: number,
  scaleX: number,
  scaleY: number,
): void {
  const canvas = amounts.get(amountCacheKey(text));
  if (!canvas) return;
  const m = getActiveLayout().metrics;
  const x = originX + Math.round(m.headerPadX * scaleX);
  const bottom = originY + Math.round(m.headerHeight * scaleY);
  const drawW = Math.round(canvas.width * scaleX / paintDpr);
  const drawH = Math.round(canvas.height * scaleY / paintDpr);
  ctx.drawImage(canvas, x, bottom - drawH, drawW, drawH);
}
