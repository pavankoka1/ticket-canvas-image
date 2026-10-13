/**
 * Ball-draw gesture clock — Fortunamania `animation/drawPhase.ts` (subset used by DOM WAAPI).
 */

export const DAB_APPEAR_MS = 250;

export const TICKET_DIP_START_MS = 250;
export const TICKET_DIP_BOTTOM_MS = 400;
export const TICKET_DIP_END_MS = 600;
export const TICKET_DIP_SCALE = 0.94;

export const SHINE_START_MS = TICKET_DIP_END_MS;
export const SHINE_END_MS = 1500;
export const SHINE_MS = SHINE_END_MS - SHINE_START_MS;
export const SHINE_ANGLE_DEG = -30;
export const SHINE_WIDTH_RATIO = 0.45;

export const MULT_DISC_END_MS = DAB_APPEAR_MS;

export const MULT_TEXT_LAND_MS = 450;
export const MULT_TEXT_PUNCH_MS = 550;
export const MULT_TEXT_SETTLE_MS = 650;

export const MULT_DIP_END_MS = MULT_TEXT_SETTLE_MS;

export const MULT_SHINE_START_MS = 900;
export const MULT_SHINE_END_MS = 1500;
export const MULT_SHINE_MS = MULT_SHINE_END_MS - MULT_SHINE_START_MS;
export const MULT_SHINE_ANGLE_DEG = -45;

export const SPARKLE_DURATION_MS = 300;
export const SPARKLE_STAGGER_MS = 150;
export const SPARKLE_MIN_DURATION_MS = 300;
export const SPARKLE_PEAK_OPACITY = 0.9;
export const SPARKLE_PEAK_OFFSET = 0.5;

export type SparkleWindow = { start: number; end: number; peakAt: number };

export function resolveSparkleDurationForPeaks(peakAts: readonly number[]): number {
  let minGap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < peakAts.length; i++) {
    minGap = Math.min(minGap, peakAts[i]! - peakAts[i - 1]!);
  }
  if (!Number.isFinite(minGap) || minGap <= 0) return SPARKLE_DURATION_MS;
  return Math.min(SPARKLE_DURATION_MS, Math.max(SPARKLE_MIN_DURATION_MS, minGap * 0.95));
}

export function resolveSparkleWindow(
  shineStartMs: number,
  shineMs: number,
  shineProgressAtPeak: number,
  durationMs = SPARKLE_DURATION_MS,
): SparkleWindow {
  const progress = Math.min(0.95, Math.max(0.05, shineProgressAtPeak));
  const peakAt = shineStartMs + progress * shineMs;
  const duration = Math.max(SPARKLE_MIN_DURATION_MS, durationMs);
  const start = peakAt - SPARKLE_PEAK_OFFSET * duration;
  return { start, end: start + duration, peakAt };
}

