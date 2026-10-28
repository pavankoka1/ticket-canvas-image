/**
 * Ball-draw and shuffle clock — Fortunamania `animation/drawPhase.ts`,
 * `animation.constants.ts` and `gestureTiming.ts`.
 *
 * Plain dab:
 *   0–250     dab badge scale 3 → 1
 *   250–600   ticket dip 1 → 0.94 → 1
 *   600–1500  gold shine (−30°, ease-in-out) when the ticket turns win
 *
 * Multiplier:
 *   0–250     disc 2 → 1
 *   250–650   text 4 → 1 → 0.8 → 1, ticket dip with the bounce (450–650)
 *   900–1500  shine (−45°, linear) + three sparkles, only on a gold ticket
 *
 * Shuffle: every moving card shares one delay and one duration.
 */

export const EASE_IN_OUT_CUBIC = "cubic-bezier(0.65, 0, 0.35, 1)";
export const EASE_OUT_CUBIC = "cubic-bezier(0.33, 1, 0.68, 1)";

/** Plain reorder (no draw this batch). */
export const ANIMATION_MS = 400;
/** Reorder that follows a draw. */
export const DRAW_MOVE_MS = 600;

export const DAB_APPEAR_MS = 250;
export const DAB_START_SCALE = 3;

export const TICKET_DIP_START_MS = 250;
export const TICKET_DIP_BOTTOM_MS = 400;
export const TICKET_DIP_END_MS = 600;
export const TICKET_DIP_SCALE = 0.94;

export const SHINE_START_MS = TICKET_DIP_END_MS;
export const SHINE_END_MS = 1500;
export const SHINE_MS = SHINE_END_MS - SHINE_START_MS;
export const SHINE_ANGLE_DEG = -30;
export const SHINE_WIDTH_RATIO = 0.45;

export const MULT_DISC_START_SCALE = 2;
export const MULT_DISC_END_MS = DAB_APPEAR_MS;

export const MULT_TEXT_START_SCALE = 4;
export const MULT_TEXT_LAND_MS = 450;
export const MULT_TEXT_PUNCH_SCALE = 0.8;
export const MULT_TEXT_PUNCH_MS = 550;
export const MULT_TEXT_SETTLE_MS = 650;

export const MULT_DIP_START_MS = MULT_TEXT_LAND_MS;
export const MULT_DIP_BOTTOM_MS = MULT_TEXT_PUNCH_MS;
export const MULT_DIP_END_MS = MULT_TEXT_SETTLE_MS;

export const MULT_SHINE_START_MS = 900;
export const MULT_SHINE_END_MS = 1500;
export const MULT_SHINE_MS = MULT_SHINE_END_MS - MULT_SHINE_START_MS;
export const MULT_SHINE_ANGLE_DEG = -45;

export const SPARKLE_SIZE_RATIO = 1.15;
/** Each pulse is linear 0 → peak → 0; pulse `i` starts at `MULT_SHINE_START_MS + i × stagger`. */
export const SPARKLE_DURATION_MS = 300;
export const SPARKLE_STAGGER_MS = 150;
export const SPARKLE_MIN_DURATION_MS = 300;
export const SPARKLE_PEAK_OPACITY = 0.9;
export const SPARKLE_PEAK_OFFSET = 0.5;
export const SPARKLE_COUNT = 3;

/** Fallback shine progress per sparkle (win amount, mid-body, trailing edge). */
const SPARKLE_DEFAULT_PROGRESS = [0.28, 0.55, 0.85] as const;

export type SparkleWindow = { start: number; end: number; peakAt: number };

/** Cap pulse length to the tightest peak gap (never below the 300ms floor). */
export function resolveSparkleDurationForPeaks(peakAts: readonly number[]): number {
  let minGap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < peakAts.length; i++) minGap = Math.min(minGap, peakAts[i]! - peakAts[i - 1]!);
  if (!Number.isFinite(minGap) || minGap <= 0) return SPARKLE_DURATION_MS;
  return Math.min(SPARKLE_DURATION_MS, Math.max(SPARKLE_MIN_DURATION_MS, minGap * 0.95));
}

/** Pulse window whose peak lands when the linear mult shine reaches `progress`. */
export function resolveSparkleWindow(
  shineProgressAtPeak: number,
  durationMs = SPARKLE_DURATION_MS,
): SparkleWindow {
  const progress = Math.min(0.95, Math.max(0.05, shineProgressAtPeak));
  const peakAt = MULT_SHINE_START_MS + progress * MULT_SHINE_MS;
  const duration = Math.max(SPARKLE_MIN_DURATION_MS, durationMs);
  const start = peakAt - SPARKLE_PEAK_OFFSET * duration;
  return { start, end: start + duration, peakAt };
}

