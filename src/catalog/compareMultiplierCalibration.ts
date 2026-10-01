/** Compare-only baseline calibration. See docs/iphone-ticket-alignment/2026-10-01.md. */
export const MULTIPLIER_CALIBRATION_REVISION = "mult-layout-cal-2";

const SELECTOR = ".ticketCard__multiplier";
type Measurement = { native: number; raster: number; shiftDevice: number };
const cache = new Map<string, Measurement[]>();

function baselines(card: HTMLElement, dpr: number, zoom: number): number[] {
  const rect = card.getBoundingClientRect();
  const computed = getComputedStyle(card);
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:absolute;left:0;top:0;width:${rect.width}px;height:${rect.height}px;zoom:${zoom};font-family:${computed.fontFamily};visibility:hidden;pointer-events:none`;
  for (let i = 0; i < computed.length; i++) {
    const property = computed.item(i);
    if (property.startsWith("--")) host.style.setProperty(property, computed.getPropertyValue(property));
  }
  // Recomputing the host from its already-rounded DOMRect changes desktopSmall's
  // baseline. Keep the entire cell/body/card hierarchy at both layout scales.
  const clone = card.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, { position: "absolute", left: "0px", top: "0px", transform: "none", margin: "0" });
  clone.style.removeProperty("visibility");
  const markers = [...clone.querySelectorAll<HTMLElement>(SELECTOR)].map(label => {
    label.style.transform = "none";
    const value = label.querySelector<HTMLElement>(".ticketCard__multiplierFill > span");
    const marker = document.createElement("span");
    marker.style.cssText = "display:inline-block;width:0;height:0";
    value?.append(marker);
    return marker;
  });
  host.append(clone);
  document.body.append(host);
  try {
    // Relative to the cloned card itself, not the probe host.
    const top = clone.getBoundingClientRect().top;
    return markers.map(marker => (marker.getBoundingClientRect().top - top) * dpr / zoom);
  } finally { host.remove(); }
}

/** Snap to the 1/64 device-px layout grid so float noise cannot flip a half pixel. */
const onGrid = (device: number) => Math.round(device * 64) / 64;

function calibration(card: HTMLElement, dpr: number): Measurement[] {
  const labels = [...card.querySelectorAll<HTMLElement>(SELECTOR)];
  if (!labels.length || dpr === 1) return [];
  const rect = card.getBoundingClientRect();
  const cs = getComputedStyle(card);
  const variables = [...cs].filter(p => p.startsWith("--")).map(p => `${p}:${cs.getPropertyValue(p)}`);
  const labelStyles = labels.map(label => {
    const style = getComputedStyle(label);
    return [label.textContent, style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing];
  });
  // IDs/amounts never enter this key. A compatible badge is measured once, not
  // once per ticket or raster part. Cell styles include host offsets and sizes.
  const geometry = [...card.querySelectorAll<HTMLElement>(".ticketCard__cell,.ticketCard__badgeHost")]
    .map(el => [el.className, el.style.cssText]);
  const key = JSON.stringify([dpr, rect.width, rect.height, card.className, variables, geometry, labelStyles]);
  const hit = cache.get(key);
  if (hit) return hit;
  const native = baselines(card, dpr, 1);
  const raster = baselines(card, dpr, dpr);
  const result = native.map((value, i) => {
    const shift = Math.round(onGrid(value)) - Math.round(onGrid(raster[i]!));
    // A label never sits more than a few device px from its DOM baseline; a
    // larger value is a failed measurement, not a correction.
    return { native: value, raster: raster[i]!, shiftDevice: Math.abs(shift) <= 3 ? shift : 0 };
  });
  if (cache.size >= 512) cache.clear();
  cache.set(key, result);
  console.debug("[multiplier-calibration]", JSON.stringify({ revision: MULTIPLIER_CALIBRATION_REVISION, dpr, result }));
  return result;
}

/** Move all label layers together, inside the existing rotation; never the disc. */
export function applyCompareMultiplierCalibration(card: HTMLElement, clone: HTMLElement, dpr: number): void {
  const measured = calibration(card, dpr);
  clone.querySelectorAll<HTMLElement>(SELECTOR).forEach((label, i) => {
    const shift = measured[i]?.shiftDevice;
    if (!shift) return;
    label.style.transform += ` translateY(${shift / dpr}px)`;
  });
}
