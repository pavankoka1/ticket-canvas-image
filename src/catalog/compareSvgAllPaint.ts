/**
 * Shared svg-all canvas composite (compare optimized + catalog tiles).
 * Matches assembleWithOverlay in compareCachedSprites at v52: chrome, padded
 * badge-body sprites at headerHeight, number patches, then header glyphs.
 */

import { badgeHostDevice, resolveCellBoxModel, type CellBox } from "../ticketCatalog/layout/cellBoxModel";
import type { CatalogLayout } from "../ticketCatalog/layout/catalogLayout";
import { ensureTicketFontsForLayout } from "../ticketCatalog/layout/ticketFont";
import { applyTicketCssVars } from "../ticketCatalog/model/ticketPresets";
import { rasterizeTicketSvg } from "../ticketCatalog/svg/ticketSvgRaster";
import { MULTIPLIER_VALUES, ticketCellMultiplier, type Ticket } from "../ticketCatalog/model/tickets";
import type { ComparePaintPack } from "./compareCachedSprites";
import {
  dabDataUrl,
  discDataUrl,
  loadSvgMultiplierAssets,
  multiplierHostInk,
  svgEl,
} from "./compareSvgMultiplier";

/** `sx`/`sy`: device offset of the host box inside the phase-shifted bitmap. */
type MultHostSprite = { bitmap: HTMLCanvasElement; sx: number; sy: number };

/** Keyed by face, value and device phase. Rebuilt whole on every warm. */
const multHostCache = new Map<string, MultHostSprite>();
/** Keyed by face and value only — used when a cell lands on an unwarmed phase. */
const multHostFallback = new Map<string, MultHostSprite>();
let multHostWarmKey = "";

function hostInkKey(layout: CatalogLayout, dpr: number): string {
  return `${layout.metrics.id}|${layout.cardWidth}|${dpr}`;
}

const hostDiscBitmaps = new Map<boolean, HTMLCanvasElement>();
const hostDabBitmaps = new Map<boolean, HTMLCanvasElement>();
let hostBadgeWarmKey = "";

async function pngDataUrlToDeviceSquare(
  dataUrl: string,
  sizeDev: number,
): Promise<HTMLCanvasElement> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("badge PNG load failed"));
    img.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = sizeDev;
  canvas.height = sizeDev;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("badge bitmap 2D context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, sizeDev, sizeDev);
  return canvas;
}

/** Same disc/dab PNGs as svg-all DOM overlay (`discDataUrl` / `dabDataUrl`). */
export async function warmSvgAllHostBadgeBitmaps(
  layout: CatalogLayout,
  dpr: number,
  commitIf?: () => boolean,
): Promise<void> {
  const key = hostInkKey(layout, dpr);
  if (hostBadgeWarmKey === key && hostDiscBitmaps.size === 2) return;
  await loadSvgMultiplierAssets();
  const sizeDev = Math.max(1, Math.round(layout.metrics.dabSize * dpr));
  const nextDisc = new Map<boolean, HTMLCanvasElement>();
  const nextDab = new Map<boolean, HTMLCanvasElement>();
  for (const disabled of [false, true]) {
    const discUrl = discDataUrl(disabled);
    const dabUrl = dabDataUrl(disabled);
    if (!discUrl || !dabUrl) return;
    nextDisc.set(disabled, await pngDataUrlToDeviceSquare(discUrl, sizeDev));
    nextDab.set(disabled, await pngDataUrlToDeviceSquare(dabUrl, sizeDev));
  }
  if (commitIf && !commitIf()) return;
  hostBadgeWarmKey = key;
  hostDiscBitmaps.clear();
  hostDabBitmaps.clear();
  for (const [k, v] of nextDisc) hostDiscBitmaps.set(k, v);
  for (const [k, v] of nextDab) hostDabBitmaps.set(k, v);
}

/**
 * Host dab + multiplier sprites warmed for this layout. After a resize the pack
 * switches before they re-warm; stale ones are sized and phased for the old cells.
 */
export function isCatalogSvgAllHostInkReady(layout: CatalogLayout, dpr: number): boolean {
  const key = hostInkKey(layout, dpr);
  return (
    hostBadgeWarmKey === key &&
    hostDabBitmaps.size === 2 &&
    multHostWarmKey === key &&
    multHostCache.size > 0
  );
}

/**
 * Catalog canvas: disc + multiplier ink in one bitmap (same recipe as DOM overlay).
 * Compare’s optimized path bakes this via body-band capture; `/` cannot rasterize per ticket.
 */
