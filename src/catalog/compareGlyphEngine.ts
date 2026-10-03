/** Glyph stamp quantization for /compare svg-all atlas (task 8.8). */

const PHASE_EPSILON = 1e-3;

/** WebKit: two half-pixel phases; Chromium: four quarter-pixel phases. */
export function compareGlyphPhaseCount(): number {
  const ua = navigator.userAgent;
  const chromium =
    /Chrom(e|ium)/.test(ua) || /Edg\//.test(ua) || /OPR\//.test(ua);
  return chromium ? 4 : 2;
}

export function quantizeGlyphDeviceX(
  startDevice: number,
  phases: number,
): { pixel: number; phase: number } {
  const v =
    phases >= 4
      ? Math.round(startDevice * phases) / phases
      : Math.floor(startDevice * phases + PHASE_EPSILON) / phases;
  const pixel = Math.floor(v);
  const phase = Math.round((v - pixel) * phases);
  return { pixel, phase };
}

/** Horizontal CSS offset for capture phase `phase` (0 … phases−1). */
export function compareGlyphPhaseShiftCss(
  phase: number,
  dpr: number,
  phases: number,
): number {
  if (phases <= 1) return 0;
  return phase / (phases * dpr);
}
