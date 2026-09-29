/**
 * Catalog tile paint.
 * Body cells, chrome, id, amount, badges: paint-DPR raster → 1:1 blit (no cell-box stretch).
 */

import {
  activeDpr,
  badgeHostDevice,
  blitPaintDprCellBody,
  blitPaintDprSprite,
  getLiveCellBoxModel,
  resolveCellBoxModel,
} from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import {
  cellAtlasSize,
  getCellBitmap,
  resolveLiveCellBoxModel,
} from "./cellAtlas";
import {
  getCellBitmaps,
  peekTicketChrome,
  type BitmapSprite,
  type PlacedBitmap,
} from "./cellBitmaps";
import {
  isAmountReady,
  isTicketIdReady,
  paintAmount,
  paintIdDigits,
} from "./headerGlyphs";
import { BALLS_PER_TICKET } from "./layout";
import type { TicketDomDeviceScale } from "./ticketDomMeasure";
import { isWinTicket, type Ticket } from "./tickets";

function chromeHasPixels(chrome: BitmapSprite): boolean {
  const w = chrome instanceof ImageBitmap ? chrome.width : chrome.width;
  const h = chrome instanceof ImageBitmap ? chrome.height : chrome.height;
  return w > 0 && h > 0;
}

export function isCatalogTicketPaintReady(ticket: Ticket): boolean {
  const set = getCellBitmaps();
  if (!set) return false;
  const win = isWinTicket(ticket);
  const chrome = ticket.disabled
    ? (peekTicketChrome(false, true) ?? peekTicketChrome(false))
    : peekTicketChrome(win);
  if (!chrome || !chromeHasPixels(chrome)) return false;
  if (!isTicketIdReady(ticket)) return false;
  if (win && ticket.win && !isAmountReady(ticket.win)) return false;
  if (ticket.disabled) {
    if (!set.disabledNumbers[1] && !set.numbers[1]) return false;
  } else if (cellAtlasSize() < 60 && !set.numbers[1]) {
    return false;
  }
  return true;
}

type CellBox = { x: number; y: number; w: number; h: number };

export type CatalogPaintOpts = {
  idDigitInkLeftsDev?: readonly number[] | null;
  faceBufferW?: number;
  faceBufferH?: number;
  deviceScale?: TicketDomDeviceScale;
};

export function paintCatalogTicket(
  ctx: CanvasRenderingContext2D,
  ticket: Ticket,
  originX: number,
  originY: number,
  cardWidth: number,
  dpr: number,
  boxes: readonly CellBox[],
  opts?: CatalogPaintOpts,
): void {
  const win = isWinTicket(ticket);
  const layout = getActiveLayout();
  const metrics = layout.metrics;
  const paintDpr = activeDpr();
  const cells =
    boxes.length >= BALLS_PER_TICKET
      ? boxes
      : (getLiveCellBoxModel() ?? resolveCellBoxModel(layout, dpr)).cells;
  const scale = opts?.deviceScale;
  const scaleX = scale?.sx ?? dpr;
  const scaleY = scale?.sy ?? dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;

  const chrome = ticket.disabled
    ? (peekTicketChrome(false, true) ?? peekTicketChrome(false))
    : peekTicketChrome(win);
  if (chrome) {
    blitPaintDprSprite(ctx, chrome, originX, originY, paintDpr, scaleX, scaleY);
  }
  if (win && ticket.win) {
    paintAmount(ctx, ticket.win, originX, originY, paintDpr, scaleX, scaleY);
  }
  paintIdDigits(
    ctx,
    ticket.no,
    ticket.disabled ? "idDisabled" : win ? "idGold" : "idNormal",
    originX,
    originY,
    cardWidth,
    paintDpr,
    scaleX,
    scaleY,
    opts?.idDigitInkLeftsDev,
  );

  const set = getCellBitmaps();
  if (!set) return;

  const blitBadge = (bmp: PlacedBitmap, cell: CellBox) => {
    const host = badgeHostDevice(cell, metrics.dabSize, paintDpr);
    const rx = scaleX / paintDpr;
    const ry = scaleY / paintDpr;
    ctx.drawImage(
      bmp.canvas,
      originX + Math.round(host.x * rx) - Math.round(bmp.padX * scaleX),
      originY + Math.round(host.y * ry) - Math.round(bmp.padY * scaleY),
    );
  };

  for (let i = 0; i < BALLS_PER_TICKET; i++) {
    const cell = cells[i];
    if (!cell) continue;
    const mult = ticket.multipliers[i] ?? 0;
    const hit = ticket.hits.includes(i);
    if (mult > 0) {
      const bmp = ticket.disabled
        ? (set.disabledMultipliers.get(mult) ?? set.multipliers.get(mult))
        : set.multipliers.get(mult);
      if (bmp) blitBadge(bmp, cell);
      continue;
    }
    if (!hit) {
      const ball = ticket.balls[i] ?? 0;
      const atlasBmp =
        !ticket.disabled && cellAtlasSize() >= 60 ? getCellBitmap(ball) : undefined;
      const number =
        atlasBmp ??
        (ticket.disabled
          ? (set.disabledNumbers[ball] ?? set.numbers[ball])
          : set.numbers[ball]);
      if (number) {
        blitPaintDprCellBody(
          ctx,
          number,
          cell,
          originX,
          originY,
          paintDpr,
          scaleX,
          scaleY,
          true,
        );
      }
    }
    if (hit) {
      const dab = ticket.disabled ? set.disabledDab : set.dab;
      blitBadge(dab, cell);
    }
  }
}

export function catalogCellBoxes(dpr: number): CellBox[] {
  const layout = getActiveLayout();
  return resolveLiveCellBoxModel(layout, dpr).cells;
}
