/**
 * Add gesture from Fortunamania `catalogAnimations.animateNewTickets` and
 * `buildAppearKeyframes`. Adds smaller than 25 play it on the last 12 cards,
 * then the catalog smooth-scrolls to the bottom. 25 or more only scroll.
 *
 * Cards are absolutely positioned; each keyframe uses `translate3d` + `scale`
 * in one `transform` (standalone `translate` does not composite on Safari).
 */
import type { TicketCard } from "../dom/ticketCardElement";

export const APPEAR_MS = 310;
export const APPEAR_MAX_TICKETS = 25;
export const TICKET_ANIMATED_COUNT = 12;

const APPEAR_OVERSHOOT_AT = 140 / APPEAR_MS;
const APPEAR_FADE_MS = 80;
const APPEAR_OVERSHOOT_GAP_PX = 12;
const DIGIT_ADVANCE_EM = 0.55;
const TICKET_CELL_COUNT = 6;
const EASE_OUT_CUBIC = "cubic-bezier(0.33, 1, 0.68, 1)";
const EASE_IN_OUT_CUBIC = "cubic-bezier(0.65, 0, 0.35, 1)";

type AppearScales = { start: number; overshoot: number };

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Fortunamania `resolveAppearScales`. Cell width falls back to cardWidth / 6. */
export function resolveAppearScales(
  cardWidth: number,
  columnGap: number,
  cellWidth: number,
  numberFontSize: number,
): AppearScales {
  const pitch = cardWidth + columnGap;
  const firstNumberRightEdge = cellWidth / 2 + DIGIT_ADVANCE_EM * numberFontSize;
  const centreToNumber = firstNumberRightEdge - cardWidth / 2;
  return {
    start: pitch / (cardWidth / 2 - centreToNumber),
    overshoot: (pitch - APPEAR_OVERSHOOT_GAP_PX) / cardWidth,
  };
}

function resolveAppearScaleAt(progress: number, scales: AppearScales): number {
  if (progress >= 1) return 1;
  if (progress <= APPEAR_OVERSHOOT_AT) {
    return lerp(scales.start, scales.overshoot, easeOutCubic(progress / APPEAR_OVERSHOOT_AT));
  }
  const settle = (progress - APPEAR_OVERSHOOT_AT) / (1 - APPEAR_OVERSHOOT_AT);
  return lerp(scales.overshoot, 1, easeOutCubic(settle));
}

function appearTransform(x: number, y: number, scale: number): string {
  return `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
}

/** Fortunamania `buildAppearKeyframes` — slot offset in `transform` (Safari ignores standalone `translate`). */
function buildAppearKeyframes(scales: AppearScales, x: number, y: number): Keyframe[] {
  const fadeAt = APPEAR_FADE_MS / APPEAR_MS;
  return [
    {
      transform: appearTransform(x, y, resolveAppearScaleAt(0, scales)),
      opacity: 0,
      offset: 0,
    },
    {
      transform: appearTransform(x, y, resolveAppearScaleAt(Math.min(1, fadeAt), scales)),
      opacity: 1,
      offset: fadeAt,
      easing: EASE_OUT_CUBIC,
    },
    {
      transform: appearTransform(x, y, resolveAppearScaleAt(APPEAR_OVERSHOOT_AT, scales)),
      opacity: 1,
      offset: APPEAR_OVERSHOOT_AT,
      easing: EASE_OUT_CUBIC,
    },
    {
      transform: appearTransform(x, y, 1),
      opacity: 1,
      offset: 1,
      easing: EASE_IN_OUT_CUBIC,
    },
  ];
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** One card of `animateNewTickets`. `x`/`y` are the snapped slot, in CSS pixels. */
export function playTicketAppear(
  card: TicketCard,
  x: number,
  y: number,
  cardWidth: number,
  gap: number,
  numberFontSize: number,
  onSettled?: () => void,
): void {
  if (prefersReducedMotion()) {
    onSettled?.();
    return;
  }
  const cellWidth = cardWidth > 0 ? cardWidth / TICKET_CELL_COUNT : 0;
  const font = numberFontSize > 0 ? numberFontSize : 18;
  const scales = resolveAppearScales(cardWidth, gap, cellWidth, font);
  if (!Number.isFinite(scales.start) || !Number.isFinite(scales.overshoot)) {
    onSettled?.();
    return;
  }

  const el = card.dom;
  // Cancel prior motion without an unconditional getAnimations flush.
  card.cancelMotion();
  const token = card.beginMotion();
  el.classList.add("ticketCard_appear");
  el.style.zIndex = "3";
  const anim = el.animate(buildAppearKeyframes(scales, x, y), {
    duration: APPEAR_MS,
    easing: "linear",
    fill: "forwards",
  });
  void anim.finished.then(
    () => {
      el.classList.remove("ticketCard_appear");
      anim.cancel();
      el.style.removeProperty("z-index");
      el.style.removeProperty("opacity");
      el.style.removeProperty("transform");
      card.endMotion(token);
      onSettled?.();
    },
    () => {
      card.endMotion(token);
      onSettled?.();
    },
  );
}
