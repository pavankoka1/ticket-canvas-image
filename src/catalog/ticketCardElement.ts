import {
  activeDpr,
  applyBadgeChrome,
  badgeHostDevice,
  getLiveCellBoxModel,
  resolveCellBoxModel,
  setLiveCellBoxModel,
  snapCss,
} from "./cellBoxModel";
import { getActiveLayout } from "./catalogLayout";
import { BALLS_PER_TICKET } from "./layout";
import { MultiplierLabelNode } from "./multiplierLabel";
import { isWinTicket, type Ticket } from "./tickets";

export type TicketDomParts = {
  root: HTMLElement;
  idText: Text;
  winText: Text;
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
  const winText = document.createTextNode("");
  winEl.appendChild(winText);

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
  return { root, idText, winText, cellEls, cellTexts };
}

/** Per-cell dab/multiplier badge, built lazily like fortunamania. */
type CellBadge = {
  host: HTMLElement;
  label: MultiplierLabelNode | null;
};

function ticketContentKey(ticket: Ticket): string {
  const mult = Object.keys(ticket.multipliers)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => `${k}:${ticket.multipliers[Number(k)]}`)
    .join(",");
  return `${ticket.no}\0${ticket.win}\0${ticket.disabled ? 1 : 0}\0${ticket.hits.join(",")}\0${ticket.balls.join(",")}\0${mult}`;
}

/**
 * Fortunamania-aligned pooled ticket.
 * DOM + CSS identical to atlas snapshot source, including dab/multiplier/win.
 */
export class TicketCard {
  readonly dom: HTMLElement;
  private readonly idText: Text;
  private readonly winText: Text;
  private readonly cellTexts: Text[] = [];
  private readonly cellEls: HTMLElement[] = [];
  private readonly badges: (CellBadge | null)[] = [];
  private layoutKey: string | null = null;
  private winClass = false;
  private disabledClass = false;
  private shineHost: HTMLElement | null = null;
  private shineBandEl: HTMLElement | null = null;
  private sparkleEls: HTMLElement[] | null = null;
  /**
   * Non-zero while appear / draw / FLIP WAAPI is running. hide() and
   * cancelMotion() only call getAnimations when this is set — the scroll
   * eviction path must not force a document-wide style flush for static cards.
   */
  private motionGen = 0;
  private boundId: string | null = null;
  private contentKey = "";
  private slotX = Number.NaN;
  private slotY = Number.NaN;
  private shown = false;
  /** Per-cell `${hit}:${mult}:${layoutKey}` — skip badge style writes when unchanged. */
  private readonly cellBadgeKey: string[] = Array.from(
    { length: BALLS_PER_TICKET },
    () => "",
  );

  constructor() {
    const parts = createTicketDom();
    parts.root.style.position = "absolute";
    parts.root.style.pointerEvents = "none";
    parts.root.style.visibility = "hidden";

    this.dom = parts.root;
    this.idText = parts.idText;
    this.winText = parts.winText;
    this.cellEls = parts.cellEls;
    this.cellTexts = parts.cellTexts;
    this.badges = parts.cellEls.map(() => null);

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
    // Layout change invalidates badge geometry keys so the next bind re-places.
    this.cellBadgeKey.fill("");
  }

  private ensureBadge(i: number): CellBadge {
    let badge = this.badges[i];
    if (badge) return badge;
    const host = document.createElement("span");
    host.className = "ticketCard__badgeHost";
    this.cellEls[i]!.appendChild(host);
    badge = { host, label: null };
    this.badges[i] = badge;
    return badge;
  }

  /** Device-pixel host box shared with canvas disc blit. */
  private placeBadge(i: number, host: HTMLElement, isMult: boolean): void {
    const layout = getActiveLayout();
    const model = getLiveCellBoxModel() ?? resolveCellBoxModel(layout);
    const cell = model.cells[i];
    if (!cell) return;
    const dpr = activeDpr();
    const box = badgeHostDevice(cell, layout.metrics.dabSize, dpr);
    host.style.left = `${box.leftCss}px`;
    host.style.top = `${box.topCss}px`;
    host.style.width = `${box.sizeCss}px`;
    host.style.height = `${box.sizeCss}px`;
    host.style.transform = "none";
    host.style.margin = "0";
    applyBadgeChrome(host, box, isMult, dpr);
  }

