/**
 * Catalog canvas paint via compare svg-all atlas (shared warm pack + DOM overlay text).
 */

import { activeDpr, applyCellBoxCssVars, resolveCellBoxModel } from "./cellBoxModel";
import type { CatalogLayout } from "./catalogLayout";
import { getActiveLayout } from "./catalogLayout";
import { applyTicketCssVars } from "./ticketPresets";
import {
  type ComparePaintPack,
  prepareCompareCard,
  warmCatalogCompareAtlas,
} from "./compareCachedSprites";
import { SVG_FACE_CLASS } from "./compareSvgText";
import { setCompareRenderMode } from "./compareRenderMode";
import { paintSvgAllCompareTicket } from "./compareSvgAllPaint";
import { loadSvgMultiplierAssets } from "./compareSvgMultiplier";
import { stampHeaderGlyphsSync } from "./compareGlyphAtlas";
import { styleCompareTicketDom } from "./compareDomAlign";
import { TicketCard } from "./ticketCardElement";
import { isWinTicket, type Ticket } from "./tickets";
import { paintCatalogTicket } from "./catalogPaint";

let paintPack: ComparePaintPack | null = null;
let measureCard: TicketCard | null = null;
let measureHost: HTMLElement | null = null;

function ensureMeasureCardHost(layout: CatalogLayout): TicketCard {
  if (!measureHost) {
    measureHost = document.createElement("div");
    measureHost.style.cssText =
      "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none";
    measureHost.setAttribute("aria-hidden", "true");
    document.body.append(measureHost);
  }
  if (!measureCard) {
    measureCard = new TicketCard();
    styleCompareTicketDom(measureCard.dom);
    measureHost.append(measureCard.dom);
  }
  const dpr = activeDpr();
  const model = resolveCellBoxModel(layout, dpr);
  applyTicketCssVars(measureHost, layout.metrics);
  applyCellBoxCssVars(measureHost, model, layout.metrics);
  measureHost.style.width = `${layout.cardWidth}px`;
  measureHost.style.height = `${layout.cardHeight}px`;
  return measureCard;
}

export function isCatalogSvgPaintReady(): boolean {
  return Boolean(paintPack?.headerGlyphs && paintPack.catalogChrome.size >= 3);
}

export async function ensureCatalogSvgAtlasWarm(
  layout: CatalogLayout,
): Promise<void> {
  setCompareRenderMode("svg-all");
  await loadSvgMultiplierAssets();
  const dpr = activeDpr();
  paintPack = await warmCatalogCompareAtlas(layout, dpr);
  ensureMeasureCardHost(layout);
}

export function prepareCatalogDomCard(card: TicketCard): void {
  if (!isCatalogSvgPaintReady()) return;
  const layout = getActiveLayout();
  card.dom.classList.add(SVG_FACE_CLASS);
  prepareCompareCard(card, layout, activeDpr());
}

/** Paint one catalog tile ticket with the compare svg-all sprite stack. */
export function paintCatalogTicketSvgAll(
  ctx: CanvasRenderingContext2D,
  ticket: Ticket,
  originX: number,
  originY: number,
  layout: CatalogLayout,
  dpr: number,
): void {
  const pack = paintPack;
  if (!pack?.headerGlyphs || pack.catalogChrome.size < 3) {
    const boxes = resolveCellBoxModel(layout, dpr).cells;
    paintCatalogTicket(ctx, ticket, originX, originY, layout.cardWidth, dpr, boxes);
    return;
  }

  const model = resolveCellBoxModel(layout, dpr);
  const face = ticket.disabled ? "disabled" : isWinTicket(ticket) ? "gold" : "normal";
  const chrome = pack.catalogChrome.get(face);
  if (!chrome) return;

  const card = ensureMeasureCardHost(layout);
  card.bind(ticket, 0, 0, layout);
  card.dom.classList.add("ticketCard_compare", SVG_FACE_CLASS);
  prepareCompareCard(card, layout, dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(chrome.bitmap, originX, originY);

  paintSvgAllCompareTicket(
    ctx,
    ticket,
    pack,
    layout,
    model.cells.map((c) => c.x),
    model.cellW,
    face,
    originX,
    originY,
    dpr,
    "badge-host",
    model.cells,
  );

  const winText = isWinTicket(ticket) && ticket.win ? ticket.win : "";
  stampHeaderGlyphsSync(
    ctx,
    card.dom,
    ticket.no,
    winText,
    face,
    dpr,
    pack.headerGlyphs,
    originX,
    originY,
  );
}
