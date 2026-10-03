/** Glyph stamp quantization for /compare svg-all atlas (task 8.8). */

/** WebKit: one sprite; Chromium: four quarter-pixel phases. */
export function compareGlyphPhaseCount(): number {
  const ua = navigator.userAgent;
  const chromium =
    /Chrom(e|ium)/.test(ua) || /Edg\//.test(ua) || /OPR\//.test(ua);
  return chromium ? 4 : 1;
}

export function quantizeGlyphDeviceX(
  startDevice: number,
  phases: number,
): { pixel: number; phase: number } {
  if (phases <= 1) return { pixel: Math.floor(startDevice), phase: 0 };
  const v = Math.round(startDevice * 4) / 4;
  const pixel = Math.floor(v);
  const phase = Math.round((v - pixel) * 4);
  return { pixel, phase };
}

/** Horizontal CSS offset for a Chromium capture phase (0…3). */
export function compareGlyphPhaseShiftCss(phase: number, dpr: number): number {
  return phase / (4 * dpr);
}
