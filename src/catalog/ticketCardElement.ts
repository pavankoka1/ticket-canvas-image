import { getActiveLayout } from './catalogLayout';
import { BALLS_PER_TICKET } from './layout';
import type { Ticket } from './tickets';

/**
 * Fortunamania-aligned pooled ticket (see games/fortunamania Ticket.ts).
 * Structure: root > header(win,id) > body > cell×6
 */
export class TicketCard {
  readonly dom: HTMLElement;
  private readonly idText: Text;
  private readonly cellTexts: Text[] = [];
  private readonly cellEls: HTMLElement[] = [];
  private layoutKey: string | null = null;

  constructor() {
    const root = document.createElement('div');
    root.className = 'ticketCard';
    root.style.position = 'absolute';
    root.style.pointerEvents = 'none';
    root.style.visibility = 'hidden';

    const header = document.createElement('div');
    header.className = 'ticketCard__header';

    const winEl = document.createElement('span');
    winEl.className = 'ticketCard__win';

    const idEl = document.createElement('span');
    idEl.className = 'ticketCard__id';
    const idText = document.createTextNode('');
    idEl.appendChild(idText);
    header.append(winEl, idEl);

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

    root.append(header, body);
    this.dom = root;
    this.idText = idText;

    const layout = getActiveLayout();
    this.applyCardWidth(layout.cardWidth);
  }

  applyCardWidth(cardWidth: number, force = false): void {
    if (cardWidth <= 0) return;
    const layout = getActiveLayout();
    const key = `${layout.metrics.id}|${cardWidth}|${layout.cardHeight}`;
    if (!force && this.layoutKey === key) return;
    this.layoutKey = key;
    this.dom.style.width = `${cardWidth}px`;
    this.dom.style.height = `${layout.cardHeight}px`;
  }

  bind(ticket: Ticket, x?: number, y?: number): void {
    this.applyCardWidth(getActiveLayout().cardWidth);
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

export function attachTicketCard(card: TicketCard): TicketCard {
  (card.dom as HTMLElement & { __ticketCard?: TicketCard }).__ticketCard = card;
  return card;
}
