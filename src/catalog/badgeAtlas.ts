import { snapdom } from "@zumer/snapdom";

import {
  bitmapToPngBlob,
  blobToBitmap,
  loadSprites,
  saveSprites,
} from "./atlasStore";
import { fontIdentity } from "./cellAtlas";
import {
  activeDpr,
  badgeHostDevice,
  containDeviceRect,
  getLiveCellBoxModel,
  resolveCellBoxModel,
  setBadgeChrome,
} from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { MultiplierLabelNode } from "./multiplierLabel";
import { applyTicketCssVars } from "./ticketPresets";
import { ensureTicketFont } from "./ticketFont";
import { isWinTicket, type Ticket } from "./tickets";

/**
 * Multiplier label sprites. The disc is not in the bitmap — DOM and canvas
 * both paint badge-circle.png into `badgeHostDevice`. This atlas is only the
 * rotated N× (fill, stroke, shadow), shifted so its ink centre lands on the
 * live label. Surface (gold / disabled) does not change the label.
 */

export const BADGE_SURFACES = ["normal", "gold", "disabled"] as const;
export type BadgeSurface = (typeof BADGE_SURFACES)[number];

const dabImg = new Image();
const discImg = new Image();
let imagesRequested = false;
const readyCbs = new Set<() => void>();

