export type Ticket = {
  id: string;
  /** Ticket number shown in the header — plain 1-based index, NO zero-pad. */
  no: string;
  balls: number[];
  /** Cell indices that are dabbed (matched). Includes multiplier cells. */
  hits: number[];
  /** Cell index → multiplier value (>0). A multiplier cell is also a hit. */
  multipliers: Record<number, number>;
  /**
   * Pre-formatted win amount shown top-left in the header (POC: random). Only
   * rendered when the ticket is in a win state (`isWinTicket`).
   */
  win: string;
  /** Disabled / locked ticket — teal body; uses disabled multiplier sprites. */
  disabled?: boolean;
};

/** POC win amount — currency is part of the string ($, €, £, …). */
const WIN_CURRENCIES = ["$", "€", "£"] as const;

function randomWinAmount(): string {
  const cents = 25 + Math.floor(Math.random() * 500000); // 0.25 … ~5000
  const value = cents / 100;
  const amount = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const cur = WIN_CURRENCIES[Math.floor(Math.random() * WIN_CURRENCIES.length)]!;
  return `${cur}${amount}`;
}

/** Multiplier values offered in the POC UI (also drives the badge atlas). */
export const MULTIPLIER_VALUES = [2, 3, 5, 10] as const;

/** Gold/win state trigger — mirrors ticketViewModel WIN_MATCH_THRESHOLD. */
export const WIN_MATCH_THRESHOLD = 2;

/** matchCount ≥ threshold → gold/win look. */
export function isWinTicket(t: Ticket): boolean {
  return t.hits.length >= WIN_MATCH_THRESHOLD;
}

let seq = 0;

export function createTickets(count: number): Ticket[] {
  const out: Ticket[] = [];
  for (let i = 0; i < count; i++) {
    seq += 1;
    const balls = Array.from(
      { length: 6 },
      () => 1 + Math.floor(Math.random() * 60),
    );
    out.push({
      id: `t-${seq}`,
      no: String(seq), // no zero-padding — matches fortunamania
      balls,
      hits: [],
      multipliers: {},
      win: randomWinAmount(),
    });
  }
  return out;
}

export type TicketSlot = {
  id: string;
  index: number;
  x: number;
  y: number;
};

export function buildSlots(
  tickets: readonly Ticket[],
  columns: number,
  cardW: number,
  cardH: number,
  colGap: number,
  rowGap: number,
): TicketSlot[] {
  return tickets.map((t, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: t.id,
      index,
      x: col * (cardW + colGap),
      y: row * (cardH + rowGap),
    };
  });
}
