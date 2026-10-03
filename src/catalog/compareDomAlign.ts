import { ticketDomDeviceScale, type TicketDomDeviceScale } from "./ticketDomMeasure";

/** Match alignment-branch compare stack: ticket fills the frame at 0,0. */
export function styleCompareTicketDom(dom: HTMLElement): void {
  dom.style.position = "absolute";
  dom.style.left = "0";
  dom.style.top = "0";
  dom.style.margin = "0";
  dom.style.transform = "none";
}

/** Whole-pixel document origin + DPR remainder transform (compare stack contract). */
export function alignCompareStackOrigin(wrap: HTMLElement): string {
  wrap.style.left = "0px";
  wrap.style.top = "0px";
  wrap.style.transform = "";
  const rect = wrap.getBoundingClientRect();
  const x = rect.left + window.scrollX;
  const y = rect.top + window.scrollY;
  const lx = Math.round(x);
  const ly = Math.round(y);
  const aim = (d: number) => (d === 0 ? 0 : d + Math.sign(d) * 1e-3);
  let ox = aim(lx - x);
  let oy = aim(ly - y);
  for (let i = 0; i < 3; i++) {
    wrap.style.left = `${ox}px`;
    wrap.style.top = `${oy}px`;
    const r = wrap.getBoundingClientRect();
    const ex = lx - (r.left + window.scrollX);
    const ey = ly - (r.top + window.scrollY);
    if (Math.abs(ex) < 1e-4 && Math.abs(ey) < 1e-4) break;
    ox += aim(ex);
    oy += aim(ey);
  }
  const dpr = window.devicePixelRatio;
  const rx = Math.round(lx * dpr) / dpr - lx;
  const ry = Math.round(ly * dpr) / dpr - ly;
  if (rx || ry) wrap.style.transform = `translate(${rx}px, ${ry}px)`;
  return `${lx},${ly},${rx},${ry},${rect.width}x${rect.height}`;
}

export type CardCanvasLayout = {
  cssW: number;
  cssH: number;
  scale: TicketDomDeviceScale;
};

/**
 * Compare overlay — stack-sized canvas (inset 0) with device buffer from SVG raster.
 * Matches fix/restore-catalog-alignment SvgRasterStack (flat difference at 100%).
 */
export function layoutCompareRasterCanvas(
  canvas: HTMLCanvasElement,
  raw: HTMLCanvasElement,
  cardWidth: number,
  cardHeight: number,
): void {
  if (canvas.width !== raw.width) canvas.width = raw.width;
  if (canvas.height !== raw.height) canvas.height = raw.height;
  canvas.style.inset = "0";
  canvas.style.left = "";
  canvas.style.top = "";
  canvas.style.right = "";
  canvas.style.bottom = "";
  canvas.style.width = `${cardWidth}px`;
  canvas.style.height = `${cardHeight}px`;
}

/** Size and position the overlay canvas on the measured live card (not the stack frame). */
export function layoutCanvasOnCard(
  canvas: HTMLCanvasElement,
  card: HTMLElement,
  wrap: HTMLElement,
  bufferW: number,
  bufferH: number,
): CardCanvasLayout {
  void card.offsetWidth;
  const cardR = card.getBoundingClientRect();
  const wrapR = wrap.getBoundingClientRect();
  if (canvas.width !== bufferW) canvas.width = bufferW;
  if (canvas.height !== bufferH) canvas.height = bufferH;
  canvas.style.inset = "auto";
  canvas.style.left = `${cardR.left - wrapR.left}px`;
  canvas.style.top = `${cardR.top - wrapR.top}px`;
  canvas.style.width = `${cardR.width}px`;
  canvas.style.height = `${cardR.height}px`;
  return {
    cssW: cardR.width,
    cssH: cardR.height,
    scale: ticketDomDeviceScale(card, bufferW, bufferH),
  };
}
