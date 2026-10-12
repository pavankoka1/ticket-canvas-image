import { getActiveLayout, type CatalogLayout } from "./catalogLayout";
import type { TicketMetrics } from "./ticketPresets";
import { resolveTicketCellGeometry } from "./ticketCellGeometry";

export type CellBox = { x: number; y: number; w: number; h: number };

export type CellBoxModel = {
  dpr: number;
  cardWidth: number;
  cellW: number;
  cellH: number;
  /** Horizontal body inset (0 — cells are flex-start from the left). */
  padX: number;
  bodyTop: number;
  sep: number;
  /** Top of body band for dab/multiplier blit (header height). */
  badgeTop: number;
  cells: CellBox[];
};

/** @deprecated Use 5×separatorWidth in cell width; kept for atlas key compatibility. */
export const CELL_GAP_TOTAL_PX = 6;

export const DPR_CAP = 4;

/** Catalog tiles and DOM alignment use an integer device ratio (no 1.25 / 1.5 grids). */
export function activeDpr(): number {
  const raw = window.devicePixelRatio || 1;
  return Math.min(DPR_CAP, Math.max(1, Math.round(raw)));
}

/** SVG cell/chrome/badge captures are 1 CSS px per buffer px — scaled only at paint time. */
export const SPRITE_RASTER_DPR = 1;
export function spriteRasterDpr(): number {
  return SPRITE_RASTER_DPR;
}

export function snapCss(css: number, dpr: number): number {
  return Math.round(css * dpr) / dpr;
}

/** Map ticket-root CSS px to canvas buffer px (one round — matches DOM at integer DPR). */
export function ticketCssToBuffer(css: number, scale: number): number {
  return Math.round(css * scale);
}

/** Blit a sprite captured at `paintDpr` onto the tile buffer (matches badge/chrome path). */
export function blitPaintDprSprite(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasImageSource,
  destX: number,
  destY: number,
  paintDpr: number,
  scaleX: number,
  scaleY: number,
): void {
  const el = sprite as HTMLCanvasElement | ImageBitmap;
  const sw = el.width;
  const sh = el.height;
  ctx.drawImage(
    sprite,
    destX,
    destY,
    Math.round(sw * scaleX / paintDpr),
    Math.round(sh * scaleY / paintDpr),
  );
}

/**
 * Body cell number — intrinsic blit at layout cell origin (fix/restore-catalog-alignment).
 * Sprites are cell-sized at paint DPR; do not stretch to analytic w×h (causes ~0.1px drift).
 */
export function blitPaintDprCellBody(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasImageSource,
  cell: { x: number; y: number },
  originX: number,
  originY: number,
  _paintDpr: number,
  scaleX: number,
  scaleY: number,
  /** Measured cell boxes are fractional CSS — rounding here causes ~0.5px Y drift. */
  subpixel = true,
): void {
  const destX = subpixel ? originX + cell.x * scaleX : originX + Math.round(cell.x * scaleX);
  const destY = subpixel ? originY + cell.y * scaleY : originY + Math.round(cell.y * scaleY);
  ctx.drawImage(sprite, destX, destY);
}

/** Blit a 1×-raster sprite into the tile buffer using the same scale as body cells. */
export function blitTicketSprite(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasImageSource,
  cssX: number,
  cssY: number,
  cssW: number,
  cssH: number,
  originX: number,
  originY: number,
  scaleX: number,
  scaleY: number,
): void {
  const el = sprite as HTMLCanvasElement | ImageBitmap;
  const sw = el.width;
  const sh = el.height;
  ctx.drawImage(
    sprite,
    0,
    0,
    sw,
    sh,
    originX + Math.round(cssX * scaleX),
    originY + Math.round(cssY * scaleY),
    Math.round(cssW * scaleX),
    Math.round(cssH * scaleY),
  );
}

export function resolveCellBoxModel(
  layout: CatalogLayout = getActiveLayout(),
  dpr = activeDpr(),
): CellBoxModel {
  const geo = resolveTicketCellGeometry(layout, dpr);
  return {
    dpr: geo.dpr,
    cardWidth: geo.cardWidth,
    cellW: geo.cellW,
    cellH: geo.cellH,
    padX: geo.padX,
    bodyTop: geo.numberTop,
    sep: geo.sep,
    badgeTop: geo.badgeTop,
    cells: geo.numbers,
  };
}

