import { getActiveLayout, type CatalogLayout } from "./catalogLayout";
import type { TicketMetrics } from "./ticketPresets";

export type CellBox = { x: number; y: number; w: number; h: number };

export type CellBoxModel = {
  dpr: number;
  cardWidth: number;
  cellW: number;
  cellH: number;
  /** Left inset so 6×cellW + 5×sep fits the card. */
  padX: number;
  bodyTop: number;
  sep: number;
  cells: CellBox[];
};

/** Total horizontal gap reserved in the cell-width formula: (ticketWidth − 6) / 6. */
export const CELL_GAP_TOTAL_PX = 6;

/**
 * Device-pixel-ratio used for the atlas AND canvas — the single source so they
 * can never disagree. Capped so the atlas grid matches the DOM's device grid;
 * any cap BELOW the real dpr makes canvas geometry snap to a coarser grid than
 * the DOM, so numbers sit ~0.5px off on that device (the mismatch seen on
 * high-dpr phones). 4 covers every real device exactly — flagship Android tops
 * out ~3.5–4, iPhone at 3 — so nothing real is capped now. The >4 cap only
 * bounds canvas backing memory for exotic/synthetic ratios; and it is safe in
 * practice because high-dpr devices are high-RAM flagships while low-RAM devices
 * are low-dpr, so the memory cost lands where there is memory to pay it.
 */
export const DPR_CAP = 4;
export function activeDpr(): number {
  return Math.min(window.devicePixelRatio || 1, DPR_CAP);
}

/** Snap a CSS length to the device pixel grid. */
export function snapCss(css: number, dpr: number): number {
  return Math.round(css * dpr) / dpr;
}

/**
 * Shared box for live DOM + HTML snapshot atlas + canvas blit.
 * cellW = (ticketWidth − 6px) / 6, snapped to device pixels.
 * Separators are 1px gaps between cells (painted separately on canvas).
 */
export function resolveCellBoxModel(
  layout: CatalogLayout = getActiveLayout(),
  dpr = activeDpr(),
): CellBoxModel {
  const m = layout.metrics;
  const sep = m.separatorWidth;
  const cellH = snapCss(m.cellHeight, dpr);

  const cellWPx = Math.max(
    1,
    Math.floor(((layout.cardWidth - CELL_GAP_TOTAL_PX) * dpr) / 6),
  );
  const cellW = cellWPx / dpr;
  const used = 6 * cellW + 5 * sep;
  const padX = snapCss(Math.max(0, (layout.cardWidth - used) / 2), dpr);
  const bodyTop = snapCss(m.headerHeight + m.bodyPaddingY, dpr);

  const cells: CellBox[] = [];
  let x = padX;
  for (let i = 0; i < 6; i++) {
    cells.push({ x: snapCss(x, dpr), y: bodyTop, w: cellW, h: cellH });
    x += cellW + sep;
  }

  return {
    dpr,
    cardWidth: layout.cardWidth,
    cellW,
    cellH,
    padX,
    bodyTop,
    sep,
    cells,
  };
}

/** Apply fixed cell size as CSS vars (live tickets + snapshot ticket). */
export function applyCellBoxCssVars(
  el: HTMLElement,
  model: CellBoxModel,
  m: TicketMetrics,
): void {
  el.style.setProperty("--ticket-cell-width", `${model.cellW}px`);
  el.style.setProperty("--ticket-cell-height", `${model.cellH}px`);
  el.style.setProperty("--ticket-body-pad-x", `${model.padX}px`);
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
 * Dab / multiplier host centred on a cell, in device pixels.
 * `leftCss` / `topCss` are the host's position inside that cell.
 * The same box is the canvas blit origin.
 */
export function badgeHostDevice(
  cell: { x: number; y: number; w: number; h: number },
  dabSizeCss: number,
  dpr: number,
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
    leftCss: (x - x0) / dpr,
    topCss: (y - y0) / dpr,
    sizeCss: size / dpr,
  };
}

/** `background-size: contain` + center, with edges on device pixels. */
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

/** Registered by badgeAtlas so the DOM host does not import the atlas. */
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
