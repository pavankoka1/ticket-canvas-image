import { playTicketAppear, prefersReducedMotion } from '../animation/appear';
import { EASE_IN_OUT_CUBIC } from '../animation/drawPhase';
import { getActiveLayout, rowHeight } from '../layout/catalogLayout';
import { playTicketDraw } from '../animation/drawGesture';
import { DOM_POOL_SIZE } from '../constants';
import { isCatalogSvgPaintReady, prepareCatalogDomCard } from '../canvas/paint/catalogSvgPaint';
import { refreshSvgOverlayInk, SVG_FACE_CLASS } from '../../catalog/compareSvgText';
import {
  attachTicketCard,
  probeSlotPlacementDrift,
  snapSlot,
  TicketCard,
} from './ticketCardElement';
import type { DrawHit, Ticket, TicketSlot } from '../model/tickets';

export type DomPoolMotionHooks = {
  onMotionStart?: () => void;
  onMotionEnd?: () => void;
};

export type FlipScrollContext = {
  scrollTop: number;
  viewH: number;
  cardHeight: number;
};

/**
 * Pull an off-screen FLIP endpoint to just past the viewport edge on its side, so a card
 * from far below enters as if it sat one card under the fold (same duration as every card).
 */
function clampToViewportEdge(y: number, ctx: FlipScrollContext): number {
  const top = ctx.scrollTop - ctx.cardHeight;
  const bottom = ctx.scrollTop + ctx.viewH;
  return Math.max(top, Math.min(bottom, y));
}

function isOutsideViewport(y: number, ctx: FlipScrollContext): boolean {
  return y + ctx.cardHeight <= ctx.scrollTop || y >= ctx.scrollTop + ctx.viewH;
}

/** Fixed viewport DOM pool — never grows with catalog size. */
export class DomPool {
  private cards: TicketCard[] = [];
  private byId = new Map<string, number>();
  private free: number[] = [];
  private ready = false;
  private readonly host: HTMLElement;
  private motionHooks: DomPoolMotionHooks = {};
  /** Leaving band during shuffle FLIP — indices stay bound until animation ends. */
  private deferredLeave: { id: string; idx: number }[] = [];
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

  /** Ticket ids with a live card in the pool (the real DOM band). */
  boundIds(): ReadonlySet<string> {
    return new Set(this.byId.keys());
  }