export function applyCellBoxCssVars(
  el: HTMLElement,
  model: CellBoxModel,
  m: TicketMetrics,
): void {
  el.style.setProperty("--ticket-card-width", `${model.cardWidth}px`);
  el.style.setProperty("--ticket-cell-width", `${model.cellW}px`);
  el.style.setProperty("--ticket-cell-height", `${model.cellH}px`);
  el.style.setProperty("--ticket-body-pad-x", "0px");
  el.style.setProperty("--ticket-cell-height-metric", `${m.cellHeight}px`);
}

let liveModel: CellBoxModel | null = null;

export function setLiveCellBoxModel(model: CellBoxModel): void {
  liveModel = model;
}

export function getLiveCellBoxModel(): CellBoxModel | null {
  return liveModel;
}

export type DeviceBox = { x: number; y: number; w: number; h: number };

/**
 * @deprecated Prefer badgeBlitOriginCss from ticketCellGeometry for catalog paint.
 */
export function badgeHostDevice(
  cell: { x: number; y: number; w: number; h: number },
  dabSizeCss: number,
  dpr: number = spriteRasterDpr(),
): DeviceBox & { leftCss: number; topCss: number; sizeCss: number } {
  const x0 = cell.x * dpr;
  const y0 = cell.y * dpr;
  const size = Math.max(1, Math.round(dabSizeCss * dpr));
  const x = Math.round(x0 + (cell.w * dpr - size) / 2);
  const y = Math.round(y0 + (cell.h * dpr - size) / 2);
  return {
    x,
    y,
    w: size,
    h: size,
    leftCss: snapCss((x - x0) / dpr, dpr),
    topCss: snapCss((y - y0) / dpr, dpr),
    sizeCss: snapCss(size / dpr, dpr),
  };
}

/** Dab / multiplier host in card CSS px — same device grid as canvas `badgeHostDevice`. */
export function badgeHostInCardCss(
  cellIndex: number,
  layout: CatalogLayout = getActiveLayout(),
  dpr = activeDpr(),
): { hx: number; hy: number; size: number; cx: number; cy: number } {
  const model = resolveCellBoxModel(layout, dpr);
  const cell = model.cells[cellIndex]!;
  const box = badgeHostDevice(cell, layout.metrics.dabSize, dpr);
  // Do not reconstruct from cell.y + topCss — fractional numberTop double-snaps at DPR 2.
  const hx = box.x / dpr;
  const hy = box.y / dpr;
  const size = box.w / dpr;
  const cx = (box.x + box.w / 2) / dpr;
  const cy = (box.y + box.h / 2) / dpr;
  return { hx, hy, size, cx, cy };
}

export function containDeviceRect(
  host: DeviceBox,
  imgW: number,
  imgH: number,
  dpr: number,
): DeviceBox & { leftCss: number; topCss: number; wCss: number; hCss: number } {
  const scale = Math.min(host.w / imgW, host.h / imgH);
  const w = Math.max(1, Math.round(imgW * scale));
  const h = Math.max(1, Math.round(imgH * scale));
  const x = host.x + Math.round((host.w - w) / 2);
  const y = host.y + Math.round((host.h - h) / 2);
  return {
    x,
    y,
    w,
    h,
    leftCss: (x - host.x) / dpr,
    topCss: (y - host.y) / dpr,
    wCss: w / dpr,
    hCss: h / dpr,
  };
}

type BadgeChrome = (
  host: HTMLElement,
  box: DeviceBox,
  isMult: boolean,
  dpr: number,
) => void;

let badgeChrome: BadgeChrome | null = null;

export function setBadgeChrome(fn: BadgeChrome): void {
  badgeChrome = fn;
}

export function applyBadgeChrome(
  host: HTMLElement,
  box: DeviceBox,
  isMult: boolean,
  dpr: number,
): void {
  badgeChrome?.(host, box, isMult, dpr);
}
