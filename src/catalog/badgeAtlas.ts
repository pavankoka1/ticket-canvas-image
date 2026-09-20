import { snapdom } from "@zumer/snapdom";

import {
  bitmapToPngBlob,
  blobToBitmap,
  loadSprites,
  saveSprites,
} from "./atlasStore";
import { getActiveLayout } from "./catalogLayout";
import { fontIdentity } from "./cellAtlas";
import { activeDpr } from "./cellBoxModel";
import { MultiplierLabelNode } from "./multiplierLabel";
import { applyTicketCssVars } from "./ticketPresets";

/**
 * Dab/multiplier disc art (static PNGs) + per-value multiplier label sprites.
 *
 * - Plain dab   → blit dab-full.png (crown disc) centred on the cell.
 * - Multiplier  → blit badge-circle.png (rim disc) + a SnapDOM sprite of the
 *   3-layer "N×" label (only a handful of values, so RAM cache is fine).
 * Discs are art, not text — no ink-shift needed; they're centred on the cell.
 */

const dabImg = new Image();
const discImg = new Image();
let imagesRequested = false;
const readyCbs = new Set<() => void>();

function fireReady(): void {
  if (badgeImagesReady()) {
    for (const cb of readyCbs) cb();
    readyCbs.clear();
  }
}

function ensureImages(): void {
  if (imagesRequested) return;
  imagesRequested = true;
  dabImg.onload = fireReady;
  discImg.onload = fireReady;
  dabImg.src = "/dab-full.png";
  discImg.src = "/badge-circle.png";
}

export function badgeImagesReady(): boolean {
  return dabImg.naturalWidth > 0 && discImg.naturalWidth > 0;
}

export function onBadgeImagesReady(cb: () => void): void {
  ensureImages();
  if (badgeImagesReady()) cb();
  else readyCbs.add(cb);
}

export function getDabImage(): HTMLImageElement | null {
  ensureImages();
  return dabImg.naturalWidth > 0 ? dabImg : null;
}

export function getDiscImage(): HTMLImageElement | null {
  ensureImages();
  return discImg.naturalWidth > 0 ? discImg : null;
}

// —— Multiplier label sprites: RAM → IndexedDB → SnapDOM ——
const BADGE_VERSION = "b1";
const labelCache = new Map<string, ImageBitmap>();
let labelWarmKey = "";
let labelWarmPromise: Promise<void> | null = null;

function currentDpr(): number {
  return activeDpr();
}

/** Per-value RAM key (font is stable within a session, so not needed here). */
function labelKey(value: number, dabSize: number, dpr: number): string {
  return `${getActiveLayout().metrics.id}|dab=${dabSize}|dpr=${dpr}|v=${value}`;
}

/** Persistent IDB key for the whole value-set (font- and size-accurate). */
function labelSetKey(
  dabSize: number,
  dpr: number,
  fontId: string,
  values: readonly number[],
): string {
  const m = getActiveLayout().metrics;
  return [
    BADGE_VERSION,
    m.id,
    `dab=${dabSize}`,
    `dpr=${dpr}`,
    `font=${fontId}`,
    `mult=${(13 * dabSize) / 24}`,
    `vals=${[...values].join(",")}`,
  ].join("|");
}

export function getMultiplierLabel(value: number): ImageBitmap | undefined {
  const dabSize = getActiveLayout().metrics.dabSize;
  return labelCache.get(labelKey(value, dabSize, currentDpr()));
}

function yieldToMain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export function warmMultiplierLabels(
  host: HTMLElement,
  values: readonly number[],
): Promise<void> {
  const dabSize = getActiveLayout().metrics.dabSize;
  const dpr = currentDpr();
  const warmKey = `${getActiveLayout().metrics.id}|dab=${dabSize}|dpr=${dpr}`;
  const haveAll = values.every((v) => labelCache.has(labelKey(v, dabSize, dpr)));
  if (labelWarmKey === warmKey && haveAll) return Promise.resolve();
  if (labelWarmPromise && labelWarmKey === warmKey) return labelWarmPromise;

  labelWarmKey = warmKey;
  labelWarmPromise = warmLabelSet(host, values, dabSize, dpr).finally(() => {
    labelWarmPromise = null;
  });
  return labelWarmPromise;
}

async function warmLabelSet(
  host: HTMLElement,
  values: readonly number[],
  dabSize: number,
  dpr: number,
): Promise<void> {
  // Font must be resolved BEFORE the key (fallback→real flap = guaranteed miss).
  await document.fonts.ready;
  if (values.every((v) => labelCache.has(labelKey(v, dabSize, dpr)))) return;

  const fontId = fontIdentity(getActiveLayout().metrics.metaFontSize);
  const key = labelSetKey(dabSize, dpr, fontId, values);

  // IndexedDB.
  const stored = await loadSprites(key);
  if (stored && stored.blobs.length === values.length) {
    try {
      for (let i = 0; i < values.length; i++) {
        labelCache.set(
          labelKey(values[i]!, dabSize, dpr),
          await blobToBitmap(stored.blobs[i]!),
        );
      }
      return;
    } catch {
      // fall through to rebuild
    }
  }

  // SnapDOM build, then persist.
  const bitmaps = await buildLabelBitmaps(host, values, dabSize, dpr);
  for (let i = 0; i < values.length; i++) {
    labelCache.set(labelKey(values[i]!, dabSize, dpr), bitmaps[i]!);
  }
  try {
    const blobs: Blob[] = [];
    for (const bmp of bitmaps) blobs.push(await bitmapToPngBlob(bmp));
    const ok = await saveSprites({ key, meta: { values, dabSize, dpr }, blobs });
    if (!ok) console.warn("[badge] IndexedDB save failed for", key);
  } catch (err) {
    console.warn("[badge] persist failed", err);
  }
}

async function buildLabelBitmaps(
  host: HTMLElement,
  values: readonly number[],
  dabSize: number,
  dpr: number,
): Promise<ImageBitmap[]> {
  const layout = getActiveLayout();
  applyTicketCssVars(host, layout.metrics);
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";

  const multFontSize = (13 * dabSize) / 24;
  // Slightly larger than the disc so the rotated label never clips; it stays
  // centred, and the canvas blit is centre-anchored, so the extra margin is inert.
  const boxSize = Math.ceil(dabSize * 1.3);
  const snapOpts = {
    embedFonts: true,
    backgroundColor: "transparent" as const,
    fast: true,
    cache: "disabled" as const,
    compress: false,
    scale: 1,
    dpr,
    burst: true,
  };

  const out: ImageBitmap[] = [];
  let warmed = false;
  for (const value of values) {
    const box = document.createElement("div");
    box.style.position = "relative";
    box.style.width = `${boxSize}px`;
    box.style.height = `${boxSize}px`;
    box.style.overflow = "visible";
    box.style.setProperty("--multiplier-font-size", `${multFontSize}px`);

    const label = new MultiplierLabelNode();
    label.update(value);
    box.appendChild(label.dom);
    host.appendChild(box);
    void box.offsetWidth;

    if (!warmed) {
      // SnapDOM's first capture is cold — discard one so sprites are consistent.
      await snapdom.toCanvas(box, { ...snapOpts, invalidate: true });
      warmed = true;
    }
    const raw = await snapdom.toCanvas(box, { ...snapOpts, invalidate: true });
    box.remove();

    out.push(await createImageBitmap(raw));
    await yieldToMain();
  }
  return out;
}
