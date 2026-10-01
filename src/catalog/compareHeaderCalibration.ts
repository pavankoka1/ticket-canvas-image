/**
 * Header text calibration for the HTML-zoom raster (iPhone WebKit, DPR 3).
 *
 * The live DOM lays text out at 1× and paints at the device ratio; the raster
 * clone lays it out under `zoom: dpr`. Their baselines can round differently.
 * A zero-size inline-block marker sits on the baseline: measure it in a probe
 * that copies the element's box, font and in-card offset, at zoom 1 and at
 * zoom dpr. The difference (device px) is the clone's translateY.
 *
 * Round each baseline before subtracting: desktopSmall measures 33 vs 33.5
 * device px on the reference phone, but its painted displacement is 1 px.
 * Rounding the difference loses that phase information.
 * Multiplier labels are never calibrated here.
 */

export const HEADER_CALIBRATION_REVISION = "hdr-cal-3";

export type HeaderTextCalibration = {
  /** Applied clone shift, device px. */
  shiftDevice: number;
  /** Raw marker difference, device px. */
  measuredDevice: number;
  nativeBaselineDevice: number;
  rasterBaselineDevice: number;
};

export type HeaderCalibration = {
  key: string;
  id: HeaderTextCalibration;
  win: HeaderTextCalibration;
};

const cache = new Map<string, HeaderCalibration>();

function markerOffsetDevice(
  el: HTMLElement,
  card: HTMLElement,
  zoom: number,
  dpr: number,
): number {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:absolute;left:0;top:0;width:${cr.width}px;height:${cr.height}px;visibility:hidden;pointer-events:none;zoom:${zoom}`;
  const box = document.createElement("div");
  box.style.cssText =
    `position:absolute;left:0;top:${r.top - cr.top}px;box-sizing:border-box;` +
    `width:${r.width}px;height:${r.height}px;display:${cs.display};` +
    `flex-direction:${cs.flexDirection};align-items:${cs.alignItems};` +
    `justify-content:${cs.justifyContent};padding:${cs.padding};white-space:nowrap;` +
    `font-family:${cs.fontFamily};font-weight:${cs.fontWeight};font-size:${cs.fontSize};` +
    `line-height:${cs.lineHeight};letter-spacing:${cs.letterSpacing}`;
  const line = document.createElement("span");
  line.textContent = "0";
  const marker = document.createElement("span");
  marker.style.cssText = "display:inline-block;width:0;height:0";
  line.append(marker);
  box.append(line);
  host.append(box);
  document.body.append(host);
  const offset = (marker.getBoundingClientRect().top - host.getBoundingClientRect().top) * dpr;
  host.remove();
  return zoom === 1 ? offset : offset / zoom;
}

const onGrid = (device: number) => Math.round(device * 64) / 64;

function calibrateText(el: HTMLElement | null, card: HTMLElement, dpr: number): HeaderTextCalibration {
  if (!el || dpr === 1) return { shiftDevice: 0, measuredDevice: 0, nativeBaselineDevice: 0, rasterBaselineDevice: 0 };
  const native = markerOffsetDevice(el, card, 1, dpr);
  const raster = markerOffsetDevice(el, card, dpr, dpr);
  return {
    measuredDevice: native - raster,
    nativeBaselineDevice: native,
    rasterBaselineDevice: raster,
    // Snap to the 1/64 device-px layout grid first: float noise (32.49994 vs
    // 32.5) must not round to different pixels.
    shiftDevice: Math.round(onGrid(native)) - Math.round(onGrid(raster)),
  };
}

/** Calibrate the live card's id and amount. Cached per compatible style/layout. */
export function headerCalibration(card: HTMLElement, dpr: number): HeaderCalibration {
  const id = card.querySelector<HTMLElement>(".ticketCard__id");
  const win = card.querySelector<HTMLElement>(".ticketCard__win");
  const cr = card.getBoundingClientRect();
  const sig = (el: HTMLElement | null) => {
    if (!el) return "-";
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return [cs.fontFamily, cs.fontWeight, cs.fontSize, cs.lineHeight, cs.letterSpacing,
      cs.display, cs.flexDirection, cs.alignItems, cs.justifyContent, cs.padding,
      r.top - cr.top, r.width, r.height].join(",");
  };
  const styleKey = `${HEADER_CALIBRATION_REVISION}|${dpr}|${sig(id)}|${sig(win)}`;
  const hit = cache.get(styleKey);
  if (hit) return hit;
  const idCal = calibrateText(id, card, dpr);
  const winCal = calibrateText(win, card, dpr);
  const result: HeaderCalibration = {
    key: `${HEADER_CALIBRATION_REVISION}:id${idCal.shiftDevice}:win${winCal.shiftDevice}`,
    id: idCal,
    win: winCal,
  };
  cache.set(styleKey, result);
  console.debug("[header-calibration]", JSON.stringify({ dpr, id: idCal, win: winCal }));
  return result;
}

/** Apply measured shifts to a raster clone (never the live card). */
export function applyHeaderCalibration(clone: HTMLElement, cal: HeaderCalibration, dpr: number): void {
  const shift = (selector: string, t: HeaderTextCalibration) => {
    if (!t.shiftDevice) return;
    const el = clone.querySelector<HTMLElement>(selector);
    const text = el && [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n as Text).data);
    if (!el || !text) return;
    const span = document.createElement("span");
    span.textContent = (text as Text).data;
    span.style.transform = `translateY(${t.shiftDevice / dpr}px)`;
    text.replaceWith(span);
  };
  shift(".ticketCard__id", cal.id);
  shift(".ticketCard__win", cal.win);
}
