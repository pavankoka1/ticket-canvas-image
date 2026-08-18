export type Ticket = {
  id: string;
  no: string;
  balls: number[];
  /** Cell indices that are hit (for dab look). */
  hits: number[];
};

let seq = 0;

export function createTickets(count: number): Ticket[] {
  const out: Ticket[] = [];
  for (let i = 0; i < count; i++) {
    seq += 1;
    const balls = Array.from({ length: 6 }, () => 1 + Math.floor(Math.random() * 60));
    out.push({
      id: `t-${seq}`,
      no: String(seq).padStart(4, '0'),
      balls,
      hits: [],
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

export function buildSlots(tickets: readonly Ticket[], columns: number, cardW: number, cardH: number, colGap: number, rowGap: number): TicketSlot[] {
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
