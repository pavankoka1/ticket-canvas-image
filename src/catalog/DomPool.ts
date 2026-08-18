import { DOM_POOL_SIZE } from './layout';
import { attachTicketCard, TicketCard } from './ticketCardElement';
import type { Ticket, TicketSlot } from './tickets';

/** Fixed viewport DOM pool — moneyball-style slim cards, never grows with catalog size. */
export class DomPool {
  private cards: TicketCard[] = [];
  private byId = new Map<string, number>();
  private free: number[] = [];
  private ready = false;
  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  mount(): void {
    if (this.ready) return;
    for (let i = 0; i < DOM_POOL_SIZE; i++) {
      const card = attachTicketCard(new TicketCard());
      this.host.appendChild(card.dom);
      this.cards.push(card);
      this.free.push(i);
    }
    this.ready = true;
    this.host.style.opacity = '1';
  }

  get isReady(): boolean {
    return this.ready;
  }

  rebind(slots: readonly TicketSlot[], ticketsById: Map<string, Ticket>): void {
    if (!this.ready) return;
    const keep = new Set(slots.map((s) => s.id));

    for (const [id, idx] of [...this.byId]) {
      if (keep.has(id)) continue;
      this.cards[idx]!.hide();
      this.byId.delete(id);
      this.free.push(idx);
    }

    for (const slot of slots) {
      const ticket = ticketsById.get(slot.id);
      if (!ticket) continue;
      let idx = this.byId.get(slot.id);
      if (idx === undefined) {
        idx = this.free.pop();
        if (idx === undefined) break;
        this.byId.set(slot.id, idx);
      }
      this.cards[idx]!.bind(ticket, slot.x, slot.y);
    }
  }

  setVisible(visible: boolean): void {
    this.host.style.opacity = visible ? '1' : '0';
  }
}
