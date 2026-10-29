import { activeDpr, snapCss } from "./cellBoxModel";

/** Every iOS browser and desktop Safari; not Blink (which also says AppleWebKit). */
export function isWebKitEngine(): boolean {
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrom(e|ium)|Edg\/|OPR\//.test(ua);
}

/**
 * Card layout origin, in CSS px. WebKit paints a card's text and badges differently
 * when its layout origin is fractional (⅓ px moves glyphs and discs by up to 2 device
 * px; docs/iphone-ticket-alignment S8), while canvas sprites are captured at a whole
 * origin. So WebKit gets whole CSS px; Blink only needs the device grid.
 */
export function snapLayoutOrigin(v: number, dpr = activeDpr()): number {
  return isWebKitEngine() ? Math.round(v) : snapCss(v, dpr);
}

/**
 * Move the catalog frame by layout `left` / `top` (not a transform, which does not
 * clear the WebKit drift) so the ticket lane starts on a whole CSS px. The toolbar
 * above the frame has a fractional text height, so without this every card and
 * canvas tile sits a fraction of a pixel off the grid. Whole px on every engine:
 * a ⅓ px device step is not representable in Blink's 1/64 px layout units, and the
 * DOM layer and canvas tiles then resolve the remainder differently.
 */
export function snapCatalogFrameOrigin(
  frame: HTMLElement,
  lane: HTMLElement,
  scroll: HTMLElement,
): void {
  const nudgeX = parseFloat(frame.style.left) || 0;
  const nudgeY = parseFloat(frame.style.top) || 0;
  const laneRect = lane.getBoundingClientRect();
  const x = laneRect.left + window.scrollX - nudgeX;
  const y = laneRect.top + scroll.scrollTop + window.scrollY - nudgeY;
  const dx = Math.round(x) - x;
  const dy = Math.round(y) - y;
  if (Math.abs(dx - nudgeX) < 1e-4 && Math.abs(dy - nudgeY) < 1e-4) return;
  frame.style.left = Math.abs(dx) < 1e-4 ? "" : `${dx}px`;
  frame.style.top = Math.abs(dy) < 1e-4 ? "" : `${dy}px`;
}
