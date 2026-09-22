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
import { ensureTicketFont } from "./ticketFont";

/**
 * Dab disc (static PNG) + per-value multiplier badge sprites.
 *
 * - Plain dab   → blit dab-full.png centred on the cell (art, no SnapDOM).
 * - Multiplier  → SnapDOM the real `.ticketCard__badgeHost_multiplier` node
 *   (disc background-image + label), same CSS stack as TicketCard. Capture the
 *   host itself with outerTransforms so −15° label + translate(-50%,-50%)
 *   rasterise correctly — capturing a parent box with outerTransforms:false
 *   was washing out the gradient label.
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

function waitForDiscImage(): Promise<void> {
  ensureImages();
  if (badgeImagesReady()) return Promise.resolve();
  return new Promise((resolve) => {
    readyCbs.add(() => resolve());
  });
}

// —— Full multiplier badge sprites: RAM → IndexedDB → SnapDOM ——
const BADGE_VERSION = "b6";
const badgeCache = new Map<string, ImageBitmap>();
let badgeWarmKey = "";
let badgeWarmPromise: Promise<void> | null = null;

function currentDpr(): number {
  return activeDpr();
}

function badgeKey(
  value: number,
  dabSize: number,
  dpr: number,
  fontId: string,
): string {
  return `${getActiveLayout().metrics.id}|dab=${dabSize}|dpr=${dpr}|font=${fontId}|v=${value}`;
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
    `vals=${[...values].join(",")}`,
  ].join("|");
}

export function getMultiplierBadge(value: number): ImageBitmap | undefined {
  const dabSize = getActiveLayout().metrics.dabSize;
  const multFontSize = (13 * dabSize) / 24;
  const fontId = fontIdentity(multFontSize);
  return badgeCache.get(badgeKey(value, dabSize, currentDpr(), fontId));
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
  if (badgeWarmPromise && badgeWarmKey === warmKey) return badgeWarmPromise;

  badgeWarmKey = warmKey;
  badgeWarmPromise = warmBadgeSet(host, values, dabSize, dpr).finally(() => {
    badgeWarmPromise = null;
  });
  return badgeWarmPromise;
}

async function warmBadgeSet(
  host: HTMLElement,
  values: readonly number[],
  dabSize: number,
  dpr: number,
): Promise<void> {
  const multFontSize = (13 * dabSize) / 24;
  // Disc PNG must be in the browser cache before SnapDOM embeds background-image.
  await waitForDiscImage();
  const { face, mbOnest700, onest700 } = await ensureTicketFont(multFontSize);
  console.info("[atlas:badge] font", { face, mbOnest700, onest700 });

  const fontId = fontIdentity(multFontSize);
  if (values.every((v) => badgeCache.has(badgeKey(v, dabSize, dpr, fontId)))) {
    return;
  }

  const key = badgeSetKey(dabSize, dpr, fontId, values, multFontSize);

  const stored = await loadSprites(key);
  if (stored && stored.blobs.length === values.length) {
    try {
      for (let i = 0; i < values.length; i++) {
        badgeCache.set(
          badgeKey(values[i]!, dabSize, dpr, fontId),
          await blobToBitmap(stored.blobs[i]!),
        );
      }
      console.info("[atlas:badge]", {
        src: "idb",
        values: values.length,
        dabSize,
        dpr,
        font: fontId,
      });
      return;
    } catch {
      // fall through to rebuild
    }
  }

  const bitmaps = await buildBadgeBitmaps(
    host,
    values,
    dabSize,
    dpr,
    multFontSize,
  );
  for (let i = 0; i < values.length; i++) {
    badgeCache.set(badgeKey(values[i]!, dabSize, dpr, fontId), bitmaps[i]!);
  }
  console.info("[atlas:badge]", {
    src: "snap",
    values: values.length,
    dabSize,
    dpr,
    font: fontId,
    sprite: `${bitmaps[0]?.width ?? 0}x${bitmaps[0]?.height ?? 0}`,
  });
  try {
    const blobs: Blob[] = [];
    for (const bmp of bitmaps) blobs.push(await bitmapToPngBlob(bmp));
    const ok = await saveSprites({
      key,
      meta: { values, dabSize, dpr, font: fontId },
      blobs,
    });
    if (!ok) console.warn("[badge] IndexedDB save failed for", key);
  } catch (err) {
    console.warn("[badge] persist failed", err);
  }
}

/**
 * Build one sprite per multiplier value by SnapDOM-capturing a real
 * `.ticketCard__badgeHost_multiplier` (same classes/CSS as TicketCard).
 */
async function buildBadgeBitmaps(
  host: HTMLElement,
  values: readonly number[],
  dabSize: number,
  dpr: number,
  multFontSize: number,
): Promise<ImageBitmap[]> {
  const layout = getActiveLayout();
  applyTicketCssVars(host, layout.metrics);
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";

  // Cell-sized stage so the host's translate(-50%,-50%) centres like in a real cell.
  const stageSize = Math.ceil(dabSize * 2);
  const snapOpts = {
    embedFonts: true,
    // Required: host has translate(-50%,-50%) and label has rotate(-15deg).
    // Capturing a parent with outerTransforms:false washed out gradient text.
    outerTransforms: true,
    outerShadows: false,
    backgroundColor: "transparent" as const,
    fast: true,
    cache: "disabled" as const,
    compress: false,
    scale: 1,
    dpr,
    burst: true,
    reconcile: true,
  };

  const out: ImageBitmap[] = [];
  let warmed = false;
  for (const value of values) {
    const stage = document.createElement("div");
    stage.style.cssText = [
      "position:relative",
      `width:${stageSize}px`,
      `height:${stageSize}px`,
      "overflow:visible",
      "background:transparent",
    ].join(";");
    stage.style.setProperty("--ticket-dab-size", `${dabSize}px`);
    stage.style.setProperty("--multiplier-font-size", `${multFontSize}px`);

    const badgeHost = document.createElement("span");
    badgeHost.className =
      "ticketCard__badgeHost ticketCard__badgeHost_multiplier";
    // Centre in stage the same way a cell centres the host (top/left 50% + translate).
    const label = new MultiplierLabelNode();
    label.update(value);
    badgeHost.appendChild(label.dom);
    stage.appendChild(badgeHost);
    host.appendChild(stage);
    void stage.offsetWidth;

    if (!warmed) {
      await snapdom.toCanvas(badgeHost, { ...snapOpts, invalidate: true });
      warmed = true;
    }
    const raw = (await snapdom.toCanvas(badgeHost, {
      ...snapOpts,
      invalidate: true,
    })) as HTMLCanvasElement;
    stage.remove();

    out.push(await createImageBitmap(raw));
    await yieldToMain();
  }
  return out;
}
