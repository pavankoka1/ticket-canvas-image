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

/**
 * Match-count payout table from the Fortunamania ticket engine.
 * One match does not pay. The displayed amount is this × ball-multiplier
 * sum (or 1) × the ticket price, so the same string is shared.
 */
const MATCH_PAYOUT: Record<number, number> = {
  2: 2,
  3: 5,
  4: 20,
  5: 60,
  6: 250,
};

const TICKET_PRICE = 10;

/** Money on the ticket. 0 until two balls have hit. */
export function ticketPayout(ticket: Ticket): number {
  const base = MATCH_PAYOUT[ticket.hits.length] ?? 0;
  if (!base) return 0;
  let scale = 0;
  for (const value of Object.values(ticket.multipliers)) scale += value;
  return base * (scale || 1) * TICKET_PRICE;
}

export function formatPayout(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Gold face and header amount, or green once the six balls are done and this ticket did not pay. */
export function refreshTicketFace(ticket: Ticket, roundOver: boolean): void {
  const amount = ticketPayout(ticket);
  ticket.win = amount > 0 ? formatPayout(amount) : "";
  ticket.disabled = roundOver && amount <= 0;
}

/**
 * Highest payout first, then more hits, then more multiplier balls,
 * then the previous order. Same priorities as the ticket weight sort.
 */
export function sortTickets(tickets: readonly Ticket[]): Ticket[] {
  return tickets
    .map((ticket, index) => ({ ticket, index }))
    .sort((a, b) => {
      const pay = ticketPayout(b.ticket) - ticketPayout(a.ticket);
      if (pay !== 0) return pay;
      const hits = b.ticket.hits.length - a.ticket.hits.length;
      if (hits !== 0) return hits;
      const mul =
        Object.keys(b.ticket.multipliers).length -
        Object.keys(a.ticket.multipliers).length;
      if (mul !== 0) return mul;
      return a.index - b.index;
    })
    .map((row) => row.ticket);
}

/** Multiplier values offered in the POC UI (also drives the badge atlas). */
export const MULTIPLIER_VALUES = [2, 3, 5, 10] as const;

/** Gold/win state trigger — mirrors ticketViewModel WIN_MATCH_THRESHOLD. */
export const WIN_MATCH_THRESHOLD = 2;

/** matchCount ≥ threshold → gold/win look. */
export function isWinTicket(t: Ticket): boolean {
  return t.hits.length >= WIN_MATCH_THRESHOLD;
}

/** One game deals six balls. A non-zero multiplier makes that ball a multiplier dab. */
export const DRAW_ROUND_COUNT = 6;

/**
 * Rounds 3, 5 and 6 are multiplier draws — at most three, same cap as the game.
 * The value is the badge (2×, 5×, 10×).
 */
export const DRAW_ROUNDS: readonly { multiplier: number }[] = [
  { multiplier: 0 },
  { multiplier: 0 },
  { multiplier: 2 },
  { multiplier: 0 },
  { multiplier: 5 },
  { multiplier: 10 },
];

export type DrawHit = {
  id: string;
  cell: number;
  kind: "dab" | "win" | "mult";
};

/**
 * Remove one ball. Every ticket that still has it on an undabbed cell takes
 * one dab there. A multiplier round stores that value on the cell.
 */
export function applyDrawnBall(
  tickets: readonly Ticket[],
  ball: number,
  multiplier: number,
): DrawHit[] {
  const hits: DrawHit[] = [];
  for (const ticket of tickets) {
    const cell = ticket.balls.indexOf(ball);
    if (cell < 0 || ticket.hits.includes(cell)) continue;
    const wasWin = isWinTicket(ticket);
    ticket.hits.push(cell);
    if (multiplier > 0) ticket.multipliers[cell] = multiplier;
    refreshTicketFace(ticket, false);
    let kind: DrawHit["kind"] = "dab";
    if (multiplier > 0) kind = "mult";
    else if (!wasWin && isWinTicket(ticket)) kind = "win";
    hits.push({ id: ticket.id, cell, kind });
  }
  return hits;
}

/** After the sixth ball, every ticket is gold (it paid) or green (it did not). */
export function finishRound(tickets: readonly Ticket[]): void {
  for (const ticket of tickets) refreshTicketFace(ticket, true);
}

/**
 * Shuffle waits out the draw gesture, same clock as the catalog:
 * dab dip 600, multiplier dip 650, gold shine 1500.
 */
export function shuffleDelayMs(hits: readonly DrawHit[], tickets: readonly Ticket[]): number {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  let delay = 600;
  for (const hit of hits) {
    const ticket = byId.get(hit.id);
    const win = ticket ? isWinTicket(ticket) : false;
    if ((hit.kind === "mult" && win) || hit.kind === "win") return 1500;
    if (hit.kind === "mult") delay = 650;
  }
  return delay;
}

/** Prefer a number that is still open on a visible ticket, so the gesture is on screen. */
export function pickDrawBall(
  tickets: readonly Ticket[],
  drawn: readonly number[],
  preferIds: ReadonlySet<string>,
): number | null {
  const used = new Set(drawn);
  const visible = new Set<number>();
  const all = new Set<number>();
  for (const ticket of tickets) {
    const onTicket = new Set<number>();
    for (let i = 0; i < ticket.balls.length; i++) {
      if (ticket.hits.includes(i)) continue;
      const ball = ticket.balls[i]!;
      if (used.has(ball) || onTicket.has(ball)) continue;
      onTicket.add(ball);
      all.add(ball);
      if (preferIds.has(ticket.id)) visible.add(ball);
    }
  }
  const pool = visible.size > 0 ? [...visible] : [...all];
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
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
      win: "",
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
  const count = tickets.length;
  const fullRow = columns * cardW + Math.max(0, columns - 1) * colGap;
  const rows = Math.ceil(count / columns);
  return tickets.map((t, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const inRow = row === rows - 1 ? count - row * columns : columns;
    const rowWidth = inRow * cardW + Math.max(0, inRow - 1) * colGap;
    // Flex `justify-content: center`: a short row sits in the middle,
    // so the next ticket shifts the ones already in that row to the left.
    const offset = (fullRow - rowWidth) / 2;
    return {
      id: t.id,
      index,
      x: offset + col * (cardW + colGap),
      y: row * (cardH + rowGap),
    };
  });
}
