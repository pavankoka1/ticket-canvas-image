import { activeDpr } from "./cellBoxModel";

/**
 * Nudge catalog content so ticket origins share the same device-pixel grid as
 * canvas tiles (fractional scrollport / centred frame causes ~0.5px drift).
 */
export function snapCatalogLaneToDeviceGrid(lane: HTMLElement): void {
  const dpr = window.devicePixelRatio || 1;
  const scroll = lane.offsetParent as HTMLElement | null;
  if (!scroll) return;
  const laneR = lane.getBoundingClientRect();
  const scrollR = scroll.getBoundingClientRect();
  const relLeft = laneR.left - scrollR.left + scroll.scrollLeft;
  const relTop = laneR.top - scrollR.top;
  const rx = Math.round(relLeft * dpr) / dpr - relLeft;
  const ry = Math.round(relTop * dpr) / dpr - relTop;
  if (Math.abs(rx) < 0.001 && Math.abs(ry) < 0.001) {
    lane.style.removeProperty("transform");
    return;
  }
  lane.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
}

export function snapScrollTopToDeviceGrid(scrollEl: HTMLElement): void {
  const dpr = activeDpr();
  const st = scrollEl.scrollTop;
  const snapped = Math.round(st * dpr) / dpr;
  if (Math.abs(st - snapped) > 0.01) scrollEl.scrollTop = snapped;
}
