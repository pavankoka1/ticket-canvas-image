import { prefersReducedMotion } from "./appear";
import { getActiveLayout, rowHeight } from "../layout/catalogLayout";

export const MULTIPLIER_EXIT_REVEAL_FADE_MS = 200;
const MULTIPLIER_EXIT_ROW_STAGGER_MS = 100;
const REMOVED_TICKET_MS = 280;

let drawGestureUntil = 0;

/** Record how long draw shine/sparkle may still run (shuffle should wait). */
export function noteDrawGesture(totalMs: number): void {
  drawGestureUntil = performance.now() + totalMs;
}

/** Ms to wait before post-draw shuffle; 0 if gesture window has passed. */
export function takeGestureDelay(): number {
  return Math.max(0, drawGestureUntil - performance.now());
}

/** Max WAAPI duration for a draw hit (dab win or multiplier). */
export function drawGestureTotalMs(kind: "dab" | "win" | "mult"): number {
  if (kind === "mult") return 900 + 600;
  if (kind === "win") return 600 + 900;
  return 600;
}

export function animateMultiplierExitReveal(
  elements: readonly HTMLElement[],
  durationMs = MULTIPLIER_EXIT_REVEAL_FADE_MS,
  _columns?: number,
  onDone?: () => void,
): void {
  const layout = getActiveLayout();
  if (elements.length === 0) {
    onDone?.();
    return;
  }
  if (prefersReducedMotion()) {
    for (const el of elements) el.style.removeProperty("opacity");
    onDone?.();
    return;
  }
  const rh = rowHeight(layout);
  const byRow = new Map<number, HTMLElement[]>();
  for (const el of elements) {
    const y = parseFloat(el.style.top) || 0;
    const row = Math.round(y / rh);
    const list = byRow.get(row) ?? [];
    list.push(el);
    byRow.set(row, list);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  let pending = elements.length;
  const oneDone = () => {
    pending -= 1;
    if (pending === 0) onDone?.();
  };
  for (const row of rows) {
    const delay = row * MULTIPLIER_EXIT_ROW_STAGGER_MS;
    for (const el of byRow.get(row)!) {
      el.style.opacity = "0";
      const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: durationMs,
        delay,
        fill: "both",
        easing: "cubic-bezier(0.33, 1, 0.68, 1)",
      });
      void anim.finished.then(
        () => {
          anim.cancel();
          el.style.removeProperty("opacity");
          oneDone();
        },
        oneDone,
      );
    }
  }
}

export function animateRemovedTickets(
  elements: readonly HTMLElement[],
  onDone?: () => void,
): void {
  if (elements.length === 0) {
    onDone?.();
    return;
  }
  if (prefersReducedMotion()) {
    onDone?.();
    return;
  }
  let pending = elements.length;
  const oneDone = () => {
    pending -= 1;
    if (pending === 0) onDone?.();
  };
  for (const el of elements) {
    const anim = el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: REMOVED_TICKET_MS,
      easing: "cubic-bezier(0.65, 0, 0.35, 1)",
      fill: "forwards",
    });
    void anim.finished.then(
      () => {
        anim.cancel();
        oneDone();
      },
      oneDone,
    );
  }
}
