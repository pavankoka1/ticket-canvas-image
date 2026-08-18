import { CARD_HEIGHT, CARD_WIDTH } from './layout';
import { captureSheetToBitmaps } from './captureDomTicket';
import { attachTicketCard, TicketCard } from './ticketCardElement';
import type { Ticket } from './tickets';

/** Tickets per SnapDOM call. Smaller sheets = shorter main-thread spikes. */
export const SHEET_COLS = 5;
export const SHEET_ROWS = 5;
export const SHEET_CAPACITY = SHEET_COLS * SHEET_ROWS; // 25

/**
 * Offscreen packed sheet: bind many CSS tickets → one SnapDOM → crop bitmaps.
 */
export class DomCaptureStage {
  private readonly host: HTMLElement;
  private sheet: HTMLElement | null = null;
  private cards: TicketCard[] = [];
  private ready = false;
  private chain: Promise<unknown> = Promise.resolve();

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
    s.height = `${SHEET_ROWS * CARD_HEIGHT}px`;
    s.overflow = 'hidden';
    s.pointerEvents = 'none';
    s.opacity = '1';
    s.zIndex = '-1';
    this.host.setAttribute('aria-hidden', 'true');

    const sheet = document.createElement('div');
    sheet.className = 'captureSheet';
    sheet.style.position = 'relative';
    sheet.style.width = `${SHEET_COLS * CARD_WIDTH}px`;
    sheet.style.height = `${SHEET_ROWS * CARD_HEIGHT}px`;
    sheet.style.background = 'transparent';

    for (let i = 0; i < SHEET_CAPACITY; i++) {
      const card = attachTicketCard(new TicketCard());
      const col = i % SHEET_COLS;
      const row = Math.floor(i / SHEET_COLS);
      card.dom.style.left = `${col * CARD_WIDTH}px`;
      card.dom.style.top = `${row * CARD_HEIGHT}px`;
      card.dom.style.transform = 'none';
      card.dom.style.filter = 'none';
      card.hide();
      sheet.appendChild(card.dom);
      this.cards.push(card);
    }

    this.host.appendChild(sheet);
    this.sheet = sheet;
    this.ready = true;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get sheetCapacity(): number {
    return SHEET_CAPACITY;
  }

  captureSheet(tickets: readonly Ticket[], dpr = window.devicePixelRatio || 1): Promise<ImageBitmap[]> {
    return this.enqueue(async () => {
      if (!this.ready || !this.sheet) throw new Error('DomCaptureStage: not mounted');
      if (tickets.length === 0) return [];

      const n = Math.min(tickets.length, SHEET_CAPACITY);
      for (let i = 0; i < SHEET_CAPACITY; i++) {
        const card = this.cards[i]!;
        if (i < n) {
          card.bind(tickets[i]!);
          card.dom.style.transform = 'none';
          card.dom.style.left = `${(i % SHEET_COLS) * CARD_WIDTH}px`;
          card.dom.style.top = `${Math.floor(i / SHEET_COLS) * CARD_HEIGHT}px`;
        } else {
          card.hide();
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

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