/**
 * Shuffle threshold for "multiplier with sparkles" (default progress windows → 1560ms).
 * A measured run usually settles at 1500, so its shuffle waits `SHINE_END_MS`, like the game.
 */
export const SPARKLE_RUN_END_MS = Math.max(
  MULT_SHINE_END_MS,
  ...SPARKLE_DEFAULT_PROGRESS.map((p) => resolveSparkleWindow(p).end),
);

export type DrawKind = "dab" | "win" | "mult";

/** Shine plays on a number-pick win, or a multiplier on a gold ticket. */
export function drawPlaysShine(kind: DrawKind, hasWin: boolean): boolean {
  return kind === "win" || (kind === "mult" && hasWin);
}

/**
 * How long one ticket's draw gesture runs (`playDrawWaapi`). A multiplier on a gold
 * ticket ends when its last sparkle does (`multShineSettleMs`, from the layout).
 */
export function resolveDrawSettleMs(kind: DrawKind, hasWin: boolean, multShineSettleMs: number): number {
  if (drawPlaysShine(kind, hasWin)) return kind === "mult" ? multShineSettleMs : SHINE_END_MS;
  return kind === "mult" ? MULT_DIP_END_MS : TICKET_DIP_END_MS;
}

/** Shared shuffle start after a draw (`resolveMoveStartMs`). */
export function resolveMoveStartMs(hasShine: boolean, hasMultiplier: boolean): number {
  if (hasMultiplier) return SPARKLE_RUN_END_MS;
  return hasShine ? SHINE_END_MS : TICKET_DIP_END_MS;
}

export type ShufflePlan = { delayMs: number; durationMs: number };

/**
 * `shuffleAnimationDelayed`: the longest gesture this batch decides the shared
 * delay; every card then moves for the same duration.
 */
export function resolveShufflePlan(gestureMs: number): ShufflePlan {
  if (gestureMs <= 0) return { delayMs: 0, durationMs: ANIMATION_MS };
  const hasShine = gestureMs >= SHINE_END_MS;
  const hasMult = gestureMs >= SPARKLE_RUN_END_MS;
  return { delayMs: resolveMoveStartMs(hasShine, hasMult), durationMs: DRAW_MOVE_MS };
}

function shineAngleRad(multiplier: boolean): number {
  return ((multiplier ? MULT_SHINE_ANGLE_DEG : SHINE_ANGLE_DEG) * Math.PI) / 180;
}

function shineTravelPx(cardWidth: number, cardHeight: number, multiplier: boolean): number {
  const rad = shineAngleRad(multiplier);
  const projected = Math.abs(cardWidth * Math.cos(rad)) + Math.abs(cardHeight * Math.sin(rad));
  return projected + Math.hypot(cardWidth, cardHeight) * SHINE_WIDTH_RATIO;
}

/** Shine progress (0.05–0.95) when the band centreline crosses card point `(x, y)`. */
export function resolveShineProgressAtCardPoint(
  x: number,
  y: number,
  cardWidth: number,
  cardHeight: number,
  multiplier: boolean,
): number {
  if (cardWidth <= 0 || cardHeight <= 0) return 0.5;
  const rad = shineAngleRad(multiplier);
  const travel = shineTravelPx(cardWidth, cardHeight, multiplier);
  const along = (x - cardWidth / 2) * Math.cos(rad) + (y - cardHeight / 2) * Math.sin(rad);
  return Math.min(0.95, Math.max(0.05, (along + travel / 2) / travel));
}

/** Shine band size and pose at `progress` (Fortunamania `resolveTicketShineStyles`). */
export function resolveTicketShineStyles(
  cardWidth: number,
  cardHeight: number,
  progress: number,
  multiplier: boolean,
): { bandWidth: number; bandHeight: number; transform: string } {
  const deg = multiplier ? MULT_SHINE_ANGLE_DEG : SHINE_ANGLE_DEG;
  const rad = shineAngleRad(multiplier);
  const projected = Math.abs(cardWidth * Math.cos(rad)) + Math.abs(cardHeight * Math.sin(rad));
  const diagonal = Math.hypot(cardWidth, cardHeight);
  const bandWidth = diagonal * SHINE_WIDTH_RATIO;
  const travel = projected + bandWidth;
  const bandCentre = -travel / 2 + progress * travel;
  return {
    bandWidth,
    bandHeight: Math.max(projected, diagonal) * 2,
    transform: `translate(-50%, -50%) rotate(${deg}deg) translateX(${bandCentre}px)`,
  };
}
