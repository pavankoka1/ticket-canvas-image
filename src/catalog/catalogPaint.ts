/**
 * Catalog tile paint. One ticket is shared bitmaps:
 * card face, a whole win-amount image, id digits, six cells.
 */

import { badgeHostDevice, getLiveCellBoxModel, resolveCellBoxModel } from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { getCellBitmaps, peekTicketChrome } from "./cellBitmaps";
import { paintAmount, paintIdDigits } from "./headerGlyphs";
import { BALLS_PER_TICKET } from "./layout";
import { isWinTicket, type Ticket } from "./tickets";

type CellBox = { x: number; y: number; w: number; h: number };

export function paintCatalogTicket(
  ctx: CanvasRenderingContext2D,
  ticket: Ticket,
  originX: number,
  originY: number,
  cardWidth: number,
  dpr: number,
  boxes: readonly CellBox[],
): void {
  const win = isWinTicket(ticket);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;

  const chrome = ticket.disabled
    ? (peekTicketChrome(false, true) ?? peekTicketChrome(false))
    : peekTicketChrome(win);
  if (chrome) ctx.drawImage(chrome, originX, originY);
  if (win && ticket.win) paintAmount(ctx, ticket.win, originX, originY, dpr);
  paintIdDigits(
    ctx,
    ticket.no,
    ticket.disabled ? "idDisabled" : win ? "idGold" : "idNormal",
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
      const bmp = ticket.disabled
        ? (set.disabledMultipliers.get(mult) ?? set.multipliers.get(mult))
        : set.multipliers.get(mult);
      if (bmp) ctx.drawImage(bmp.canvas, padX(bmp.padCss), padY(bmp.padCss));
      continue;
    }
    const ball = ticket.balls[i] ?? 0;
    const number = ticket.disabled
      ? (set.disabledNumbers[ball] ?? set.numbers[ball])
      : set.numbers[ball];
    if (number) ctx.drawImage(number, x, y);
    if (ticket.hits.includes(i)) {
      const dab = ticket.disabled ? set.disabledDab : set.dab;
      ctx.drawImage(dab.canvas, padX(dab.padCss), padY(dab.padCss));
    }
  }
}

export function catalogCellBoxes(dpr: number): CellBox[] {
  const layout = getActiveLayout();
  return (getLiveCellBoxModel() ?? resolveCellBoxModel(layout, dpr)).cells;
}