function fireReady(): void {
  if (badgeImagesReady()) {
    for (const cb of Array.from(readyCbs)) cb();
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

setBadgeChrome((host, box, isMult, dpr) => {
  const img = isMult ? getDiscImage() : getDabImage();
  if (!img) return;
  const dest = containDeviceRect(box, img.naturalWidth, img.naturalHeight, dpr);
  host.style.backgroundSize = `${dest.wCss}px ${dest.hCss}px`;
  host.style.backgroundPosition = `${dest.leftCss}px ${dest.topCss}px`;
  host.style.backgroundRepeat = "no-repeat";
});

function waitForDiscImage(): Promise<void> {
  ensureImages();
  if (badgeImagesReady()) return Promise.resolve();
  return new Promise((resolve) => {
    readyCbs.add(() => resolve());
  });
}

/** Which badge surface a ticket should paint. */
export function badgeSurfaceForTicket(ticket: Ticket): BadgeSurface {
  if (ticket.disabled) return "disabled";
  if (isWinTicket(ticket)) return "gold";
  return "normal";
}

const BADGE_VERSION = "b51-labelInk";
const SKIP_BADGE_IDB = false;
const badgeCache = new Map<string, ImageBitmap>();
const labelPlace = new Map<string, { dx: number; dy: number }>();
let badgeWarmKey = "";
let badgeWarmPromise: Promise<void> | null = null;

const SNAP_OPTS = {
  embedFonts: true,
  outerTransforms: true,
  outerShadows: false,
  // Label only — the fill gradient contains white, so a white matte cannot be
  // keyed out. Position is corrected by the ink shift below.
  backgroundColor: "transparent" as const,
  fast: true,
  cache: "disabled" as const,
  compress: false,
  scale: 1,
  burst: true,
};

type LabelSprite = { bitmap: ImageBitmap; dx: number; dy: number };

function currentDpr(): number {
  return activeDpr();
}

function hostSizeCss(dabSize: number, dpr: number): number {
  const model =
    getLiveCellBoxModel() ?? resolveCellBoxModel(getActiveLayout(), dpr);
  const probe = model.cells[0] ?? {
    x: 0,
    y: 0,
    w: model.cellW,
    h: model.cellH,
  };
  return badgeHostDevice(probe, dabSize, dpr).sizeCss;
}

function badgeKey(
  value: number,
  dabSize: number,
  dpr: number,
  fontId: string,
): string {
  return [
    getActiveLayout().metrics.id,
    `dab=${dabSize}`,
    `dpr=${dpr}`,
    `font=${fontId}`,
    `host=${hostSizeCss(dabSize, dpr)}`,
    `v=${value}`,
  ].join("|");
}

function badgeSetKey(
  dabSize: number,
  dpr: number,
  fontId: string,
  values: readonly number[],
  multFontSize: number,
): string {
  const m = getActiveLayout().metrics;
  return [
    BADGE_VERSION,
    m.id,
    `dab=${dabSize}`,
    `dpr=${dpr}`,
    `font=${fontId}`,
    `mult=${multFontSize}`,
    `host=${hostSizeCss(dabSize, dpr)}`,
    `vals=${[...values].join(",")}`,
  ].join("|");
}

export function getMultiplierBadge(
  value: number,
  _surface: BadgeSurface = "normal",
): ImageBitmap | undefined {
  const dabSize = getActiveLayout().metrics.dabSize;
  const multFontSize = (13 * dabSize) / 24;
  const fontId = fontIdentity(multFontSize);
  return badgeCache.get(badgeKey(value, dabSize, currentDpr(), fontId));
}

/** Device-px offset from the badge-host origin to the label bitmap. */
export function getMultiplierLabelPlace(
  value: number,
): { dx: number; dy: number } | undefined {
  const dabSize = getActiveLayout().metrics.dabSize;
  const multFontSize = (13 * dabSize) / 24;
  const fontId = fontIdentity(multFontSize);
  return labelPlace.get(badgeKey(value, dabSize, currentDpr(), fontId));
}

export function getMultiplierBadgeDataUrl(
  value: number,
  surface: BadgeSurface = "normal",
): string | undefined {
  const bmp = getMultiplierBadge(value, surface);
  if (!bmp) return undefined;
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d");
  if (!ctx) return undefined;
  ctx.drawImage(bmp, 0, 0);
  return c.toDataURL("image/png");
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
  const warmKey = `${getActiveLayout().metrics.id}|host=${hostSizeCss(dabSize, dpr)}|dpr=${dpr}|${BADGE_VERSION}`;
  if (badgeWarmPromise && badgeWarmKey === warmKey) return badgeWarmPromise;

  badgeWarmKey = warmKey;
  badgeWarmPromise = warmBadgeSet(host, values, dabSize, dpr).finally(() => {
    badgeWarmPromise = null;
  });
  return badgeWarmPromise;
}

function readShifts(meta: unknown): { dx: number; dy: number }[] | null {
  if (!meta || typeof meta !== "object" || !("shifts" in meta)) return null;
  const shifts = (meta as { shifts?: unknown }).shifts;
  if (!Array.isArray(shifts)) return null;
  return shifts as { dx: number; dy: number }[];
}

function rememberLabel(key: string, sprite: LabelSprite): void {
  badgeCache.set(key, sprite.bitmap);
  labelPlace.set(key, { dx: sprite.dx, dy: sprite.dy });
}

async function warmBadgeSet(
  host: HTMLElement,
  values: readonly number[],
  dabSize: number,
  dpr: number,
): Promise<void> {
  const multFontSize = (13 * dabSize) / 24;
  await waitForDiscImage();
  const { face, mbOnest700, onest700 } = await ensureTicketFont(multFontSize);
  console.info("[atlas:badge] font", { face, mbOnest700, onest700 });

  const fontId = fontIdentity(multFontSize);
  const allReady = values.every((v) => {
    const key = badgeKey(v, dabSize, dpr, fontId);
    return badgeCache.has(key) && labelPlace.has(key);
  });
  if (allReady) return;

  const key = badgeSetKey(dabSize, dpr, fontId, values, multFontSize);

  if (!SKIP_BADGE_IDB) {
    const stored = await loadSprites(key);
    const shifts = readShifts(stored?.meta);
    if (
      stored &&
      stored.blobs.length === values.length &&
      shifts &&
      shifts.length === values.length
    ) {
      try {
        for (let i = 0; i < values.length; i++) {
          const shift = shifts[i] as { dx?: number; dy?: number };
          rememberLabel(badgeKey(values[i]!, dabSize, dpr, fontId), {
            bitmap: await blobToBitmap(stored.blobs[i]!),
            dx: Number(shift.dx) || 0,
            dy: Number(shift.dy) || 0,
          });
        }
        console.info("[atlas:badge]", {
          src: "idb",
          values: values.length,
          dpr,
          font: fontId,
        });
        return;
      } catch {
        // fall through
      }
    }
  }

  const sprites = await buildLabelSprites(host, values, dabSize, dpr, multFontSize);
  const shifts: { dx: number; dy: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    const sprite = sprites[i]!;
    rememberLabel(badgeKey(values[i]!, dabSize, dpr, fontId), sprite);
    shifts.push({ dx: sprite.dx, dy: sprite.dy });
  }
  console.info("[atlas:badge]", {
    src: "snap",
    values: values.length,
    dpr,
    font: fontId,
    sprite: `${sprites[0]?.bitmap.width ?? 0}x${sprites[0]?.bitmap.height ?? 0}`,
    shift: shifts[0] ?? null,
  });
  try {
    const blobs: Blob[] = [];
    for (const sprite of sprites) blobs.push(await bitmapToPngBlob(sprite.bitmap));
    const ok = await saveSprites({
      key,
      meta: { values, shifts, dabSize, dpr, font: fontId },
      blobs,
    });
    if (!ok) console.warn("[badge] IndexedDB save failed for", key);
  } catch (err) {
    console.warn("[badge] persist failed", err);
  }
}

/**
 * Snap the live label (no disc, no body fill). dx/dy move the bitmap so its
 * ink centre matches the DOM label, in device px from the badge-host origin.
 */
async function buildLabelSprites(
  host: HTMLElement,
  values: readonly number[],
  dabSize: number,
  dpr: number,
  multFontSize: number,
): Promise<LabelSprite[]> {
  const layout = getActiveLayout();
  applyTicketCssVars(host, layout.metrics);
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";

  const sizeCss = hostSizeCss(dabSize, dpr);
  const snapOpts = { ...SNAP_OPTS, dpr };
  const out: LabelSprite[] = [];
  let warmed = false;

  for (const value of values) {
    const card = document.createElement("div");
    card.className = "ticketCard";
    card.style.cssText = [
      "position:relative",
      "width:auto",
      "height:auto",
      "overflow:visible",
      "box-shadow:none",
      "transform:none",
      "background:transparent",
    ].join(";");
    card.style.setProperty("--ticket-dab-size", `${dabSize}px`);
    card.style.setProperty("--multiplier-font-size", `${multFontSize}px`);

    const badgeHost = document.createElement("span");
    badgeHost.className = "ticketCard__badgeHost ticketCard__badgeHost_multiplier";
    badgeHost.style.position = "relative";
    badgeHost.style.left = "0";
    badgeHost.style.top = "0";
    badgeHost.style.transform = "none";
    badgeHost.style.width = `${sizeCss}px`;
    badgeHost.style.height = `${sizeCss}px`;
    badgeHost.style.backgroundImage = "none";

    const label = new MultiplierLabelNode();
    label.update(value);
    badgeHost.appendChild(label.dom);
    card.appendChild(badgeHost);
    host.appendChild(card);
    void card.offsetWidth;

    if (!warmed) {
      await snapdom.toCanvas(badgeHost, { ...snapOpts, invalidate: true });
      warmed = true;
    }
    const raw = (await snapdom.toCanvas(badgeHost, {
      ...snapOpts,
      invalidate: true,
    })) as HTMLCanvasElement;

    const domInk = labelInkDev(badgeHost, dpr);
    const spriteInk = spriteInkCenter(raw);
    const dx =
      domInk && spriteInk ? Math.round(domInk.cx - spriteInk.cx) : 0;
    const dy =
      domInk && spriteInk ? Math.round(domInk.cy - spriteInk.cy) : 0;
    console.info("[atlas:badge] label", {
      value,
      dpr,
      raw: `${raw.width}x${raw.height}`,
      dx,
      dy,
    });
    card.remove();
    out.push({ bitmap: await createImageBitmap(raw), dx, dy });
    await yieldToMain();
  }
  return out;
}

/** DOM label centre in device px from the badge-host top-left. */
function labelInkDev(
  host: HTMLElement,
  dpr: number,
): { cx: number; cy: number } | null {
  const layers = host.querySelectorAll(
    ".ticketCard__multiplierFill, .ticketCard__multiplierStroke, .ticketCard__multiplierShadow",
  );
  const root = host.getBoundingClientRect();
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of layers) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (!Number.isFinite(left)) return null;
  return {
    cx: ((left + right) / 2 - root.left) * dpr,
    cy: ((top + bottom) / 2 - root.top) * dpr,
  };
}

/** Tight alpha bounds. Centre matches a DOM edge-box centre. */
function spriteInkCenter(
  canvas: HTMLCanvasElement,
): { cx: number; cy: number } | null {
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
      if (data[(y * w + x) * 4 + 3]! < 16) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left) return null;
  return { cx: (left + right + 1) / 2, cy: (top + bottom + 1) / 2 };
}
