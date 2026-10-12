import type { CellBox } from "./cellBoxModel";

/** Maps ticket-root CSS offsets to canvas buffer pixels (handles fractional layout + rounding). */
export type TicketDomDeviceScale = {
  sx: number;
  sy: number;
};

export function ticketDomDeviceScale(
  ticketRoot: HTMLElement,
  bufferW: number,
  bufferH: number,
): TicketDomDeviceScale {
  const r = ticketRoot.getBoundingClientRect();
  const cssW = r.width > 0 ? r.width : 1;
  const cssH = r.height > 0 ? r.height : 1;
  return { sx: bufferW / cssW, sy: bufferH / cssH };
}

function cssToDeviceX(dxCss: number, scale: TicketDomDeviceScale): number {
  return dxCss * scale.sx;
}

function cssToDeviceY(dyCss: number, scale: TicketDomDeviceScale): number {
  return dyCss * scale.sy;
}

/** Cell boxes in CSS px relative to the ticket root top-left. */
export function measureCellBoxesCss(ticketRoot: HTMLElement): CellBox[] {
  const cardR = ticketRoot.getBoundingClientRect();
  const cells = ticketRoot.querySelectorAll(".ticketCard__cell");
  const boxes: CellBox[] = [];
  cells.forEach((el) => {
    const r = el.getBoundingClientRect();
    boxes.push({
      x: r.left - cardR.left,
      y: r.top - cardR.top,
      w: r.width,
      h: r.height,
    });
  });
  return boxes;
}

/** Cell number ink top-left in ticket-root buffer px (Range on cell text). */
export function measureCellNumberInkOriginsDev(
  ticketRoot: HTMLElement,
  scale: TicketDomDeviceScale,
): Array<{ x: number; y: number } | null> {
  const cardR = ticketRoot.getBoundingClientRect();
  const cells = ticketRoot.querySelectorAll(".ticketCard__cell");
  return [...cells].map((cell) => {
    const node = cell.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const text = (node as Text).data;
    if (!text.trim()) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: cssToDeviceX(r.left - cardR.left, scale),
      y: cssToDeviceY(r.top - cardR.top, scale),
    };
  });
}

/** Badge host top-left in ticket-root buffer px (matches padded SVG capture origin). */
export function measureBadgeBlitOriginsDev(
  ticketRoot: HTMLElement,
  scale: TicketDomDeviceScale,
): Array<{ x: number; y: number } | null> {
  const cardR = ticketRoot.getBoundingClientRect();
  const cells = ticketRoot.querySelectorAll(".ticketCard__cell");
  return [...cells].map((cell) => {
    const host = cell.querySelector(".ticketCard__badgeHost");
    if (!(host instanceof HTMLElement)) return null;
    if (host.style.display === "none") return null;
    const r = host.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: cssToDeviceX(r.left - cardR.left, scale),
      y: cssToDeviceY(r.top - cardR.top, scale),
    };
  });
}

/** Per-digit ink left in ticket-root buffer px. */
export function measureIdDigitInkLeftsDev(
  ticketRoot: HTMLElement,
  scale: TicketDomDeviceScale,
): number[] | null {
  const idEl = ticketRoot.querySelector(".ticketCard__id");
  if (!(idEl instanceof HTMLElement)) return null;
  const node = idEl.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  const rootR = ticketRoot.getBoundingClientRect();
  const xs: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getBoundingClientRect();
    if (r.width <= 0) return null;
    xs.push(cssToDeviceX(r.left - rootR.left, scale));
  }
  return xs;
}
