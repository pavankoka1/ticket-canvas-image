/**
 * Ball-draw gesture from Fortunamania `playTicketDrawWaapi` + `drawPhase`.
 *
 * Plain dab: badge 3→1 (0–250), ticket dip (250–600), gold shine −30° (600–1500) on a new win.
 * Multiplier: disc 2→1 (0–250), text 4→1→0.8→1 (250–650), dip with the text (450–650),
 * shine −45° and three sparkles (900–1500) only when the ticket is gold.
 *
 * The badge host is already placed on a device pixel, so its pop uses the `scale`
 * property. The game's `translate(-50%, -50%)` would slide that host.
 * The card keeps its slot `translate3d` on `style.transform`; the dip animates
 * standalone `scale` on top (do not clear `transform` in dip keyframes — Safari).
 */
import {
  beginDrawDabMotion,
  beginDrawMultiplierMotion,
  refreshSvgOverlayInk,
} from "../../catalog/compareSvgText";
import { SHINE_END_MS, SPARKLE_PEAK_OPACITY } from "./drawPhase";
import type { TicketCard } from "../dom/ticketCardElement";

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

export type DrawKind = "dab" | "win" | "mult";

function reduced(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Opacity-only — do not strip `transform` (sparkles use translate(-50%, -50%)). */
function playSparkleOpacity(el: HTMLElement, keyframes: Keyframe[], opts: KeyframeAnimationOptions): void {
  el.getAnimations().forEach((a) => a.cancel());
  el.style.removeProperty("opacity");
  const anim = el.animate(keyframes, { ...opts, fill: "both" });
  void anim.finished.then(
    () => {
      anim.cancel();
      if (el.getAnimations().length > 0) return;
      el.style.removeProperty("opacity");
    },
    () => undefined,
  );
}

function play(
  el: HTMLElement,
  keyframes: Keyframe[],
  opts: KeyframeAnimationOptions,
  clearTransform = false,
): Animation {
  const anim = el.animate(keyframes, { ...opts, fill: "forwards" });
  void anim.finished.then(
    () => {
      anim.cancel();
      el.style.removeProperty("opacity");
      el.style.removeProperty("scale");
      el.style.removeProperty("translate");
      if (clearTransform) el.style.removeProperty("transform");
    },
    () => undefined,
  );
  return anim;
}

function overlayTranslatePrefix(el: SVGGElement): string {
  const match = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(el.getAttribute("transform") ?? "");
  if (!match) return "";
  return `translate(${match[1]}px, ${match[2]}px) `;
}

function playOverlayPop(el: SVGGElement, isMult: boolean): void {
  const start = isMult ? MULT_DISC_START : DAB_START;
  const at = overlayTranslatePrefix(el);
  const anim = el.animate(
    [
      { transform: `${at}scale(${start})`, opacity: 0 },
      { transform: `${at}scale(1)`, opacity: 1, easing: EASE_OUT },
    ],
    { duration: DAB_MS, easing: isMult ? "linear" : EASE_OUT, fill: "forwards" },
  );
  void anim.finished.then(
    () => {
      anim.cancel();
      el.style.removeProperty("opacity");
      el.style.removeProperty("transform");
    },
    () => undefined,
  );
}

function playOverlayMultLabel(el: SVGGElement): void {
  const end = MULT_TEXT_END;
  const at = overlayTranslatePrefix(el);
  const anim = el.animate(
    [
      { transform: `${at}scale(${MULT_TEXT_START})`, opacity: 0, offset: 0 },
      {
        transform: `${at}scale(${MULT_TEXT_START})`,
        opacity: 0,
        offset: DAB_MS / end,
        easing: "linear",
      },
      { transform: `${at}scale(1)`, opacity: 1, offset: MULT_TEXT_LAND / end, easing: EASE_OUT },
      {
        transform: `${at}scale(${MULT_TEXT_PUNCH_SCALE})`,
        opacity: 1,
        offset: MULT_TEXT_PUNCH / end,
        easing: EASE_OUT,
      },
      { transform: `${at}scale(1)`, opacity: 1, offset: 1, easing: EASE_OUT },
    ],
    { duration: end, easing: "linear", fill: "forwards" },
  );
  void anim.finished.then(
    () => {
      anim.cancel();
      el.style.removeProperty("opacity");
      el.style.removeProperty("transform");
    },
    () => undefined,
  );
}

function dipKeyframes(multiplier: boolean): Keyframe[] {
  const end = multiplier ? MULT_TEXT_END : DIP_END;
  const start = multiplier ? MULT_TEXT_LAND : DIP_START;
  const bottom = multiplier ? MULT_TEXT_PUNCH : DIP_BOTTOM;
  return [
    { scale: "1", offset: 0 },
    { scale: "1", offset: start / end, easing: "linear" },
    { scale: String(DIP_SCALE), offset: bottom / end, easing: EASE_OUT },
    { scale: "1", offset: 1, easing: EASE_OUT },
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
  onSettled?: () => void,
): void {
  if (reduced()) {
    card.clearCellDigit(cell);
    onSettled?.();
    return;
  }
  const root = card.dom;
  const isMult = kind === "mult";
  const hasWin = root.classList.contains("ticketCard_win");
  const playShine = kind === "win" || (isMult && hasWin);

  card.cancelMotion();
  card.hideShine();
  card.clearSparkles();
  const token = card.beginMotion();

  const dip = play(root, dipKeyframes(isMult), {
    duration: isMult ? MULT_TEXT_END : DIP_END,
    easing: "linear",
  });

  const host = card.badgeHostAt(cell);
  if (isMult) {
    refreshSvgOverlayInk(root);
    const { disc, label } = beginDrawMultiplierMotion(root, cell);
    if (disc) playOverlayPop(disc, true);
    else if (host) {
      play(
        host,
        [
          { scale: String(MULT_DISC_START), opacity: 0 },
          { scale: "1", opacity: 1, easing: EASE_OUT },
        ],
        { duration: DAB_MS, easing: "linear" },
      );
    }
    if (label) playOverlayMultLabel(label);
    else {
      const htmlLabel = card.badgeLabelAt(cell);
      if (htmlLabel) {
        const end = MULT_TEXT_END;
        play(
          htmlLabel,
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
  } else {
    beginDrawDabMotion(root, cell);
    if (host) {
      play(
        host,
        [
          { scale: String(DAB_START), opacity: 0 },
          { scale: "1", opacity: 1, easing: EASE_OUT },
        ],
        { duration: DAB_MS, easing: EASE_OUT },
      );
    }
  }

  let gestureEndMs = isMult ? MULT_TEXT_END : DIP_END;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    card.clearCellDigit(cell);
    refreshSvgOverlayInk(root);
    card.clearSparkles();
    card.hideShine();
    card.endMotion(token);
    onSettled?.();
  };

  if (!playShine) {
    void dip.finished.then(settle, settle);
    return;
  }

  const band = card.shineBand(cardWidth, cardHeight, isMult);
  const size = shineSize(cardWidth, cardHeight, isMult);
  band.style.width = `${size.width}px`;
  band.style.height = `${size.height}px`;
  const delay = isMult ? MULT_SHINE_DELAY : SHINE_DELAY;
  const duration = isMult ? MULT_SHINE_MS : SHINE_MS;
  band.animate(
    [
      { transform: shineTransform(cardWidth, cardHeight, 0, isMult) },
      { transform: shineTransform(cardWidth, cardHeight, 1, isMult) },
    ],
    { duration, delay, easing: isMult ? "linear" : EASE_IN_OUT, fill: "both" },
  );

  gestureEndMs = isMult ? delay + duration : SHINE_END_MS;
  if (isMult) {
    const plan = card.layoutMultiplierSparkles(cardWidth, cardHeight);
    gestureEndMs = plan.runEndMs;
    const sparks = card.sparkles();
    for (let i = 0; i < sparks.length; i++) {
      const window = plan.windows[i];
      const el = sparks[i];
      if (!window || !el) continue;
      const pulseDuration = Math.max(1, window.end - window.start);
      playSparkleOpacity(
        el,
        [
          { opacity: 0, offset: 0, easing: "linear" },
          { opacity: SPARKLE_PEAK_OPACITY, offset: 0.5, easing: "linear" },
          { opacity: 0, offset: 1 },
        ],
        { duration: pulseDuration, delay: window.start, easing: "linear" },
      );
    }
  }

  window.setTimeout(settle, gestureEndMs + 50);
}
