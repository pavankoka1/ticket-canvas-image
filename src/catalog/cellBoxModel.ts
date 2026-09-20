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
 * can never disagree. Capped at 3 (not 2): a 2× atlas painted on a 2.5×/3×
 * display gets browser-upscaled → blurry, mis-sized numbers vs the crisp native
 * DOM ("wrong on settle" on dpr>2 screens). 3 covers essentially every real
 * device exactly; only >3 (very rare) is capped, to bound canvas memory.
 */
export const DPR_CAP = 3;
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