export async function warmSvgAllMultiplierHosts(
  layout: CatalogLayout,
  dpr: number,
  commitIf?: () => boolean,
): Promise<void> {
  const key = hostInkKey(layout, dpr);
  if (multHostWarmKey === key && multHostCache.size > 0) return;
  await loadSvgMultiplierAssets();
  await ensureTicketFontsForLayout(layout.metrics);
  const dab = layout.metrics.dabSize;
  const next = new Map<string, MultHostSprite>();
  const phases = new Map<string, { px: number; py: number }>();
  const step = Math.max(1, Math.round(dpr));
  for (const cell of resolveCellBoxModel(layout, dpr).cells) {
    const py = devicePhase(badgeHostDevice(cell, dab, dpr).y, dpr);
    for (let px = 0; px < step; px++) phases.set(`${px}|${py}`, { px, py });
  }

  // One sheet, one capture (WebKit stalls on concurrent foreignObject decodes).
  // Each host sits in a whole-CSS-px slot, shifted by its device phase like the
  // DOM overlay's `translate(cx cy)`.
  type Slot = { face: string; value: number; cacheKey: string; sx: number; sy: number };
  const slots: Slot[] = [];
  const pitch = Math.ceil(dab) + 2;
  const cols = phases.size;
  const ink: SVGElement[] = [];
  let row = 0;
  for (const face of ["normal", "gold", "disabled"] as const) {
    const disabled = face === "disabled";
    const disc = discDataUrl(disabled);
    if (!disc) continue;
    for (const value of MULTIPLIER_VALUES) {
      let col = 0;
      for (const { px, py } of phases.values()) {
        const x0 = col * pitch;
        const y0 = row * pitch;
        ink.push(
          svgEl(
            "g",
            { transform: `translate(${x0 + px / dpr} ${y0 + py / dpr})` },
            ...multiplierHostInk(String(value), dab, disabled, disc),
          ),
        );
        slots.push({
          face,
          value,
          cacheKey: multHostKey(face, value, px, py),
          sx: Math.round(x0 * dpr) + px,
          sy: Math.round(y0 * dpr) + py,
        });
        col++;
      }
      row++;
    }
  }
  if (slots.length === 0) return;
  const sheetW = cols * pitch;
  const sheetH = row * pitch;
  const probe = document.createElement("div");
  // The raster clone copies computed opacity and logical insets, so park the
  // probe with a transform (reset on the clone), not `left` or opacity.
  probe.style.cssText =
    "position:fixed;left:0;top:0;transform:translateX(-10000px);pointer-events:none;overflow:hidden";
  probe.style.width = `${sheetW}px`;
  probe.style.height = `${sheetH}px`;
  applyTicketCssVars(probe, layout.metrics);
  probe.append(
    svgEl(
      "svg",
      { width: sheetW, height: sheetH, viewBox: `0 0 ${sheetW} ${sheetH}`, "aria-hidden": "true" },
      ...ink,
    ),
  );
  document.body.append(probe);
  try {
    const sheet = await rasterizeTicketSvg(probe, dpr, 0, layout.metrics);
    if (sheet.width > 0 && sheet.height > 0) {
      for (const { cacheKey, sx, sy } of slots) next.set(cacheKey, { bitmap: sheet, sx, sy });
    }
  } catch {
    // Fall back to compare badge atlas at paint time.
  } finally {
    probe.remove();
  }
  if (next.size === 0) return;
  if (commitIf && !commitIf()) return;
  multHostWarmKey = key;
  multHostCache.clear();
  multHostFallback.clear();
  for (const [k, v] of next) multHostCache.set(k, v);
  for (const slot of slots) {
    const sprite = next.get(slot.cacheKey);
    const fallbackKey = `${slot.face}|${slot.value}`;
    if (sprite && !multHostFallback.has(fallbackKey)) multHostFallback.set(fallbackKey, sprite);
  }
}

/**
 * Device offset of a badge host within its CSS px. Cards sit on whole CSS px, and
 * WebKit places the label's SVG text differently at each sub-pixel phase, so the
 * sprite is rasterized at the host's own phase (flex cell centres vary per cell).
 */
function devicePhase(deviceX: number, dpr: number): number {
  const step = Math.max(1, Math.round(dpr));
  return ((deviceX % step) + step) % step;
}

function multHostKey(face: string, value: number | string, px: number, py: number): string {
  return `${face}|${value}|${px}|${py}`;
}

function multHostBitmapUsable(sprite: MultHostSprite | undefined): boolean {
  return Boolean(sprite && sprite.bitmap.width > 0 && sprite.bitmap.height > 0);
}

/** Dab bitmaps are whole-sprite, so they read as a host sprite at origin. */
function dabHostSprite(disabled: boolean): MultHostSprite | undefined {
  const bitmap = hostDabBitmaps.get(disabled);
  return bitmap ? { bitmap, sx: 0, sy: 0 } : undefined;
}

