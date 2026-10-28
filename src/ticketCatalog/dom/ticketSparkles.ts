/**
 * Multiplier sparkle anchors — Fortunamania `dom/ticketSparkles.ts`.
 *
 * The game measures its flex DOM; here the same boxes come from the layout so a draw
 * does no layout reads. Spots, in card CSS px:
 *   1 — first body separator, 2px under the win amount (header bottom)
 *   2 — third separator, 2px under the separator ticks
 *   3 — last separator + 2.5px, 2px under the ticket id (header bottom)
 */
import { catalogLayoutCacheKey, type CatalogLayout } from "../layout/catalogLayout";
import {
  MULT_SHINE_END_MS,
  MULT_SHINE_START_MS,
  SPARKLE_COUNT,
  SPARKLE_DURATION_MS,
  SPARKLE_STAGGER_MS,
  resolveShineProgressAtCardPoint,
  resolveSparkleDurationForPeaks,
  resolveSparkleWindow,
  MULT_SHINE_MS,
} from "../animation/drawPhase";

const SPARKLE_TRAIL_SEPARATOR_OFFSET_X = 2.5;
const SPARKLE_BELOW_PX = 2;

export type TicketSparklePlan = {
  spots: readonly { x: number; y: number }[];
  /** When the last pulse ends — the gesture settle for a multiplier on a gold ticket. */
  settleMs: number;
};

let cachedKey = "";
let cachedPlan: TicketSparklePlan | null = null;

/** Flex cell left edge (`flex: 1 1 0`, separator margin between cells). */
function cellLeft(i: number, cardWidth: number, sep: number): number {
  return i * ((cardWidth - 5 * sep) / 6 + sep);
}

export function resolveTicketSparklePlan(layout: CatalogLayout): TicketSparklePlan {
  const key = catalogLayoutCacheKey(layout);
  if (cachedPlan && key === cachedKey) return cachedPlan;

  const m = layout.metrics;
  const w = layout.cardWidth;
  const h = layout.cardHeight;
  const sep = m.separatorWidth;
  const header = m.headerHeight;
  const underHeader = Math.min(Math.max(header + SPARKLE_BELOW_PX, header), header + m.bodyHeight / 2);
  const underSeparators =
    header + m.bodyPaddingY + m.separatorMarginTop + m.separatorHeight + SPARKLE_BELOW_PX;
  const spots = [
    { x: cellLeft(1, w, sep), y: underHeader },
    { x: cellLeft(3, w, sep), y: underSeparators },
    { x: cellLeft(5, w, sep) + SPARKLE_TRAIL_SEPARATOR_OFFSET_X, y: header + SPARKLE_BELOW_PX },
  ];

  const progresses = spots.map((s) => resolveShineProgressAtCardPoint(s.x, s.y, w, h, true));
  const duration = resolveSparkleDurationForPeaks(
    progresses.map((p) => MULT_SHINE_START_MS + p * MULT_SHINE_MS),
  );
  const runEndMs = progresses.reduce(
    (end, p) => Math.max(end, resolveSparkleWindow(p, duration).end),
    MULT_SHINE_END_MS,
  );
  const lastPulseEnd =
    MULT_SHINE_START_MS + (SPARKLE_COUNT - 1) * SPARKLE_STAGGER_MS + SPARKLE_DURATION_MS;

  cachedKey = key;
  cachedPlan = { spots, settleMs: Math.max(runEndMs, lastPulseEnd) };
  return cachedPlan;
}
