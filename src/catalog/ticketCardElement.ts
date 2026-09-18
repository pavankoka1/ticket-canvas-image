import {
  applyCellBoxCssVars,
  getLiveCellBoxModel,
  resolveCellBoxModel,
  setLiveCellBoxModel,
  type CellBoxModel,
} from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { BALLS_PER_TICKET } from "./layout";
import type { Ticket } from "./tickets";

export type TicketDomParts = {
  root: HTMLElement;
  idText: Text;
  cellEls: HTMLElement[];
  cellTexts: Text[];
};

/**
 * Same DOM tree as fortunamania Ticket.ts — header + body + 6 cells.
 * Used by the live pool and by the SnapDOM atlas (one source of CSS).
 */
export function createTicketDom(): TicketDomParts {
  const root = document.createElement("div");
  root.className = "ticketCard";

  const header = document.createElement("div");
  header.className = "ticketCard__header";

  const winEl = document.createElement("span");
  winEl.className = "ticketCard__win";

  const idEl = document.createElement("span");
  idEl.className = "ticketCard__id";
  const idText = document.createTextNode("");
  idEl.appendChild(idText);
  header.append(winEl, idEl);

  const body = document.createElement("div");
  body.className = "ticketCard__body";

  const cellEls: HTMLElement[] = [];
  const cellTexts: Text[] = [];
  for (let i = 0; i < BALLS_PER_TICKET; i++) {
    const cell = document.createElement("span");
    cell.className = "ticketCard__cell";
    const text = document.createTextNode("");
    cell.appendChild(text);
    body.appendChild(cell);
    cellEls.push(cell);
    cellTexts.push(text);
  }

  root.append(header, body);
  return { root, idText, cellEls, cellTexts };
}

/** Apply (ticketWidth − 6) / 6 fixed cell boxes — same as atlas. */
export function applyTicketCellLayout(
  root: HTMLElement,
  cellEls: HTMLElement[],
  model: CellBoxModel,
): void {
  const layout = getActiveLayout();
  root.style.width = `${model.cardWidth}px`;
  root.style.height = `${layout.cardHeight}px`;
  applyCellBoxCssVars(root, model, layout.metrics);

  for (const cell of cellEls) {
    cell.style.boxSizing = "border-box";
    cell.style.width = `${model.cellW}px`;
    cell.style.height = `${model.cellH}px`;
    cell.style.flex = `0 0 ${model.cellW}px`;
    // Keep CSS margin-left (separator gap) — do not zero margins.
    cell.style.removeProperty("margin");
  }
}

/**
 * Fortunamania-aligned pooled ticket.
 * DOM + CSS identical to atlas snapshot source.
 */
export class TicketCard {
  readonly dom: HTMLElement;
  private readonly idText: Text;
  private readonly cellTexts: Text[] = [];
  private readonly cellEls: HTMLElement[] = [];
  private layoutKey: string | null = null;

  constructor() {
    const parts = createTicketDom();
    parts.root.style.position = "absolute";
    parts.root.style.pointerEvents = "none";
    parts.root.style.visibility = "hidden";

    this.dom = parts.root;
    this.idText = parts.idText;
    this.cellEls = parts.cellEls;
    this.cellTexts = parts.cellTexts;

    this.applyCardWidth(getActiveLayout().cardWidth);
  }

  applyCardWidth(cardWidth: number, force = false): void {
    if (cardWidth <= 0) return;
    const layout = getActiveLayout();
    let model = getLiveCellBoxModel();
    if (!model || model.cardWidth !== cardWidth) {
      model = resolveCellBoxModel(layout);
      setLiveCellBoxModel(model);
    }

    const key = `${layout.metrics.id}|${cardWidth}|${layout.cardHeight}|${model.cellW}x${model.cellH}`;
    if (!force && this.layoutKey === key) return;
    this.layoutKey = key;

    applyTicketCellLayout(this.dom, this.cellEls, model);
  }

  bind(ticket: Ticket, x?: number, y?: number): void {
    this.applyCardWidth(getActiveLayout().cardWidth);
    if (this.idText.data !== ticket.no) this.idText.data = ticket.no;
    for (let i = 0; i < BALLS_PER_TICKET; i++) {
      const next = String(ticket.balls[i] ?? "");
      if (this.cellTexts[i]!.data !== next) this.cellTexts[i]!.data = next;
      this.cellEls[i]!.classList.toggle(
        "ticketCard__cell_hit",
        ticket.hits.includes(i),
      );
    }
    if (x !== undefined && y !== undefined) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const sx = Math.round(x * dpr) / dpr;
      const sy = Math.round(y * dpr) / dpr;
      this.dom.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
    }
    this.dom.style.visibility = "visible";
  }

  hide(): void {
    this.dom.style.visibility = "hidden";
  }
}

export function attachTicketCard(card: TicketCard): TicketCard {
  (card.dom as HTMLElement & { __ticketCard?: TicketCard }).__ticketCard = card;
  return card;
}