export function clipTicketRoundRectDevice(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  cardWidthCss: number,
  cardHeightCss: number,
  radiusCss: number,
  dpr: number,
): void {
  const w = Math.round(cardWidthCss * dpr);
  const h = Math.round(cardHeightCss * dpr);
  const r = Math.min(Math.round(radiusCss * dpr), w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(originX + r, originY);
  ctx.arcTo(originX + w, originY, originX + w, originY + h, r);
  ctx.arcTo(originX + w, originY + h, originX, originY + h, r);
  ctx.arcTo(originX, originY + h, originX, originY, r);
  ctx.arcTo(originX, originY, originX + w, originY, r);
  ctx.closePath();
  ctx.clip();
}

export type SvgAllTicketFace = "normal" | "gold" | "disabled";

/**
 * Everything a ticket blit needs that does not change from ticket to ticket:
 * the warm sprite pack and this layout's device grid.
 *
 * Hoisted out of the tile loop on purpose. Building it per ticket cost 5–10%
 * of the inked paint path, because `resolveCellBoxModel` rebuilds six cell
 * boxes on every call.
 */
export type SvgAllPaintContext = {
  pack: ComparePaintPack;
  layout: CatalogLayout;
  dpr: number;
  /** Snapped cell boxes for this layout and dpr (`resolveCellBoxModel`). */
  cells: readonly CellBox[];
  cellW: number;
};

const EMPTY_CELLS: ReadonlySet<number> = new Set();

/**
 * Badge bands and cell digits for one ticket, at a device-pixel origin.
 * `omitBadgeCells` are cells a caller is covering with host ink of its own.
 */
export function paintSvgAllCompareTicket(
  ctx: CanvasRenderingContext2D,
  context: SvgAllPaintContext,
  ticket: Ticket,
  face: SvgAllTicketFace,
  originX: number,
  originY: number,
  omitBadgeCells: ReadonlySet<number> = EMPTY_CELLS,
): void {
  const { pack, layout, dpr, cells, cellW } = context;
  const m = layout.metrics;
  const pad = Math.round(16 * dpr);
  const width = Math.round(cellW * dpr);
  const bandY = originY + Math.round(m.headerHeight * dpr);

  for (let i = 0; i < 6; i++) {
    if (omitBadgeCells.has(i)) continue;
    const mult = ticketCellMultiplier(ticket, i);
    if (!ticket.hits.includes(i) && !mult) continue;
    const badge = pack.badges.get(`${face}|${mult || 1}`);
    if (!badge) continue;
    ctx.drawImage(
      badge.bitmap,
      pad,
      0,
      width,
      badge.bitmap.height,
      originX + Math.round(cells[i]!.x * dpr),
      bandY,
      width,
      badge.bitmap.height,
    );
  }

  for (let i = 0; i < 6; i++) {
    if (ticket.hits.includes(i) || ticketCellMultiplier(ticket, i)) continue;
    const ball = ticket.balls[i] ?? 0;
    const patch = pack.numberPatches.get(`${Boolean(ticket.disabled)}|${face}|${ball}`);
    if (!patch) continue;
    ctx.drawImage(
      patch.sprite.bitmap,
      originX + Math.round(cells[i]!.x * dpr) + patch.dx,
      bandY + patch.dy,
    );
  }
}

/**
 * Catalog tiles: compare body-band badges, then DOM-matched multiplier host sprites
 * (atlas body-band often bakes disc without label ink).
 *
 * Only for a ticket that `ticketHasBadgeInk` — one with none needs nothing but
 * `paintSvgAllCompareTicket`.
 */
export function paintSvgAllCatalogTicketInk(
  ctx: CanvasRenderingContext2D,
  context: SvgAllPaintContext,
  ticket: Ticket,
  face: SvgAllTicketFace,
  originX: number,
  originY: number,
): void {
  const { layout, dpr, cells } = context;
  const m = layout.metrics;
  const dabDisabled = face === "disabled";

  // Resolve host ink per cell before painting. A cell whose sprite is missing —
  // a partial WebKit warm, an unseen device phase — must still get its atlas
  // badge, otherwise the multiplier or dab paints as nothing at all.
  const hosts = new Map<number, { sprite: MultHostSprite; host: ReturnType<typeof badgeHostDevice> }>();
  if (isCatalogSvgAllHostInkReady(layout, dpr)) {
    for (let i = 0; i < 6; i++) {
      const mult = ticketCellMultiplier(ticket, i);
      if (!mult && !ticket.hits.includes(i)) continue;
      const cell = cells[i];
      if (!cell) continue;
      const host = badgeHostDevice(cell, m.dabSize, dpr);
      const sprite = mult
        ? (multHostCache.get(
            multHostKey(face, mult, devicePhase(host.x, dpr), devicePhase(host.y, dpr)),
          ) ??
          multHostCache.get(multHostKey(face, mult, 0, devicePhase(host.y, dpr))) ??
          multHostFallback.get(`${face}|${mult}`))
        : dabHostSprite(dabDisabled);
      if (!multHostBitmapUsable(sprite)) continue;
      hosts.set(i, { sprite: sprite!, host });
    }
  }

  // Body-band badges carry the capture card's body behind the dab; under the host
  // sprites that shows at the dab's corners, so they cover only the rest.
  paintSvgAllCompareTicket(ctx, context, ticket, face, originX, originY, new Set(hosts.keys()));

  for (const { sprite, host } of hosts.values()) {
    ctx.drawImage(
      sprite.bitmap,
      sprite.sx,
      sprite.sy,
      host.w,
      host.h,
      originX + host.x,
      originY + host.y,
      host.w,
      host.h,
    );
  }
}