  private applyCellBadge(i: number, hit: boolean, multiplier: number): void {
    const key = `${hit ? 1 : 0}:${multiplier}:${this.layoutKey ?? ""}`;
    if (this.cellBadgeKey[i] === key) return;
    this.cellBadgeKey[i] = key;

    const existing = this.badges[i];
    if (!hit) {
      if (existing) existing.host.style.display = "none";
      this.cellEls[i]!.classList.remove("ticketCard__cell_hit");
      return;
    }
    this.cellEls[i]!.classList.add("ticketCard__cell_hit");
    const badge = this.ensureBadge(i);
    badge.host.style.display = "flex";
    const isMult = multiplier > 0;
    badge.host.classList.toggle("ticketCard__badgeHost_multiplier", isMult);
    badge.host.classList.toggle("ticketCard__badgeHost_dab", !isMult);
    this.placeBadge(i, badge.host, isMult);
    if (isMult) {
      if (!badge.label) {
        badge.label = new MultiplierLabelNode();
        badge.host.appendChild(badge.label.dom);
      }
      badge.label.update(multiplier);
      badge.label.dom.style.display = "flex";
    } else if (badge.label) {
      badge.label.dom.style.display = "none";
    }
  }

  /**
   * True when this pool card already shows `ticket` at the snapped slot.
   * DomPool skips bind for unchanged band members.
   */
  shows(ticket: Ticket, x: number, y: number): boolean {
    if (!this.shown || this.boundId !== ticket.id) return false;
    if (this.contentKey !== ticketContentKey(ticket)) return false;
    const { x: sx, y: sy } = snapSlot(x, y);
    return sx === this.slotX && sy === this.slotY;
  }

  bind(ticket: Ticket, x?: number, y?: number): void {
    this.applyCardWidth(getActiveLayout().cardWidth);
    this.boundId = ticket.id;
    this.contentKey = ticketContentKey(ticket);

    if (this.idText.data !== ticket.no) this.idText.data = ticket.no;
    // Win amount shows only in the win state (mirrors canvas paintHeaderText).
    const winStr = isWinTicket(ticket) ? ticket.win : "";
    if (this.winText.data !== winStr) this.winText.data = winStr;

    for (let i = 0; i < BALLS_PER_TICKET; i++) {
      const hit = ticket.hits.includes(i);
      const mult = ticket.multipliers[i] ?? 0;
      const ball = String(ticket.balls[i] ?? "");
      // Multiplier clears immediately. Plain dab keeps the digit until draw
      // settle() clears it after the pop animation (sticky once cleared).
      let next = ball;
      if (mult > 0) next = "";
      else if (hit && this.cellTexts[i]!.data === "") next = "";
      if (this.cellTexts[i]!.data !== next) this.cellTexts[i]!.data = next;
      this.applyCellBadge(i, hit, mult);
    }

    const win = isWinTicket(ticket);
    if (win !== this.winClass) {
      this.winClass = win;
      this.dom.classList.toggle("ticketCard_win", win);
    }
    const disabled = Boolean(ticket.disabled);
    if (disabled !== this.disabledClass) {
      this.disabledClass = disabled;
      this.dom.classList.toggle("ticketCard_disabled", disabled);
    }

    if (x !== undefined && y !== undefined) {
      const { x: sx, y: sy } = snapSlot(x, y);
      if (sx !== this.slotX || sy !== this.slotY) {
        this.slotX = sx;
        this.slotY = sy;
        this.dom.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
      }
    }
    if (!this.shown) {
      this.shown = true;
      this.dom.style.visibility = "visible";
    }
  }

  badgeHostAt(cell: number): HTMLElement | null {
    return this.badges[cell]?.host ?? null;
  }

  badgeLabelAt(cell: number): HTMLElement | null {
    return this.badges[cell]?.label?.dom ?? null;
  }

  /** Hide the ball digit after dab / multiplier draw motion finishes. */
  clearCellDigit(cell: number): void {
    const text = this.cellTexts[cell];
    if (text && text.data !== "") text.data = "";
  }

  /**
   * Mark that WAAPI is about to run on this card. Pass the returned token to
   * endMotion when that gesture finishes (or is superseded by a newer begin).
   */
  beginMotion(): number {
    this.motionGen += 1;
    return this.motionGen;
  }

  endMotion(token: number): void {
    if (token === this.motionGen) this.motionGen = 0;
  }

