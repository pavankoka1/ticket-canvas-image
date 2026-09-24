/**
 * Ball-draw gesture from Fortunamania `playTicketDrawWaapi` + `drawPhase`.
 *
 * Plain dab: badge 3→1 (0–250), ticket dip (250–600), gold shine −30° (600–1500) on a new win.
 * Multiplier: disc 2→1 (0–250), text 4→1→0.8→1 (250–650), dip with the text (450–650),
 * shine −45° and three sparkles (900–1500) only when the ticket is gold.
 *
 * The badge host is already placed on a device pixel, so its pop uses the `scale`
 * property. The game's `translate(-50%, -50%)` would slide that host.
 * The card's slot stays in `translate` for the dip; `transform` is `none` while
 * it scales, then the resting `translate3d` comes back.
 */
import type { TicketCard } from "./ticketCardElement";

const EASE_OUT = "cubic-bezier(0.33, 1, 0.68, 1)";
const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

const DAB_MS = 250;
const DAB_START = 3;
const MULT_DISC_START = 2;

const DIP_START = 250;
const DIP_BOTTOM = 400;
const DIP_END = 600;
const DIP_SCALE = 0.94;

const MULT_TEXT_LAND = 450;
const MULT_TEXT_PUNCH = 550;
const MULT_TEXT_END = 650;
const MULT_TEXT_START = 4;
const MULT_TEXT_PUNCH_SCALE = 0.8;

const SHINE_DELAY = 600;
const SHINE_MS = 900;
const MULT_SHINE_DELAY = 900;
const MULT_SHINE_MS = 600;
const SHINE_ANGLE = -30;
const MULT_SHINE_ANGLE = -45;
const SHINE_WIDTH_RATIO = 0.45;

const SPARKLE_MS = 240;
const SPARKLE_LEFT = [28, 55, 85];

export type DrawKind = "dab" | "win" | "mult";

function reduced(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function slotTranslate(el: HTMLElement): string {
  const match = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform);
  if (!match) return "0px 0px";
  return `${match[1]}px ${match[2]}px`;
}

function play(
  el: HTMLElement,
  keyframes: Keyframe[],
  opts: KeyframeAnimationOptions,
  clearTransform = false,
): void {
  const anim = el.animate(keyframes, { ...opts, fill: "forwards" });
  void anim.finished.then(
    () => {
      anim.cancel();
      if (el.getAnimations().length > 0) return;
      el.style.removeProperty("opacity");
      el.style.removeProperty("scale");
      el.style.removeProperty("translate");
      if (clearTransform) el.style.removeProperty("transform");
    },
    () => undefined,
  );
}

function dipKeyframes(at: string, multiplier: boolean): Keyframe[] {
  const end = multiplier ? MULT_TEXT_END : DIP_END;
  const start = multiplier ? MULT_TEXT_LAND : DIP_START;
  const bottom = multiplier ? MULT_TEXT_PUNCH : DIP_BOTTOM;
  const pose = { transform: "none", translate: at };
  return [
    { ...pose, scale: "1", offset: 0 },
    { ...pose, scale: "1", offset: start / end, easing: "linear" },
    { ...pose, scale: String(DIP_SCALE), offset: bottom / end, easing: EASE_OUT },
    { ...pose, scale: "1", offset: 1, easing: EASE_OUT },
  ];
}

function shineTransform(cardWidth: number, cardHeight: number, progress: number, multiplier: boolean): string {
  const deg = multiplier ? MULT_SHINE_ANGLE : SHINE_ANGLE;
  const rad = (deg * Math.PI) / 180;
  const projected = Math.abs(cardWidth * Math.cos(rad)) + Math.abs(cardHeight * Math.sin(rad));
  const bandWidth = Math.hypot(cardWidth, cardHeight) * SHINE_WIDTH_RATIO;
  const travel = projected + bandWidth;
  const centre = -travel / 2 + progress * travel;
  return `translate(-50%, -50%) rotate(${deg}deg) translateX(${centre}px)`;
}

