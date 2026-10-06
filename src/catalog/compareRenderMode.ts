/**
 * /compare render modes (experiment switch).
 *
 * - `html`: HTML-zoom raster at the display ratio (current approach).
 * - `ratio-N`: same raster at a fixed ratio N; the canvas keeps the ticket's
 *   CSS size, so the browser rescales it (softer at N < display ratio).
 * - `svg-mult`: multiplier label drawn as SVG text with explicit coordinates,
 *   identically in the live DOM and the raster clone.
 * - `svg-all`: also header id/amount, cell numbers and the multiplier disc.
 */

import { DPR_CAP } from "./cellBoxModel";

export const COMPARE_RENDER_MODES = [
  { id: "html", label: "HTML zoom · display ratio" },
  { id: "svg-mult", label: "SVG-text multiplier · display ratio" },
  { id: "svg-all", label: "SVG overlay · full ticket (recommended)" },
  { id: "ratio-1", label: "Raster ratio 1" },
  { id: "ratio-2", label: "Raster ratio 2" },
  { id: "ratio-2.5", label: "Raster ratio 2.5" },
  { id: "ratio-3", label: "Raster ratio 3" },
] as const;

export type CompareRenderMode = (typeof COMPARE_RENDER_MODES)[number]["id"];

let mode: CompareRenderMode = "html";

export function setCompareRenderMode(next: CompareRenderMode): void {
  mode = next;
}

export function compareRenderMode(): CompareRenderMode {
  return mode;
}

/** Raster scale for canvas capture (display modes use actual `devicePixelRatio`). */
export function compareRasterRatio(m: CompareRenderMode = mode): number {
  if (m.startsWith("ratio-")) return Number(m.slice("ratio-".length));
  return Math.min(DPR_CAP, window.devicePixelRatio);
}

export function usesSvgMultiplier(m: CompareRenderMode = mode): boolean {
  return m === "svg-mult" || m === "svg-all";
}

/** Header, cell numbers and multiplier disc as SVG too. */
export function usesSvgText(m: CompareRenderMode = mode): boolean {
  return m === "svg-all";
}

export function isCompareRenderMode(value: string): value is CompareRenderMode {
  return COMPARE_RENDER_MODES.some((m) => m.id === value);
}
