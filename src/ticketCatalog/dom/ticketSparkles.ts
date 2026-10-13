import {
  MULT_SHINE_END_MS,
  MULT_SHINE_MS,
  MULT_SHINE_START_MS,
  type SparkleWindow,
  resolveSparkleDurationForPeaks,
  resolveSparkleWindow,
} from "../animation/drawPhase";

import { resolveShineProgressAtCardPoint } from "./ticketShine";

export type TicketSparkleSpot = { x: number; y: number };

export type TicketSparklePlan = {
  spots: readonly TicketSparkleSpot[];
  windows: readonly SparkleWindow[];
  durationMs: number;
  runEndMs: number;
};

export type TicketSparkleMeasureContext = {
  firstSeparatorCell: HTMLElement | null;
  thirdSeparatorCell: HTMLElement | null;
  fifthSeparatorCell: HTMLElement | null;
};

const SPARKLE_TRAIL_SEPARATOR_OFFSET_X = 2.5;

function separatorX(cellEl: HTMLElement, cardRect: DOMRect): number {
  return cellEl.getBoundingClientRect().left - cardRect.left;
}

function readSeparatorMetrics(metricsEl: HTMLElement): { marginTop: number; height: number } {
  const defaults = { marginTop: 4.5, height: 12 };
  if (typeof getComputedStyle !== "function") return defaults;
  const style = getComputedStyle(metricsEl);
  return {
    marginTop: Number.parseFloat(style.getPropertyValue("--ticket-separator-margin-top")) || defaults.marginTop,
    height: Number.parseFloat(style.getPropertyValue("--ticket-separator-height")) || defaults.height,
  };
}

function yBelowBodySeparatorRow(bodyEl: HTMLElement, cardEl: HTMLElement, cardRect: DOMRect): number {
  const bodyRect = bodyEl.getBoundingClientRect();
  const { marginTop, height } = readSeparatorMetrics(cardEl);
  let paddingTop = 2.5;
  if (typeof getComputedStyle === "function") {
    paddingTop = Number.parseFloat(getComputedStyle(bodyEl).paddingTop) || paddingTop;
  }
  return bodyRect.top - cardRect.top + paddingTop + marginTop + height + 2;
}

export function measureTicketSparkleSpots(
  cardEl: HTMLElement,
  winEl: HTMLElement,
  idEl: HTMLElement,
  bodyEl: HTMLElement,
  cells: TicketSparkleMeasureContext,
  cardWidth: number,
): readonly TicketSparkleSpot[] {
  const winRect = winEl.getBoundingClientRect();
  const idRect = idEl.getBoundingClientRect();
  const bodyRect = bodyEl.getBoundingClientRect();
  const cardRect = cardEl.getBoundingClientRect();

  let x1 = cardWidth * (1 / 6);
  if (cells.firstSeparatorCell) {
    x1 = separatorX(cells.firstSeparatorCell, cardRect);
  }

  const yBelowWin = winRect.bottom - cardRect.top + 2;
  const bodyMidY = bodyRect.top - cardRect.top + bodyRect.height / 2;
  const y1 = Math.min(Math.max(yBelowWin, bodyRect.top - cardRect.top), bodyMidY);

  const yBelowSep = yBelowBodySeparatorRow(bodyEl, cardEl, cardRect);
  let x2 = cardWidth * (3 / 6);
  const y2 = yBelowSep;
  if (cells.thirdSeparatorCell) {
    x2 = separatorX(cells.thirdSeparatorCell, cardRect);
  }

  let x3 = cardWidth - 4;
  const y3 = idRect.bottom - cardRect.top + 2;
  if (cells.fifthSeparatorCell) {
    x3 = separatorX(cells.fifthSeparatorCell, cardRect) + SPARKLE_TRAIL_SEPARATOR_OFFSET_X;
  }

  return [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
    { x: x3, y: y3 },
  ];
}

export function resolveTicketSparklePlan(
  spots: readonly TicketSparkleSpot[],
  cardWidth: number,
  cardHeight: number,
): TicketSparklePlan {
  const progresses = spots.map((spot) => resolveShineProgressAtCardPoint(spot.x, spot.y, cardWidth, cardHeight, true));
  const peakAts = progresses.map((p) => MULT_SHINE_START_MS + p * MULT_SHINE_MS);
  const durationMs = resolveSparkleDurationForPeaks(peakAts);
  const windows = progresses.map((p) => resolveSparkleWindow(MULT_SHINE_START_MS, MULT_SHINE_MS, p, durationMs));
  const runEndMs = windows.reduce((max, w) => Math.max(max, w.end), MULT_SHINE_END_MS);
  return { spots, windows, durationMs, runEndMs };
}
