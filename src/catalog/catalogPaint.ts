/**
 * Catalog tile paint. One ticket is shared bitmaps:
 * card face, a whole win-amount image, id digits, six cells.
 */

import { badgeHostDevice, getLiveCellBoxModel, resolveCellBoxModel } from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { getCellBitmaps, peekTicketChrome } from "./cellBitmaps";
import { paintAmount, paintIdDigits } from "./headerGlyphs";
import { BALLS_PER_TICKET } from "./layout";
import { isWinTicket, type Ticket, type TicketSlot } from "./tickets";

type CellBox = { x: number; y: number; w: number; h: number };

export function paintCatalogTicket(
  ctx: CanvasRenderingContext2D,
  slot: TicketSlot,
  ticket: Ticket,
  cardWidth: number,
  dpr: number,
  tileMinY: number,
  boxes: readonly CellBox[],
): void {
  const originX = Math.round(slot.x * dpr);
  const originY = Math.round(slot.y * dpr) - Math.round(tileMinY * dpr);
  const win = isWinTicket(ticket);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;

  const chrome = peekTicketChrome(win);
  if (chrome) ctx.drawImage(chrome, originX, originY);
  if (win && ticket.win) paintAmount(ctx, ticket.win, originX, originY, dpr);
  paintIdDigits(
    ctx,
    ticket.no,
    win ? "idGold" : "idNormal",
    originX,
    originY,
    cardWidth,
    dpr,
  );

  const set = getCellBitmaps();
  if (!set) return;
  const metrics = getActiveLayout().metrics;
  for (let i = 0; i < BALLS_PER_TICKET; i++) {
    const cell = boxes[i];
    if (!cell) continue;
    const x = originX + Math.round(cell.x * dpr);
    const y = originY + Math.round(cell.y * dpr);
    const mult = ticket.multipliers[i] ?? 0;
    const badge = badgeHostDevice(cell, metrics.dabSize, dpr);
    const padX = (padCss: number) => originX + badge.x - Math.round(padCss * dpr);
    const padY = (padCss: number) => originY + badge.y - Math.round(padCss * dpr);
    if (mult > 0) {
      const bmp = set.multipliers.get(mult);
      if (bmp) ctx.drawImage(bmp.canvas, padX(bmp.padCss), padY(bmp.padCss));
      continue;
    }
    const number = set.numbers[ticket.balls[i] ?? 0];
    if (number) ctx.drawImage(number, x, y);
    if (ticket.hits.includes(i)) {
      ctx.drawImage(set.dab.canvas, padX(set.dab.padCss), padY(set.dab.padCss));
    }
  }
}

export function catalogCellBoxes(dpr: number): CellBox[] {
  const layout = getActiveLayout();
  return (getLiveCellBoxModel() ?? resolveCellBoxModel(layout, dpr)).cells;
}
