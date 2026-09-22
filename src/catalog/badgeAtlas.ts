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
  getLiveCellBoxModel,
  resolveCellBoxModel,
} from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { MultiplierLabelNode } from "./multiplierLabel";
import { applyTicketCssVars } from "./ticketPresets";
import { ensureTicketFont } from "./ticketFont";
import { isWinTicket, type Ticket } from "./tickets";

/**
 * Multiplier badge sprites — full TicketCard badge (disc + N× + shadow) snapped
 * on the real ticket body background for each surface:
 *   normal  — cream body gradient
 *   gold    — win ticket body gradient
 *   disabled — green/teal disabled body
 *
 * Shell = body pad + cell + body pad. Paint at (cell.x, cell.y − padY).
 * No ink-shift / layer split — blit the SnapDOM bitmap as captured.
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

const BADGE_VERSION = "b50-surfaceBg";
const SKIP_BADGE_IDB = false;
const badgeCache = new Map<string, ImageBitmap>();
let badgeWarmKey = "";
let badgeWarmPromise: Promise<void> | null = null;

const SNAP_OPTS = {
  embedFonts: true,
  outerTransforms: true,
  outerShadows: false,
  // Transparent: the shell already carries the ticket body fill.
  backgroundColor: "transparent" as const,
  fast: true,
  cache: "disabled" as const,
  compress: false,
  scale: 1,
  burst: true,
  reconcile: true,
};

function currentDpr(): number {
  return activeDpr();
}

/** Shell = [padY][cell][padY]. padY matches live body padding above the cell. */
export function shellGeometry(dpr: number = currentDpr()): {
  cellW: number;
  cellH: number;
  padY: number;
  shellW: number;
  shellH: number;
  wantW: number;
  wantH: number;
  dabSize: number;
  headerHeight: number;
} {
  const m = getActiveLayout().metrics;
  const model =
    getLiveCellBoxModel() ?? resolveCellBoxModel(getActiveLayout(), dpr);
  const cellW = model.cellW;
  const cellH = model.cellH;
  const padY = Math.max(0, model.bodyTop - m.headerHeight);
  const shellW = cellW;
  const shellH = padY + cellH + padY;
  return {
    cellW,
    cellH,
    padY,
    shellW,
    shellH,
    wantW: Math.round(shellW * dpr),
    wantH: Math.round(shellH * dpr),
    dabSize: m.dabSize,
    headerHeight: m.headerHeight,
  };
}

