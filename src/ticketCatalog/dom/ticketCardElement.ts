import {
  activeDpr,
  applyBadgeChrome,
  applyCellBoxCssVars,
  badgeHostDevice,
  getLiveCellBoxModel,
  resolveCellBoxModel,
  setLiveCellBoxModel,
  type CellBoxModel,
} from "../layout/cellBoxModel";
import { getActiveLayout, type CatalogLayout } from "../layout/catalogLayout";
import { snapLayoutOrigin } from "../layout/catalogOriginSnap";
import { resolveLiveCellBoxModel } from "../canvas/atlas/cellAtlas";
import type { TicketMetrics } from "../model/ticketPresets";
import { BALLS_PER_TICKET, POOL_OFFSCREEN_PX } from "../constants";
import { MultiplierLabelNode } from "../canvas/sprites/multiplierLabel";
import { showsGoldFace, isWinTicket, type Ticket } from "../model/tickets";
import { resolveTicketShineStyles } from "../animation/drawPhase";
import type { TicketSparklePlan } from "./ticketSparkles";

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

/** Fixed cell boxes — same as fix/restore-catalog-alignment (required for SVG raster match). */
export function applyTicketCellLayout(
  root: HTMLElement,
  cellEls: HTMLElement[],
  model: CellBoxModel,
  metrics: TicketMetrics,
  cardHeight: number,
): void {
  root.style.width = `${model.cardWidth}px`;
  root.style.height = `${cardHeight}px`;
  applyCellBoxCssVars(root, model, metrics);
  let prevRight = 0;
  cellEls.forEach((cell, i) => {
    const box = model.cells[i]!;
    cell.style.boxSizing = "border-box";
    cell.style.width = `${model.cellW}px`;
    cell.style.height = `${model.cellH}px`;
    cell.style.flex = `0 0 ${model.cellW}px`;
    // Cell lefts are device-snapped per index, so each gap is set explicitly.
    cell.style.marginLeft = `${box.x - prevRight}px`;
    prevRight = box.x + model.cellW;
  });
}

/** Per-cell dab/multiplier badge, built lazily like fortunamania. */
type CellBadge = {
  host: HTMLElement;
  label: MultiplierLabelNode | null;
};

/**
 * Cards sit at left/top 0 and are placed with the CSS `translate` property, like the
 * game's FLIP. The draw dip runs on `scale` and composes with a running shuffle.
 */
export function poolOffscreenTranslate(): string {
  return `-${POOL_OFFSCREEN_PX}px -${POOL_OFFSCREEN_PX}px`;
}

