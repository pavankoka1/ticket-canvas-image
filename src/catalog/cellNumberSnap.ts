/**
 * Body cell digits: SnapDOM on real ticket DOM (same CSS vars as live cards),
 * then un-matte to transparent glyphs (white is raster-only, not stored).
 */

import { snapdom } from "@zumer/snapdom";

import { inkCenterYDevice } from "./cellAtlas";
import {
  activeDpr,
  applyCellBoxCssVars,
  resolveCellBoxModel,
  snapCss,
} from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { normalizeBatch } from "./normalizeClient";
import { resolveTicketCellGeometry } from "./ticketCellGeometry";
import { applyTicketCssVars } from "./ticketPresets";

export type CellNumberSprite = HTMLCanvasElement | ImageBitmap;

const CELL_NUMBER_SNAP_OPTS = {
  embedFonts: true,
  outerTransforms: true,
  outerShadows: false,
  backgroundColor: "#FFFFFF" as const,
  fast: true,
  cache: "disabled" as const,
  compress: false,
  scale: 1,
  burst: true,
};

export type CellSnapMetrics = {
  wantW: number;
  wantH: number;
  captureH: number;
  glyph: { r: number; g: number; b: number };
};

function parseRgb(s: string): { r: number; g: number; b: number } | null {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return { r: +m[1]!, g: +m[2]!, b: +m[3]! };
}

/** Match catalog / compare ticket roots so capture inherits the same cell CSS. */
export function prepareCellNumberCaptureHost(host: HTMLElement): void {
  const layout = getActiveLayout();
  const model = resolveCellBoxModel(layout, activeDpr());
  applyTicketCssVars(host, layout.metrics);
  applyCellBoxCssVars(host, model, layout.metrics);
}

export function styleCellCaptureCard(cardDom: HTMLElement): void {
  cardDom.style.position = "relative";
  cardDom.style.visibility = "visible";
  cardDom.style.filter = "none";
  cardDom.style.boxShadow = "none";
  cardDom.style.left = "0";
  cardDom.style.top = "0";
  cardDom.style.margin = "0";
}

export function readCellSnapMetrics(cell: HTMLElement, dpr: number): CellSnapMetrics {
  const rect = cell.getBoundingClientRect();
  const measuredW = snapCss(rect.width, dpr);
  const measuredH = snapCss(rect.height, dpr);
  const geo = resolveTicketCellGeometry(getActiveLayout(), dpr);
  const captureW = measuredW > 0 ? measuredW : geo.cellW;
  const captureH = measuredH > 0 ? measuredH : geo.cellH;
  const glyph = parseRgb(getComputedStyle(cell).color) ?? {
    r: 112,
    g: 79,
    b: 79,
  };
  return {
    wantW: Math.max(1, Math.round(captureW * dpr)),
    wantH: Math.max(1, Math.round(captureH * dpr)),
    captureH,
    glyph,
  };
}

function firstCell(cardRoot: HTMLElement): HTMLElement {
  const cell = cardRoot.querySelector(".ticketCard__cell");
  if (!cell) throw new Error("cell bitmap source missing");
  return cell as HTMLElement;
}

/** Opaque face for stable FreeType baseline; normalize strips white → alpha. */
async function snapCellCanvas(cell: HTMLElement, dpr: number): Promise<HTMLCanvasElement> {
  const prevBg = cell.style.background;
  cell.style.background = "#FFFFFF";
  void cell.offsetWidth;
  const raw = (await snapdom.toCanvas(cell, {
    ...CELL_NUMBER_SNAP_OPTS,
    dpr,
    invalidate: true,
  })) as HTMLCanvasElement;
  cell.style.background = prevBg;
  return raw;
}

/** Live DOM ink vertical centre in device px from the cell top (Range, same as Compare). */
function domInkCentreYDevice(cell: HTMLElement, dpr: number): number | null {
  const node = cell.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  if (!(node as Text).data.trim()) return null;
  const range = document.createRange();
  range.selectNodeContents(node);
  const inkR = range.getBoundingClientRect();
  const cellR = cell.getBoundingClientRect();
  if (inkR.height <= 0) return null;
  const centreCss = inkR.top - cellR.top + inkR.height / 2;
  return centreCss * dpr;
}

/** Warm discard + shift SnapDOM ink to match Range on this cell (ticket context, not host probe). */
export async function calibrateSnapInkShiftY(
  cell: HTMLElement,
  dpr: number,
): Promise<number> {
  const m = getActiveLayout().metrics;
  const nativeCenter = domInkCentreYDevice(cell, dpr);
  await snapCellCanvas(cell, dpr);
  const raw8 = await snapCellCanvas(cell, dpr);
  const spriteCenter = inkCenterYDevice(raw8);
  if (spriteCenter == null || nativeCenter == null) return 0;
  const shift = nativeCenter - spriteCenter;
  if (Math.abs(shift) > 0.01) {
    console.info("[cellNumberSnap] ink shiftY (device px)", {
      layout: m.id,
      dpr,
      shift: +shift.toFixed(2),
      spriteCenter,
      nativeCenter,
      residualDev: +(spriteCenter + shift - nativeCenter).toFixed(3),
    });
  }
  return shift;
}

export async function captureCellNumberSprite(
  cell: HTMLElement,
  metrics: CellSnapMetrics,
  dpr: number,
  inkShiftY: number,
  n: number,
): Promise<CellNumberSprite> {
  const raw = await snapCellCanvas(cell, dpr);
  const normed = await normalizeBatch([
    {
      n,
      src: raw,
      wantW: metrics.wantW,
      wantH: metrics.wantH,
      shiftY: inkShiftY,
      glyph: metrics.glyph,
    },
  ]);
  const bmp = normed.get(n);
  if (!bmp) return raw;
  return bmp;
}

export async function captureAllCellNumbers(
  host: HTMLElement,
  cardRoot: HTMLElement,
  paintDpr: number,
  bindBall: (ball: number) => void,
): Promise<CellNumberSprite[]> {
  prepareCellNumberCaptureHost(host);
  styleCellCaptureCard(cardRoot);
  void cardRoot.offsetWidth;

  bindBall(8);
  void cardRoot.offsetWidth;
  const calCell = firstCell(cardRoot);
  const inkShiftY = await calibrateSnapInkShiftY(calCell, paintDpr);

  const numbers: CellNumberSprite[] = [];
  for (let n = 1; n <= 60; n++) {
    bindBall(n);
    void cardRoot.offsetWidth;
    const cell = firstCell(cardRoot);
    const metrics = readCellSnapMetrics(cell, paintDpr);
    numbers[n] = await captureCellNumberSprite(cell, metrics, paintDpr, inkShiftY, n);
  }
  return numbers;
}
