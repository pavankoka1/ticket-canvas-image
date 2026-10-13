import { MULT_SHINE_ANGLE_DEG, SHINE_ANGLE_DEG, SHINE_WIDTH_RATIO } from "../animation/drawPhase";

function angleRad(multiplier: boolean): number {
  const deg = multiplier ? MULT_SHINE_ANGLE_DEG : SHINE_ANGLE_DEG;
  return (deg * Math.PI) / 180;
}

function shineTravelPx(cardWidth: number, cardHeight: number, multiplier: boolean): number {
  const rad = angleRad(multiplier);
  const projected = Math.abs(cardWidth * Math.cos(rad)) + Math.abs(cardHeight * Math.sin(rad));
  const diagonal = Math.hypot(cardWidth, cardHeight);
  const bandWidth = diagonal * SHINE_WIDTH_RATIO;
  return projected + bandWidth;
}

/**
 * Shine `progress` (0–1) when the band centreline passes card-local point `(x, y)`.
 */
export function resolveShineProgressAtCardPoint(
  x: number,
  y: number,
  cardWidth: number,
  cardHeight: number,
  multiplier = false,
): number {
  if (cardWidth <= 0 || cardHeight <= 0) return 0.5;
  const rad = angleRad(multiplier);
  const travel = shineTravelPx(cardWidth, cardHeight, multiplier);
  const along = (x - cardWidth / 2) * Math.cos(rad) + (y - cardHeight / 2) * Math.sin(rad);
  return Math.min(0.95, Math.max(0.05, (along + travel / 2) / travel));
}
