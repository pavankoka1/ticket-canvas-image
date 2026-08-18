import { CARD_HEIGHT, CARD_WIDTH } from './layout';
import { captureSheetToBitmaps } from './captureDomTicket';
import { attachTicketCard, TicketCard } from './ticketCardElement';
import type { Ticket } from './tickets';

/** Packed sheet is always 5 columns (same as the catalog). Rows grow with capacity. */
export const SHEET_COLS = 5;
/** Upper bound for the toolbar — pool grows to the selected size, not this eagerly. */
export const MAX_SHEET_CAPACITY = 100;
export const SHEET_SIZE_OPTIONS = [1, 2, 5, 10, 15, 25, 50, 100] as const;
export const DEFAULT_SHEET_CAPACITY = 25;

/**
 * Offscreen packed sheet: bind many CSS tickets → one SnapDOM → crop bitmaps.
 */
export class DomCaptureStage {
  private readonly host: HTMLElement;
  private sheet: HTMLElement | null = null;
  private cards: TicketCard[] = [];
  private ready = false;
  private chain: Promise<unknown> = Promise.resolve();
  /** Tickets bound into the next SnapDOM call. */
  private capacity = DEFAULT_SHEET_CAPACITY;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  mount(): void {
    if (this.ready) return;

    const s = this.host.style;
    s.position = 'fixed';
    s.left = '-10000px';
    s.top = '0';
    s.width = `${SHEET_COLS * CARD_WIDTH}px`;
    s.height = `${CARD_HEIGHT}px`;
    s.overflow = 'hidden';
    s.pointerEvents = 'none';
    s.opacity = '1';
    s.zIndex = '-1';
    this.host.setAttribute('aria-hidden', 'true');

    const sheet = document.createElement('div');
    sheet.className = 'captureSheet';
    sheet.style.position = 'relative';
    sheet.style.width = `${SHEET_COLS * CARD_WIDTH}px`;
    sheet.style.height = `${CARD_HEIGHT}px`;
    sheet.style.background = 'transparent';

    this.host.appendChild(sheet);
    this.sheet = sheet;
    this.ready = true;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get sheetCapacity(): number {
    return this.capacity;
  }

  /** Takes effect on the next sheet (including mid-bake). */
  setSheetCapacity(n: number): void {
    this.capacity = Math.min(MAX_SHEET_CAPACITY, Math.max(1, Math.round(n)));
  }

  captureSheet(tickets: readonly Ticket[], dpr = window.devicePixelRatio || 1): Promise<ImageBitmap[]> {
    return this.enqueue(async () => {
      if (!this.ready || !this.sheet) throw new Error('DomCaptureStage: not mounted');
      if (tickets.length === 0) return [];

      const n = Math.min(tickets.length, this.capacity);
      this.ensureCards(n);

      // SnapDOM clones the whole sheet subtree — only the tickets in this
      // sheet stay attached. Unused pool cards are detached, not hidden.
      for (let i = 0; i < this.cards.length; i++) {
        const card = this.cards[i]!;
        if (i < n) {
          card.bind(tickets[i]!);
          card.dom.style.transform = 'none';
          card.dom.style.left = `${(i % SHEET_COLS) * CARD_WIDTH}px`;
          card.dom.style.top = `${Math.floor(i / SHEET_COLS) * CARD_HEIGHT}px`;
          if (card.dom.parentNode !== this.sheet) this.sheet.appendChild(card.dom);
        } else if (card.dom.parentNode) {
          card.hide();
          card.dom.remove();
        }
      }

      const rows = Math.ceil(n / SHEET_COLS);
      const cols = Math.min(SHEET_COLS, n);
      this.sheet.style.width = `${cols * CARD_WIDTH}px`;
      this.sheet.style.height = `${rows * CARD_HEIGHT}px`;
      this.host.style.width = this.sheet.style.width;
      this.host.style.height = this.sheet.style.height;
      void this.sheet.offsetWidth;

      const { bitmaps } = await captureSheetToBitmaps(this.sheet, n, cols, dpr);
      return bitmaps;
    });
  }

  private ensureCards(n: number): void {
    while (this.cards.length < n) {
      const i = this.cards.length;
      const card = attachTicketCard(new TicketCard());
      card.dom.style.left = `${(i % SHEET_COLS) * CARD_WIDTH}px`;
      card.dom.style.top = `${Math.floor(i / SHEET_COLS) * CARD_HEIGHT}px`;
      card.dom.style.transform = 'none';
      card.dom.style.filter = 'none';
      card.hide();
      this.cards.push(card);
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