function shineSize(cardWidth: number, cardHeight: number, multiplier: boolean): { width: number; height: number } {
  const deg = multiplier ? MULT_SHINE_ANGLE : SHINE_ANGLE;
  const rad = (deg * Math.PI) / 180;
  const projected = Math.abs(cardWidth * Math.cos(rad)) + Math.abs(cardHeight * Math.sin(rad));
  const diagonal = Math.hypot(cardWidth, cardHeight);
  return {
    width: diagonal * SHINE_WIDTH_RATIO,
    height: Math.max(projected, diagonal) * 2,
  };
}

/** One visible ticket. Off-screen tickets are canvas and stay on the settled frame. */
export function playTicketDraw(
  card: TicketCard,
  cell: number,
  kind: DrawKind,
  cardWidth: number,
  cardHeight: number,
): void {
  if (reduced()) return;
  const root = card.dom;
  const at = slotTranslate(root);
  const isMult = kind === "mult";
  const hasWin = root.classList.contains("ticketCard_win");
  const playShine = kind === "win" || (isMult && hasWin);

  root.getAnimations().forEach((animation) => animation.cancel());
  play(root, dipKeyframes(at, isMult), {
    duration: isMult ? MULT_TEXT_END : DIP_END,
    easing: "linear",
  });

  const host = card.badgeHostAt(cell);
  if (host) {
    host.getAnimations().forEach((animation) => animation.cancel());
    play(
      host,
      isMult
        ? [
            { scale: String(MULT_DISC_START), opacity: 0 },
            { scale: "1", opacity: 1, easing: EASE_OUT },
          ]
        : [
            { scale: String(DAB_START), opacity: 0 },
            { scale: "1", opacity: 1, easing: EASE_OUT },
          ],
      { duration: DAB_MS, easing: isMult ? "linear" : EASE_OUT },
    );
  }

  if (isMult) {
    const label = card.badgeLabelAt(cell);
    if (label) {
      label.getAnimations().forEach((animation) => animation.cancel());
      const end = MULT_TEXT_END;
      play(
        label,
        [
          { transform: `scale(${MULT_TEXT_START})`, opacity: 0, offset: 0 },
          {
            transform: `scale(${MULT_TEXT_START})`,
            opacity: 0,
            offset: DAB_MS / end,
            easing: "linear",
          },
          { transform: "scale(1)", opacity: 1, offset: MULT_TEXT_LAND / end, easing: EASE_OUT },
          {
            transform: `scale(${MULT_TEXT_PUNCH_SCALE})`,
            opacity: 1,
            offset: MULT_TEXT_PUNCH / end,
            easing: EASE_OUT,
          },
          { transform: "scale(1)", opacity: 1, offset: 1, easing: EASE_OUT },
        ],
        { duration: end, easing: "linear" },
        true,
      );
    }
  }

  if (!playShine) return;
  const band = card.shineBand(cardWidth, cardHeight, isMult);
  const size = shineSize(cardWidth, cardHeight, isMult);
  band.style.width = `${size.width}px`;
  band.style.height = `${size.height}px`;
  const delay = isMult ? MULT_SHINE_DELAY : SHINE_DELAY;
  const duration = isMult ? MULT_SHINE_MS : SHINE_MS;
  band.getAnimations().forEach((animation) => animation.cancel());
  const shine = band.animate(
    [
      { transform: shineTransform(cardWidth, cardHeight, 0, isMult) },
      { transform: shineTransform(cardWidth, cardHeight, 1, isMult) },
    ],
    { duration, delay, easing: isMult ? "linear" : EASE_IN_OUT, fill: "both" },
  );
  void shine.finished.then(
    () => card.hideShine(),
    () => card.hideShine(),
  );

  if (!isMult) return;
  const sparks = card.sparkles();
  sparks.forEach((spark, index) => {
    const left = SPARKLE_LEFT[index] ?? 50;
    spark.style.left = `${left}%`;
    spark.getAnimations().forEach((animation) => animation.cancel());
    // Peaks stagger across the 600ms multiplier shine (drawPhase sparkle windows).
    const progress = [0.28, 0.55, 0.85][index] ?? 0.5;
    const peakAt = delay + progress * duration;
    const start = peakAt - SPARKLE_MS / 2;
    play(
      spark,
      [
        { opacity: 0, offset: 0, easing: "linear" },
        { opacity: 0.8, offset: 0.5, easing: "linear" },
        { opacity: 0, offset: 1 },
      ],
      { duration: SPARKLE_MS, delay: Math.max(0, start), easing: "linear" },
    );
  });
}