export function ticketContentKey(ticket: Ticket): string {
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
   * Non-zero while a draw gesture (dip, badge, shine, sparkles) runs. hide() and
   * cancelMotion() only call getAnimations when this is set — the scroll
   * eviction path must not force a document-wide style flush for static cards.
   */
  private motionGen = 0;
  /** Shuffle FLIP or appear on the root `translate`; replaced, never stacked. */
  private moveAnim: Animation | null = null;
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
    parts.root.style.translate = poolOffscreenTranslate();

    this.dom = parts.root;
    this.idText = parts.idText;
    this.winText = parts.winText;
    this.cellEls = parts.cellEls;
    this.cellTexts = parts.cellTexts;
    this.badges = parts.cellEls.map(() => null);

    this.applyCardWidth(getActiveLayout().cardWidth);
  }

  /** Layout CSS vars on the catalog root handle sizing; only badge overlay keys need a reset. */
  invalidateCellBadges(): void {
    this.cellBadgeKey.fill("");
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
    applyTicketCellLayout(
      this.dom,
      this.cellEls,
      model,
      layout.metrics,
      layout.cardHeight,
    );
    this.cellBadgeKey.fill("");
  }

  /** Explicit catalog layout (capture host / tests). */
  applyCardLayout(layout: CatalogLayout, force = false): void {
    const cardWidth = layout.cardWidth;
    if (cardWidth <= 0) return;
    const dpr = activeDpr();
    const model = resolveLiveCellBoxModel(layout, dpr);
    const key = `${layout.metrics.id}|${cardWidth}|${layout.cardHeight}|${model.cellW}x${model.cellH}`;
    if (!force && this.layoutKey === key) return;
    this.layoutKey = key;
    applyTicketCellLayout(
      this.dom,
      this.cellEls,
      model,
      layout.metrics,
      layout.cardHeight,
    );
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
    if (!this.shown || !this.showsInk(ticket)) return false;
    const { x: sx, y: sy } = snapSlot(x, y);
    return sx === this.slotX && sy === this.slotY;
  }

  /** Ticket + layout ink match (ignores slot position). */
  showsInk(ticket: Ticket): boolean {
    if (this.boundId !== ticket.id) return false;
    if (this.contentKey !== ticketContentKey(ticket)) return false;
    const layout = getActiveLayout();
    const model = getLiveCellBoxModel();
    if (!model) return false;
    const key = `${layout.metrics.id}|${layout.cardWidth}|${layout.cardHeight}|${model.cellW}x${model.cellH}`;
    return this.layoutKey === key;
  }

  /**
   * Atlas warm only: force chrome/overlay face on the DOM and sync internal
   * class flags so a later `bind` does not resurrect `ticketCard_win` on
   * disabled badge captures (multi-hit warm tickets).
   */
  applyForcedFace(face: "normal" | "gold" | "disabled"): void {
    const win = face === "gold";
    const disabled = face === "disabled";
    this.winClass = win;
    this.disabledClass = disabled;
    this.dom.classList.remove("ticketCard_win", "ticketCard_disabled");
    if (win) this.dom.classList.add("ticketCard_win");
    if (disabled) this.dom.classList.add("ticketCard_disabled");
  }

  /** Rest pose at the snapped slot (set inline after a move; do not rely on WAAPI fill). */
  snapTo(x: number, y: number): void {
    const { x: sx, y: sy } = snapSlot(x, y);
    this.slotX = sx;
    this.slotY = sy;
    this.dom.style.translate = `${sx}px ${sy}px`;
    this.shown = true;
  }

  /**
   * Start a FLIP / appear on the root. Only the previous move is cancelled — a draw
   * dip (`scale`), badge pop or shine keeps running, as in the game.
   */
  startMove(keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation {
    this.moveAnim?.cancel();
    const anim = this.dom.animate(keyframes, options);
    this.moveAnim = anim;
    return anim;
  }

  cancelMove(): void {
    this.moveAnim?.cancel();
    this.moveAnim = null;
  }

  /** Clear the move slot once `anim` settles (no-op if a newer move replaced it). */
  endMove(anim: Animation): void {
    if (this.moveAnim === anim) this.moveAnim = null;
  }

  bind(
    ticket: Ticket,
    x?: number,
    y?: number,
    layout?: CatalogLayout,
    opts?: { deferPosition?: boolean },
  ): void {
    if (layout) this.applyCardLayout(layout);
    else this.applyCardWidth(getActiveLayout().cardWidth);
    this.boundId = ticket.id;
    this.contentKey = ticketContentKey(ticket);

    if (this.idText.data !== ticket.no) this.idText.data = ticket.no;
    // Win amount shows only in the win state (mirrors canvas paintHeaderText).
    const winStr = isWinTicket(ticket) ? ticket.win : "";
    if (this.winText.data !== winStr) this.winText.data = winStr;

    for (let i = 0; i < BALLS_PER_TICKET; i++) {
      // The digit stays under a dab / multiplier; the opaque disc covers it once it lands.
      const ball = String(ticket.balls[i] ?? "");
      if (this.cellTexts[i]!.data !== ball) this.cellTexts[i]!.data = ball;
      this.applyCellBadge(i, ticket.hits.includes(i), ticket.multipliers[i] ?? 0);
    }

    const disabled = Boolean(ticket.disabled);
    const win = showsGoldFace(ticket);
    if (win !== this.winClass) {
      this.winClass = win;
      this.dom.classList.toggle("ticketCard_win", win);
    }
    if (disabled !== this.disabledClass) {
      this.disabledClass = disabled;
      this.dom.classList.toggle("ticketCard_disabled", disabled);
    }

    if (x !== undefined && y !== undefined && !opts?.deferPosition) {
      this.snapTo(x, y);
    }
    this.shown = true;
  }

  badgeHostAt(cell: number): HTMLElement | null {
    return this.badges[cell]?.host ?? null;
  }

  badgeLabelAt(cell: number): HTMLElement | null {
    return this.badges[cell]?.label?.dom ?? null;
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

  /** Badge atlas warm: capture discs without the digits underneath. */
  clearCellDigits(): void {
    for (const text of this.cellTexts) text.data = "";
  }

  /** False once the gesture was cancelled or superseded. */
  ownsMotion(token: number): boolean {
    return token !== 0 && token === this.motionGen;
  }

  /**
   * Cancel running WAAPI only if this card was marked as animating.
   * No-op for the common scroll-eviction case (static card leaving the band).
   */
  cancelMotion(): void {
    this.moveAnim?.cancel();
    this.moveAnim = null;
    if (this.motionGen === 0) return;
    this.dom.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    this.motionGen = 0;
  }

  /** Size the shine band and park it off the card before the host is shown. */
  showShine(cardWidth: number, cardHeight: number, multiplier: boolean): HTMLElement {
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
    const shine = resolveTicketShineStyles(cardWidth, cardHeight, 0, multiplier);
    this.shineBandEl.style.width = `${shine.bandWidth}px`;
    this.shineBandEl.style.height = `${shine.bandHeight}px`;
    this.shineBandEl.style.transform = shine.transform;
    this.shineHost.style.display = "block";
    return this.shineBandEl;
  }

  /** Park the shine layer. Does not call getAnimations — cancel via cancelMotion. */
  hideShine(): void {
    if (!this.shineHost || !this.shineBandEl) return;
    this.shineHost.style.display = "none";
    this.shineBandEl.style.removeProperty("width");
    this.shineBandEl.style.removeProperty("height");
    this.shineBandEl.style.removeProperty("transform");
  }

  /** Three sparkle imgs at the plan's anchors (`layoutMultiplierSparkles`). */
  sparkles(plan: TicketSparklePlan): HTMLElement[] {
    if (!this.sparkleEls) {
      const container = document.createElement("span");
      container.className = "ticketCard__sparkles";
      this.sparkleEls = plan.spots.map(() => {
        const img = document.createElement("img");
        img.className = "ticketCard__sparkle";
        img.src = "/sparkle.webp";
        img.alt = "";
        img.decoding = "async";
        img.draggable = false;
        img.style.opacity = "0";
        container.appendChild(img);
        return img;
      });
      this.dom.appendChild(container);
    }
    plan.spots.forEach((spot, i) => {
      const img = this.sparkleEls![i]!;
      img.style.left = `${spot.x}px`;
      img.style.top = `${spot.y}px`;
    });
    return this.sparkleEls;
  }

  clearSparkles(): void {
    if (!this.sparkleEls) return;
    for (const img of this.sparkleEls) img.style.opacity = "0";
  }

  hide(): void {
    this.cancelMotion();
    this.hideShine();
    this.dom.classList.remove("ticketCard_appear");
    this.dom.style.translate = poolOffscreenTranslate();
    this.dom.style.removeProperty("z-index");
    this.dom.style.removeProperty("opacity");
    this.dom.style.removeProperty("scale");
    this.boundId = null;
    this.contentKey = "";
    this.slotX = Number.NaN;
    this.slotY = Number.NaN;
    this.shown = false;
    this.cellBadgeKey.fill("");
  }
}

/** Snapped slot origin. Same rounding the resting `translate` uses. */
export function snapSlot(x: number, y: number): { x: number; y: number } {
  return { x: snapLayoutOrigin(x), y: snapLayoutOrigin(y) };
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