  boundCardElements(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const idx of this.byId.values()) out.push(this.cards[idx]!.dom);
    return out;
  }

  /** Bound pool cards below the first row (`columns` wide). */
  getDomCardsBelow(_columns: number): HTMLElement[] {
    return this.cardElementsBelowRow(1);
  }

  /** Pool cards strictly below the given row index (0 = first row). */
  cardElementsBelowRow(row: number): HTMLElement[] {
    const layout = getActiveLayout();
    const threshold = row * rowHeight(layout);
    const out: HTMLElement[] = [];
    for (const idx of this.byId.values()) {
      const el = this.cards[idx]!.dom;
      const y = parseFloat(el.style.top) || 0;
      if (y >= threshold + 0.5) out.push(el);
    }
    return out;
  }

  setMotionHooks(hooks: DomPoolMotionHooks): void {
    this.motionHooks = hooks;
  }

  rebind(
    slots: readonly TicketSlot[],
    ticketsById: Map<string, Ticket>,
    appearIds?: ReadonlySet<string>,
    forceRebind = false,
  ): number[] {
    if (!this.ready) return [];
    const keep = new Set(slots.map((s) => s.id));
    const pendingHide: number[] = [];

    for (const id of this.byId.keys()) {
      if (keep.has(id)) continue;
      const idx = this.byId.get(id)!;
      this.byId.delete(id);
      this.free.push(idx);
      pendingHide.push(idx);
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
      if (!forceRebind && !isNew && card.shows(ticket, slot.x, slot.y)) continue;
      const needSvgInk =
        forceRebind || isNew || !card.showsInk(ticket) || !card.dom.classList.contains(SVG_FACE_CLASS);
      card.bind(ticket, slot.x, slot.y, getActiveLayout());
      if (needSvgInk) {
        if (isCatalogSvgPaintReady()) {
          prepareCatalogDomCard(card);
        } else if (card.dom.classList.contains(SVG_FACE_CLASS)) {
          refreshSvgOverlayInk(card.dom);
        } else {
          prepareCatalogDomCard(card);
        }
      }
      probeSlotPlacementDrift(card.dom, this.host, slot.x, slot.y);
      if (isNew && appearIds?.has(slot.id)) this.playAppear(card, slot.x, slot.y);
    }

    return pendingHide;
  }

  /**
   * Post-sort shuffle: keep leaving cards in the pool for FLIP-out; defer hide until
   * `playMoves` / `commitShuffleEvict`.
   */
  rebindForShuffle(
    bandSlots: readonly TicketSlot[],
    ticketsById: Map<string, Ticket>,
    flipFrom: ReadonlyMap<string, { x: number; y: number }>,
  ): void {
    if (!this.ready) return;
    this.deferredLeave = [];
    const keep = new Set(bandSlots.map((s) => s.id));
    const layout = getActiveLayout();

    for (const id of [...this.byId.keys()]) {
      if (keep.has(id)) continue;
      const idx = this.byId.get(id)!;
      this.deferredLeave.push({ id, idx });
    }

    for (const slot of bandSlots) {
      const ticket = ticketsById.get(slot.id);
      if (!ticket) continue;
      let idx = this.byId.get(slot.id);
      const isNew = idx === undefined;
      if (idx === undefined) {
        idx = this.free.pop();
        if (idx === undefined) continue;
        this.byId.set(slot.id, idx);
      }
      const card = this.cards[idx]!;
      const prev = flipFrom.get(slot.id);
      const was = prev ? snapSlot(prev.x, prev.y) : null;
      const now = snapSlot(slot.x, slot.y);
      const needsFlip =
        was !== null &&
        (Math.abs(was.x - now.x) >= 0.5 || Math.abs(was.y - now.y) >= 0.5);
      const needSvgInk =
        isNew || !card.showsInk(ticket) || !card.dom.classList.contains(SVG_FACE_CLASS);
      card.bind(ticket, slot.x, slot.y, layout, { deferPosition: needsFlip });
      if (needSvgInk) {
        if (isCatalogSvgPaintReady()) {
          prepareCatalogDomCard(card);
        } else if (card.dom.classList.contains(SVG_FACE_CLASS)) {
          refreshSvgOverlayInk(card.dom);
        } else {
          prepareCatalogDomCard(card);
        }
      }
      probeSlotPlacementDrift(card.dom, this.host, slot.x, slot.y);
    }
  }

  commitShuffleEvict(): void {
    if (!this.ready || this.deferredLeave.length === 0) return;
    const hide: number[] = [];
    for (const { id, idx } of this.deferredLeave) {
      if (this.byId.get(id) === idx) {
        this.byId.delete(id);
        this.free.push(idx);
        hide.push(idx);
      }
    }
    this.deferredLeave = [];
    this.hideEvictedSlots(hide);
  }

  /** Hide pool slots evicted from the band — call after canvas has repainted them. */
  hideEvictedSlots(pendingHide: readonly number[]): void {
    if (!this.ready || pendingHide.length === 0) return;
    for (const idx of pendingHide) {
      let reused = false;
      for (const bound of this.byId.values()) {
        if (bound === idx) {
          reused = true;
          break;
        }
      }
      if (!reused) this.cards[idx]!.hide();
    }
  }

  private playAppear(card: TicketCard, x: number, y: number): void {
    const layout = getActiveLayout();
    const slot = snapSlot(x, y);
    this.motionHooks.onMotionStart?.();
    playTicketAppear(
      card,
      slot.x,
      slot.y,
      layout.cardWidth,
      layout.gap,
      layout.metrics.numberFontSize,
      () => this.motionHooks.onMotionEnd?.(),
    );
  }

  /** Cancel in-flight FLIP / appear transitions before layout changes. */
  cancelAllMotion(): void {
    if (!this.ready) return;
    for (const card of this.cards) card.cancelMotion();
    this.commitShuffleEvict();
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
   * Fortunamania `flipTicketsFromRects`: one duration and easing for every card. Endpoints
   * outside the viewport are clamped to its edge (see `clampToViewportEdge`); cards that
   * start and end off-screen snap.
   */
  playMoves(
    from: ReadonlyMap<string, { x: number; y: number }>,
    slots: readonly TicketSlot[],
    durationMs: number,
    targetsById?: ReadonlyMap<string, { x: number; y: number }>,
    flipScroll?: FlipScrollContext,
  ): void {
    if (!this.ready) return;
    if (durationMs <= 0 || prefersReducedMotion()) {
      this.commitShuffleEvict();
      return;
    }
    type PendingFlip = {
      card: TicketCard;
      ox: number;
      oy: number;
      nx: number;
      ny: number;
      /** Real slot; differs from `ny` when the target is clamped off-screen. */
      fx: number;
      fy: number;
    };
    const pendingFlips: PendingFlip[] = [];

    const queueFlip = (card: TicketCard, prev: { x: number; y: number }, next: { x: number; y: number }) => {
      const was = snapSlot(prev.x, prev.y);
      const now = snapSlot(next.x, next.y);
      let { x: ox, y: oy } = was;
      let ny = now.y;
      if (flipScroll) {
        if (isOutsideViewport(oy, flipScroll) && isOutsideViewport(ny, flipScroll)) {
          card.cancelMove();
          card.snapTo(now.x, now.y);
          return;
        }
        oy = clampToViewportEdge(oy, flipScroll);
        ny = clampToViewportEdge(ny, flipScroll);
      }
      if (Math.abs(ox - now.x) < 0.5 && Math.abs(oy - ny) < 0.5) {
        card.cancelMove();
        card.snapTo(now.x, now.y);
        return;
      }
      pendingFlips.push({ card, ox, oy, nx: now.x, ny, fx: now.x, fy: now.y });
    };

    for (const slot of slots) {
      const prev = from.get(slot.id);
      const idx = this.byId.get(slot.id);
      if (!prev || idx === undefined) continue;
      queueFlip(this.cards[idx]!, prev, slot);
    }

    if (targetsById) {
      for (const { id, idx } of this.deferredLeave) {
        const prev = from.get(id);
        const target = targetsById.get(id);
        if (!prev || !target || this.byId.get(id) !== idx) continue;
        queueFlip(this.cards[idx]!, prev, target);
      }
    }

    if (pendingFlips.length === 0) {
      this.commitShuffleEvict();
      return;
    }

    this.motionHooks.onMotionStart?.();
    let pending = pendingFlips.length;
    const oneDone = () => {
      pending -= 1;
      if (pending > 0) return;
      this.commitShuffleEvict();
      this.motionHooks.onMotionEnd?.();
    };

    // Only `translate` moves: a draw dip (`scale`), badge or shine still running keeps going.
    for (const { card, ox, oy, nx, ny, fx, fy } of pendingFlips) {
      const anim = card.startMove(
        [{ translate: `${ox}px ${oy}px` }, { translate: `${nx}px ${ny}px` }],
        { duration: durationMs, easing: EASE_IN_OUT_CUBIC },
      );
      const settle = () => {
        anim.cancel();
        card.endMove(anim);
        card.snapTo(fx, fy);
        oneDone();
      };
      void anim.finished.then(settle, settle);
    }
  }

  /** Draw gesture on cards currently in the pool. Scrolled-away tickets stay canvas. */
  playDraws(hits: readonly DrawHit[]): void {
    if (!this.ready || hits.length === 0) return;
    const layout = getActiveLayout();
    const pending: DrawHit[] = [];
    for (const hit of hits) {
      if (this.byId.has(hit.id)) pending.push(hit);
    }
    if (pending.length === 0) return;
    this.motionHooks.onMotionStart?.();
    let remaining = pending.length;
    const oneDone = () => {
      remaining -= 1;
      if (remaining === 0) this.motionHooks.onMotionEnd?.();
    };
    for (const hit of pending) {
      const idx = this.byId.get(hit.id)!;
      playTicketDraw(
        this.cards[idx]!,
        hit.cell,
        hit.kind,
        layout.cardWidth,
        layout.cardHeight,
        oneDone,
      );
    }
  }

  /** After layout change, root CSS vars already resize cards — only reset badge overlay keys. */
  invalidateCellBadges(): void {
    if (!this.ready) return;
    for (const card of this.cards) card.invalidateCellBadges();
  }

  refreshLayout(): void {
    const w = getActiveLayout().cardWidth;
    for (const card of this.cards) card.applyCardWidth(w, true);
  }

  /** Re-apply svg-all overlay after atlas warm (bind may have skipped earlier). */
  refreshSvgDomOverlays(): void {
    if (!this.ready) return;
    for (const idx of this.byId.values()) prepareCatalogDomCard(this.cards[idx]!);
  }

  setVisible(visible: boolean): void {
    this.host.style.opacity = visible ? '1' : '0';
  }
}
