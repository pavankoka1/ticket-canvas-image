/**
 * Add gesture from Fortunamania `catalogAnimations.animateNewTickets` and
 * `buildAppearKeyframes`. Adds smaller than 25 play it on the last 12 cards,
 * then the catalog smooth-scrolls to the bottom. 25 or more only scroll.
 *
 * Cards here are absolutely positioned, so each keyframe carries the slot
 * translate. The `transform` property stays `none` for the gesture: a scale
 * on top of `translate3d` orbits the card instead of shrinking in place.
 */
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

/** Fortunamania `buildAppearKeyframes`, plus `transform: none` so slot translate is the only offset. */
function buildAppearKeyframes(scales: AppearScales, x: number, y: number): Keyframe[] {
  const fadeAt = APPEAR_FADE_MS / APPEAR_MS;
  const at = `${x}px ${y}px`;
  return [
    {
      transform: "none",
      translate: at,
      scale: String(resolveAppearScaleAt(0, scales)),
      opacity: 0,
      offset: 0,
    },
    {
      transform: "none",
      translate: at,
      scale: String(resolveAppearScaleAt(Math.min(1, fadeAt), scales)),
      opacity: 1,
      offset: fadeAt,
      easing: EASE_OUT_CUBIC,
    },
    {
      transform: "none",
      translate: at,
      scale: String(resolveAppearScaleAt(APPEAR_OVERSHOOT_AT, scales)),
      opacity: 1,
      offset: APPEAR_OVERSHOOT_AT,
      easing: EASE_OUT_CUBIC,
    },
    {
      transform: "none",
      translate: at,
      scale: "1",
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
  el: HTMLElement,
  x: number,
  y: number,
  cardWidth: number,
  gap: number,
  numberFontSize: number,
): void {
  if (prefersReducedMotion()) return;
  const cellWidth = cardWidth > 0 ? cardWidth / TICKET_CELL_COUNT : 0;
  const font = numberFontSize > 0 ? numberFontSize : 18;
  const scales = resolveAppearScales(cardWidth, gap, cellWidth, font);
  if (!Number.isFinite(scales.start) || !Number.isFinite(scales.overshoot)) return;

  el.getAnimations().forEach((animation) => animation.cancel());
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
      el.style.removeProperty("translate");
      el.style.removeProperty("scale");
    },
    () => undefined,
  );
}
