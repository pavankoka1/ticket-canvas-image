import { playTicketAppear } from './appear';
import { getActiveLayout } from './catalogLayout';
import { playTicketDraw } from './drawGesture';
import { DOM_POOL_SIZE } from './layout';
import {
  attachTicketCard,
  probeSlotPlacementDrift,
  snapSlot,
  TicketCard,
} from './ticketCardElement';
import type { DrawHit, Ticket, TicketSlot } from './tickets';

/** Fixed viewport DOM pool — never grows with catalog size. */
export class DomPool {
  private cards: TicketCard[] = [];
  private byId = new Map<string, number>();
  private free: number[] = [];
  private ready = false;
  private readonly host: HTMLElement;
  readonly size: number;

  constructor(host: HTMLElement, size: number = DOM_POOL_SIZE) {
    this.host = host;
    this.size = size;
  }

  mount(): void {
    if (this.ready) return;
    for (let i = 0; i < this.size; i++) {
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

  rebind(
    slots: readonly TicketSlot[],
    ticketsById: Map<string, Ticket>,
    appearIds?: ReadonlySet<string>,
  ): void {
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
      const isNew = idx === undefined;
      if (idx === undefined) {
        idx = this.free.pop();
        if (idx === undefined) break;
        this.byId.set(slot.id, idx);
      }
      const card = this.cards[idx]!;
      // Unchanged band members keep their DOM as-is — bind only new/moved/updated.
      if (!isNew && card.shows(ticket, slot.x, slot.y)) continue;
      card.bind(ticket, slot.x, slot.y);
      probeSlotPlacementDrift(card.dom, this.host, slot.x, slot.y);
      if (isNew && appearIds?.has(slot.id)) playAppear(card, slot.x, slot.y);
    }
  }

  /** Stop dab, dip, and shine. Used when draws are cleared. */
  clearMotion(): void {
    if (!this.ready) return;
    for (const card of this.cards) {
      card.cancelMotion();
      card.hideShine();
    }
  }

  /**
   * FLIP visible cards whose slot changed. New cards are left to the appear
   * gesture. Off-screen cards are not in the pool, so they snap.
   */
  playMoves(
    from: ReadonlyMap<string, { x: number; y: number }>,
    slots: readonly TicketSlot[],
    durationMs: number,
  ): void {
    if (!this.ready || durationMs <= 0) return;
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    for (const slot of slots) {
      const prev = from.get(slot.id);
      const idx = this.byId.get(slot.id);
      if (!prev || idx === undefined) continue;
      const was = snapSlot(prev.x, prev.y);
      const now = snapSlot(slot.x, slot.y);
      const dx = was.x - now.x;
      const dy = was.y - now.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      const card = this.cards[idx]!;
      const el = card.dom;
      card.cancelMotion();
      const token = card.beginMotion();
      const anim = el.animate(
        [{ translate: `${dx}px ${dy}px` }, { translate: "0px 0px" }],
        { duration: durationMs, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "forwards" },
      );
      void anim.finished.then(
        () => {
          anim.cancel();
          el.style.removeProperty("translate");
          card.endMotion(token);
        },
        () => {
          card.endMotion(token);
        },
      );
    }
  }

  /** Draw gesture on cards currently in the pool. Scrolled-away tickets stay canvas. */
  playDraws(hits: readonly DrawHit[]): void {
    if (!this.ready || hits.length === 0) return;
    const layout = getActiveLayout();
    for (const hit of hits) {
      const idx = this.byId.get(hit.id);
      if (idx === undefined) continue;
      playTicketDraw(this.cards[idx]!, hit.cell, hit.kind, layout.cardWidth, layout.cardHeight);
    }
  }

  refreshLayout(): void {
    const w = getActiveLayout().cardWidth;
    for (const card of this.cards) card.applyCardWidth(w, true);
  }

  setVisible(visible: boolean): void {
    this.host.style.opacity = visible ? '1' : '0';
  }
}

function playAppear(card: TicketCard, x: number, y: number): void {
  const layout = getActiveLayout();
  const slot = snapSlot(x, y);
  playTicketAppear(
    card,
    slot.x,
    slot.y,
    layout.cardWidth,
    layout.gap,
    layout.metrics.numberFontSize,
  );
}
