/**
 * Gold compare fixture (shared by /compare).
 */

import type { Ticket } from "./tickets";

/** Gold ticket: win amount, dab, 10× multiplier — full chrome exercise. */
export const GOLDEN_SCAN_TICKET: Ticket = {
  id: "golden-scan",
  no: "4821",
  balls: [12, 24, 36, 48, 51, 60],
  hits: [0, 2, 4],
  multipliers: { 2: 10 },
  win: "$9,876.54",
};