  /**
   * Cancel running WAAPI only if this card was marked as animating.
   * No-op for the common scroll-eviction case (static card leaving the band).
   */
  cancelMotion(): void {
    if (this.motionGen === 0) return;
    this.dom.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    this.motionGen = 0;
  }

  /** Shine band, parked off the card until the draw gesture starts it. */
  shineBand(cardWidth: number, cardHeight: number, multiplier: boolean): HTMLElement {
    if (!this.shineHost || !this.shineBandEl) {
      const host = document.createElement("span");
      host.className = "ticketCard__shine";
      const band = document.createElement("span");
      band.className = "ticketCard__shineBand";
      host.appendChild(band);
      this.dom.appendChild(host);
      this.shineHost = host;
      this.shineBandEl = band;
    }
    const deg = multiplier ? -45 : -30;
    const rad = (deg * Math.PI) / 180;
    const projected = Math.abs(cardWidth * Math.cos(rad)) + Math.abs(cardHeight * Math.sin(rad));
    const travel = projected + Math.hypot(cardWidth, cardHeight) * 0.45;
    this.shineBandEl.style.transform = `translate(-50%, -50%) rotate(${deg}deg) translateX(${-travel / 2}px)`;
    this.shineHost.style.display = "block";
    return this.shineBandEl;
  }

  /** Park the shine layer. Does not call getAnimations — cancel via cancelMotion. */
  hideShine(): void {
    if (!this.shineHost || !this.shineBandEl) return;
    this.shineHost.style.display = "none";
    this.shineBandEl.style.removeProperty("transform");
  }

  sparkles(): HTMLElement[] {
    if (this.sparkleEls) return this.sparkleEls;
    const container = document.createElement("span");
    container.className = "ticketCard__sparkles";
    const imgs: HTMLElement[] = [];
    for (const left of [28, 55, 85]) {
      const img = document.createElement("img");
      img.className = "ticketCard__sparkle";
      img.src = "/sparkle.webp";
      img.alt = "";
      img.draggable = false;
      img.style.left = `${left}%`;
      img.style.opacity = "0";
      container.appendChild(img);
      imgs.push(img);
    }
    this.dom.appendChild(container);
    this.sparkleEls = imgs;
    return imgs;
  }

  hide(): void {
    this.cancelMotion();
    this.hideShine();
    this.dom.classList.remove("ticketCard_appear");
    this.dom.style.visibility = "hidden";
    this.dom.style.removeProperty("z-index");
    this.dom.style.removeProperty("opacity");
    this.dom.style.removeProperty("translate");
    this.dom.style.removeProperty("scale");
    this.boundId = null;
    this.contentKey = "";
    this.slotX = Number.NaN;
    this.slotY = Number.NaN;
    this.shown = false;
    this.cellBadgeKey.fill("");
  }
}

/** Device-snapped slot origin. Same rounding the resting `translate3d` uses. */
export function snapSlot(x: number, y: number): { x: number; y: number } {
  const dpr = activeDpr();
  return { x: snapCss(x, dpr), y: snapCss(y, dpr) };
}

let slotDriftLogged = false;

/**
 * One-shot fractional-DPR probe: compare snapped slot origin vs compositor paint.
 * Log `[SLOTDRIFT]` on a Windows 150% machine before declaring placement fixed.
 */
export function probeSlotPlacementDrift(
  card: HTMLElement,
  scrollHost: HTMLElement,
  slotX: number,
  slotY: number,
): void {
  if (slotDriftLogged) return;
  const dpr = window.devicePixelRatio || 1;
  if (Math.abs(dpr - Math.round(dpr)) < 0.01) return;
  slotDriftLogged = true;
  const hostR = scrollHost.getBoundingClientRect();
  const cardR = card.getBoundingClientRect();
  const measuredX = cardR.left - hostR.left + scrollHost.scrollLeft;
  const measuredY = cardR.top - hostR.top + scrollHost.scrollTop;
  const { x: snappedX, y: snappedY } = snapSlot(slotX, slotY);
  console.log("[SLOTDRIFT]", {
    dpr,
    rawX: slotX,
    rawY: slotY,
    snappedX,
    snappedY,
    measuredX,
    measuredY,
    deltaXDev: (measuredX - snappedX) * dpr,
    deltaYDev: (measuredY - snappedY) * dpr,
  });
}

export function attachTicketCard(card: TicketCard): TicketCard {
  (card.dom as HTMLElement & { __ticketCard?: TicketCard }).__ticketCard = card;
  return card;
}
