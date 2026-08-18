import { BALLS_PER_TICKET, CARD_HEIGHT, CARD_WIDTH } from './layout';
import type { Ticket } from './tickets';

/**
 * Moneyball-style pooled ticket: fixed `div` tree + Text nodes.
 * Separators are CSS (`::before`) — no extra DOM per gap.
 *
 * Structure (11 elements):
 *   root > scaler > header > id
 *                 > body > cell×6
 */
export class TicketCard {
  readonly dom: HTMLElement;
  private readonly idText: Text;
  private readonly cellTexts: Text[] = [];
  private readonly cellEls: HTMLElement[] = [];

  constructor() {
    const root = document.createElement('div');
    root.className = 'ticketCard';
    root.style.position = 'absolute';
    root.style.width = `${CARD_WIDTH}px`;
    root.style.height = `${CARD_HEIGHT}px`;
    root.style.pointerEvents = 'none';
    root.style.visibility = 'hidden';

    const scaler = document.createElement('div');
    scaler.className = 'ticketCard__scaler';

    const header = document.createElement('div');
    header.className = 'ticketCard__header';
    const idEl = document.createElement('span');
    idEl.className = 'ticketCard__id';
    const idText = document.createTextNode('');
    idEl.appendChild(idText);
    header.appendChild(idEl);

    const body = document.createElement('div');
    body.className = 'ticketCard__body';
    for (let i = 0; i < BALLS_PER_TICKET; i++) {
      const cell = document.createElement('span');
      cell.className = 'ticketCard__cell';
      const text = document.createTextNode('');
      cell.appendChild(text);
      body.appendChild(cell);
      this.cellEls.push(cell);
      this.cellTexts.push(text);
    }

    scaler.append(header, body);
    root.appendChild(scaler);

    this.dom = root;
    this.idText = idText;
  }

  bind(ticket: Ticket, x?: number, y?: number): void {
    if (this.idText.data !== ticket.no) this.idText.data = ticket.no;
    for (let i = 0; i < BALLS_PER_TICKET; i++) {
      const next = String(ticket.balls[i] ?? '');
      if (this.cellTexts[i]!.data !== next) this.cellTexts[i]!.data = next;
      this.cellEls[i]!.classList.toggle('ticketCard__cell_hit', ticket.hits.includes(i));
    }
    if (x !== undefined && y !== undefined) {
      this.dom.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    this.dom.style.visibility = 'visible';
  }

  hide(): void {
    this.dom.style.visibility = 'hidden';
  }
}

/** @deprecated Use TicketCard — kept for call-site migration. */
export function createTicketCardElement(): HTMLElement {
  return new TicketCard().dom;
}

/** Bind via TicketCard instance stored on the element. */
export function bindTicketCard(el: HTMLElement, ticket: Ticket): void {
  const card = (el as HTMLElement & { __ticketCard?: TicketCard }).__ticketCard;
  if (card) {
    card.bind(ticket);
    return;
  }
  // Capture-sheet fallback: elements created as TicketCard.dom with __ticketCard set.
  const idEl = el.querySelector('.ticketCard__id');
  if (idEl) idEl.textContent = ticket.no;
  const cells = el.querySelectorAll('.ticketCard__cell');
  cells.forEach((cell, i) => {
    cell.textContent = String(ticket.balls[i] ?? '');
    cell.classList.toggle('ticketCard__cell_hit', ticket.hits.includes(i));
  });
}

export function attachTicketCard(card: TicketCard): TicketCard {
  (card.dom as HTMLElement & { __ticketCard?: TicketCard }).__ticketCard = card;
  return card;
}