function badgeKey(
  value: number,
  surface: BadgeSurface,
  dabSize: number,
  dpr: number,
  fontId: string,
): string {
  const g = shellGeometry(dpr);
  return [
    getActiveLayout().metrics.id,
    `dab=${dabSize}`,
    `dpr=${dpr}`,
    `font=${fontId}`,
    `shell=${g.shellW}x${g.shellH}`,
    `pad=${g.padY}`,
    `surf=${surface}`,
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
  const g = shellGeometry(dpr);
  return [
    BADGE_VERSION,
    m.id,
    `dab=${dabSize}`,
    `dpr=${dpr}`,
    `font=${fontId}`,
    `mult=${multFontSize}`,
    `shell=${g.shellW}x${g.shellH}`,
    `pad=${g.padY}`,
    `surfs=${BADGE_SURFACES.join(",")}`,
    `vals=${[...values].join(",")}`,
  ].join("|");
}

export function getMultiplierBadge(
  value: number,
  surface: BadgeSurface = "normal",
): ImageBitmap | undefined {
  const dabSize = getActiveLayout().metrics.dabSize;
  const multFontSize = (13 * dabSize) / 24;
  const fontId = fontIdentity(multFontSize);
  return badgeCache.get(
    badgeKey(value, surface, dabSize, currentDpr(), fontId),
  );
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
  const g = shellGeometry(dpr);
  const warmKey = `${getActiveLayout().metrics.id}|shell=${g.shellW}x${g.shellH}|pad=${g.padY}|dpr=${dpr}|${BADGE_VERSION}`;
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
  await waitForDiscImage();
  const { face, mbOnest700, onest700 } = await ensureTicketFont(multFontSize);
  console.info("[atlas:badge] font", { face, mbOnest700, onest700 });

  const fontId = fontIdentity(multFontSize);
  const allReady = values.every((v) =>
    BADGE_SURFACES.every((s) =>
      badgeCache.has(badgeKey(v, s, dabSize, dpr, fontId)),
    ),
  );
  if (allReady) return;

  const key = badgeSetKey(dabSize, dpr, fontId, values, multFontSize);
  const g = shellGeometry(dpr);
  const slotCount = values.length * BADGE_SURFACES.length;

  if (!SKIP_BADGE_IDB) {
    const stored = await loadSprites(key);
    if (stored && stored.blobs.length === slotCount) {
      try {
        let i = 0;
        for (const value of values) {
          for (const surface of BADGE_SURFACES) {
            badgeCache.set(
              badgeKey(value, surface, dabSize, dpr, fontId),
              await blobToBitmap(stored.blobs[i]!),
            );
            i++;
          }
        }
        console.info("[atlas:badge]", {
          src: "idb",
          values: values.length,
          surfaces: BADGE_SURFACES.length,
          shell: `${g.shellW}x${g.shellH}`,
          padY: g.padY,
          dpr,
          font: fontId,
        });
        return;
      } catch {
        // fall through
      }
    }
  }

  const bitmaps = await buildBadgeBitmaps(
    host,
    values,
    dabSize,
    dpr,
    multFontSize,
  );
  {
    let i = 0;
    for (const value of values) {
      for (const surface of BADGE_SURFACES) {
        badgeCache.set(
          badgeKey(value, surface, dabSize, dpr, fontId),
          bitmaps[i]!,
        );
        i++;
      }
    }
  }
  console.info("[atlas:badge]", {
    src: "snap",
    values: values.length,
    surfaces: BADGE_SURFACES.length,
    shell: `${g.shellW}x${g.shellH}`,
    padY: g.padY,
    dpr,
    font: fontId,
    sprite: `${bitmaps[0]?.width ?? 0}x${bitmaps[0]?.height ?? 0}`,
  });
  try {
    const blobs: Blob[] = [];
    for (const bmp of bitmaps) blobs.push(await bitmapToPngBlob(bmp));
    const ok = await saveSprites({
      key,
      meta: {
        values,
        surfaces: [...BADGE_SURFACES],
        dabSize,
        dpr,
        font: fontId,
        shellW: g.shellW,
        shellH: g.shellH,
        padY: g.padY,
      },
      blobs,
    });
    if (!ok) console.warn("[badge] IndexedDB save failed for", key);
  } catch (err) {
    console.warn("[badge] persist failed", err);
  }
}

/**
 * Full badge on ticket-body background. Order: for each value × each surface.
 * No ink-shift — bitmap origin = shell origin = paint origin.
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

  const g = shellGeometry(dpr);
  const snapOpts = { ...SNAP_OPTS, dpr };
  const out: ImageBitmap[] = [];
  let warmed = false;
  let logged = false;

  for (const value of values) {
    for (const surface of BADGE_SURFACES) {
      const shell = document.createElement("div");
      // Real ticket body classes so SnapDOM AA matches live DOM on that surface.
      const cardClass =
        surface === "gold"
          ? "ticketCard ticketCard_win"
          : surface === "disabled"
            ? "ticketCard ticketCard_disabled"
            : "ticketCard";
      shell.className = cardClass;
      shell.style.cssText = [
        "position:relative",
        `width:${g.shellW}px`,
        `height:${g.shellH}px`,
        "overflow:hidden",
        "box-sizing:border-box",
        "border-radius:0",
        "box-shadow:none",
        "transform:none",
      ].join(";");
      shell.style.setProperty("--ticket-dab-size", `${dabSize}px`);
      shell.style.setProperty("--multiplier-font-size", `${multFontSize}px`);
      shell.style.setProperty("--ticket-cell-width", `${g.cellW}px`);
      shell.style.setProperty("--ticket-cell-height", `${g.cellH}px`);

      // Body band fills the shell — same gradient the live body uses under the cell.
      const body = document.createElement("div");
      body.className = "ticketCard__body";
      body.style.cssText = [
        "position:absolute",
        "inset:0",
        "height:100%",
        "width:100%",
        "padding:0",
        "margin:0",
        "border-radius:0",
        "overflow:visible",
      ].join(";");

      const cell = document.createElement("span");
      cell.className = "ticketCard__cell";
      cell.style.cssText = [
        "position:absolute",
        `top:${g.padY}px`,
        "left:0",
        `width:${g.cellW}px`,
        `height:${g.cellH}px`,
        "margin:0",
        "overflow:visible",
      ].join(";");

      const badgeHost = document.createElement("span");
      badgeHost.className =
        "ticketCard__badgeHost ticketCard__badgeHost_multiplier";
      const label = new MultiplierLabelNode();
      label.update(value);
      badgeHost.appendChild(label.dom);
      cell.appendChild(badgeHost);
      body.appendChild(cell);
      shell.appendChild(body);
      host.appendChild(shell);
      void shell.offsetWidth;

      if (!warmed) {
        await snapdom.toCanvas(shell, { ...snapOpts, invalidate: true });
        warmed = true;
      }
      const raw = (await snapdom.toCanvas(shell, {
        ...snapOpts,
        invalidate: true,
      })) as HTMLCanvasElement;
      shell.remove();

      const bitmap = await toExactBitmap(raw, g.wantW, g.wantH);
      if (!logged) {
        logged = true;
        console.info(
          `[atlas:badge] shell ${g.shellW}x${g.shellH} padY=${g.padY} want=${g.wantW}x${g.wantH} raw=${raw.width}x${raw.height} surfaces=${BADGE_SURFACES.join(",")} paintFrom=cell.y−padY`,
        );
      }
      out.push(bitmap);
      await yieldToMain();
    }
  }
  return out;
}

/** Prefer exact shell device size; center-crop if SnapDOM oversizes. */
async function toExactBitmap(
  raw: HTMLCanvasElement,
  wantW: number,
  wantH: number,
): Promise<ImageBitmap> {
  if (raw.width === wantW && raw.height === wantH) {
    return createImageBitmap(raw);
  }
  const out = document.createElement("canvas");
  out.width = wantW;
  out.height = wantH;
  const ctx = out.getContext("2d");
  if (!ctx) return createImageBitmap(raw);
  ctx.clearRect(0, 0, wantW, wantH);
  const sx = Math.round((raw.width - wantW) / 2);
  const sy = Math.round((raw.height - wantH) / 2);
  ctx.drawImage(raw, sx, sy, wantW, wantH, 0, 0, wantW, wantH);
  return createImageBitmap(out);
}
