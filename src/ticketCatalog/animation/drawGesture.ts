/**
 * Ball-draw gesture — Fortunamania `ticket/playDrawWaapi.ts` on the pooled card.
 *
 * The card sits on `translate`, so the dip animates `scale` (centre origin) and composes
 * with a shuffle that starts before it ends. The badge host is already placed on a device
 * pixel, so its pop uses `scale` instead of the game's `translate(-50%, -50%) scale()`.
 */
import {
  beginDrawDabMotion,
  beginDrawMultiplierMotion,
  refreshSvgOverlayInk,
} from "../../catalog/compareSvgText";
import {
  DAB_APPEAR_MS,
  DAB_START_SCALE,
  EASE_IN_OUT_CUBIC,
  EASE_OUT_CUBIC,
  MULT_DIP_BOTTOM_MS,
  MULT_DIP_END_MS,
  MULT_DIP_START_MS,
  MULT_DISC_START_SCALE,
  MULT_SHINE_MS,
  MULT_SHINE_START_MS,
  MULT_TEXT_LAND_MS,
  MULT_TEXT_PUNCH_MS,
  MULT_TEXT_PUNCH_SCALE,
  MULT_TEXT_SETTLE_MS,
  MULT_TEXT_START_SCALE,
  SHINE_MS,
  SHINE_START_MS,
  SPARKLE_DURATION_MS,
  SPARKLE_PEAK_OFFSET,
  SPARKLE_PEAK_OPACITY,
  SPARKLE_STAGGER_MS,
  TICKET_DIP_BOTTOM_MS,
  TICKET_DIP_END_MS,
  TICKET_DIP_SCALE,
  TICKET_DIP_START_MS,
  drawPlaysShine,
  resolveDrawSettleMs,
  resolveTicketShineStyles,
  type DrawKind,
} from "./drawPhase";
import { prefersReducedMotion } from "./appear";
import { getActiveLayout } from "../layout/catalogLayout";
import type { TicketCard } from "../dom/ticketCardElement";
import { resolveTicketSparklePlan } from "../dom/ticketSparkles";

const SPARKLE_KEYFRAMES: Keyframe[] = [
  { opacity: 0, offset: 0, easing: "linear" },
  { opacity: SPARKLE_PEAK_OPACITY, offset: SPARKLE_PEAK_OFFSET, easing: "linear" },
  { opacity: 0, offset: 1 },
];

/** `playClear` for badge hosts / labels: fill forwards for the run, then drop this effect. */
function play(
  el: HTMLElement,
  keyframes: Keyframe[],
  opts: KeyframeAnimationOptions,
  clearTransform = false,
): Animation {
  const anim = el.animate(keyframes, { ...opts, fill: "forwards" });
  const settle = () => {
    anim.cancel();
    if (el.getAnimations().length > 0) return;
    el.style.removeProperty("opacity");
    el.style.removeProperty("scale");
    if (clearTransform) el.style.removeProperty("transform");
  };
  void anim.finished.then(settle, settle);
  return anim;
}

function playOverlay(
  el: SVGGElement,
  keyframes: Keyframe[],
  opts: KeyframeAnimationOptions,
): Animation {
  const anim = el.animate(keyframes, { ...opts, fill: "forwards" });
  const settle = () => {
    anim.cancel();
    el.style.removeProperty("opacity");
    el.style.removeProperty("transform");
  };
  void anim.finished.then(settle, settle);
  return anim;
}

/**
 * Resolves once every animation of the gesture has ended, cancelled included.
 * A `setTimeout` measured from this task would come due early: WAAPI dates an
 * animation from the next frame, which on a busy phone is well past one frame.
 */
function whenGestureEnds(anims: readonly Animation[]): Promise<void> {
  const ended = anims.map((anim) => anim.finished.then(noop, noop));
  return Promise.all(ended).then(noop);
}

function noop(): void {}

function overlayTranslatePrefix(el: SVGGElement): string {
  const match = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(el.getAttribute("transform") ?? "");
  if (!match) return "";
  return `translate(${match[1]}px, ${match[2]}px) `;
}

function badgePopKeyframes(at: string, startScale: number): Keyframe[] {
  return [
    { transform: `${at}scale(${startScale})`, opacity: 0 },
    { transform: `${at}scale(1)`, opacity: 1, easing: EASE_OUT_CUBIC },
  ];
}

function multTextKeyframes(at: string): Keyframe[] {
  const end = MULT_TEXT_SETTLE_MS;
  return [
    { transform: `${at}scale(${MULT_TEXT_START_SCALE})`, opacity: 0, offset: 0 },
    {
      transform: `${at}scale(${MULT_TEXT_START_SCALE})`,
      opacity: 0,
      offset: DAB_APPEAR_MS / end,
      easing: "linear",
    },
    { transform: `${at}scale(1)`, opacity: 1, offset: MULT_TEXT_LAND_MS / end, easing: EASE_OUT_CUBIC },
    {
      transform: `${at}scale(${MULT_TEXT_PUNCH_SCALE})`,
      opacity: 1,
      offset: MULT_TEXT_PUNCH_MS / end,
      easing: EASE_OUT_CUBIC,
    },
    { transform: `${at}scale(1)`, opacity: 1, offset: 1, easing: EASE_OUT_CUBIC },
  ];
}

/** `buildDipScaleAnimation`: hold, 1 → 0.94 → 1 on the `scale` property. */
function playDip(root: HTMLElement, multiplier: boolean, anims: Animation[]): void {
  const end = multiplier ? MULT_DIP_END_MS : TICKET_DIP_END_MS;
  const start = multiplier ? MULT_DIP_START_MS : TICKET_DIP_START_MS;
  const bottom = multiplier ? MULT_DIP_BOTTOM_MS : TICKET_DIP_BOTTOM_MS;
  const anim = root.animate(
    [
      { scale: "1", offset: 0 },
      { scale: "1", offset: start / end, easing: "linear" },
      { scale: String(TICKET_DIP_SCALE), offset: bottom / end, easing: EASE_OUT_CUBIC },
      { scale: "1", offset: 1, easing: EASE_OUT_CUBIC },
    ],
    { duration: end, easing: "linear", fill: "forwards" },
  );
  const settle = () => anim.cancel();
  void anim.finished.then(settle, settle);
  anims.push(anim);
}

function playMultBadge(card: TicketCard, cell: number, anims: Animation[]): void {
  const root = card.dom;
  refreshSvgOverlayInk(root);
  const { disc, label } = beginDrawMultiplierMotion(root, cell);
  const discOpts = { duration: DAB_APPEAR_MS, easing: "linear" };
  const textOpts = { duration: MULT_TEXT_SETTLE_MS, easing: "linear" };
  if (disc) {
    anims.push(
      playOverlay(disc, badgePopKeyframes(overlayTranslatePrefix(disc), MULT_DISC_START_SCALE), discOpts),
    );
  } else {
    const host = card.badgeHostAt(cell);
    if (host) {
      anims.push(play(host, [
        { scale: String(MULT_DISC_START_SCALE), opacity: 0 },
        { scale: "1", opacity: 1 },
      ], discOpts));
    }
  }
  if (label) {
    anims.push(playOverlay(label, multTextKeyframes(overlayTranslatePrefix(label)), textOpts));
  } else {
    const htmlLabel = card.badgeLabelAt(cell);
    if (htmlLabel) anims.push(play(htmlLabel, multTextKeyframes(""), textOpts, true));
  }
}

function playDabBadge(card: TicketCard, cell: number, anims: Animation[]): void {
  beginDrawDabMotion(card.dom, cell);
  const host = card.badgeHostAt(cell);
  if (!host) return;
  anims.push(
    play(
      host,
      [
        { scale: String(DAB_START_SCALE), opacity: 0 },
        { scale: "1", opacity: 1 },
      ],
      { duration: DAB_APPEAR_MS, easing: EASE_OUT_CUBIC },
    ),
  );
}

/** Shine sweep; on a multiplier also the three staggered sparkle pulses. */
function playShineAndSparkles(
  card: TicketCard,
  isMult: boolean,
  cardWidth: number,
  cardHeight: number,
  anims: Animation[],
): void {
  const band = card.showShine(cardWidth, cardHeight, isMult);
  const anim = band.animate(
    [
      { transform: resolveTicketShineStyles(cardWidth, cardHeight, 0, isMult).transform },
      { transform: resolveTicketShineStyles(cardWidth, cardHeight, 1, isMult).transform },
    ],
    {
      duration: isMult ? MULT_SHINE_MS : SHINE_MS,
      delay: isMult ? MULT_SHINE_START_MS : SHINE_START_MS,
      easing: isMult ? "linear" : EASE_IN_OUT_CUBIC,
      fill: "both",
    },
  );
  void anim.finished.then(
    () => card.hideShine(),
    () => card.hideShine(),
  );
  anims.push(anim);
  if (!isMult) return;
  const sparkles = card.sparkles(resolveTicketSparklePlan(getActiveLayout()));
  sparkles.forEach((sparkle, i) => {
    const spark = sparkle.animate(SPARKLE_KEYFRAMES, {
      duration: SPARKLE_DURATION_MS,
      delay: MULT_SHINE_START_MS + i * SPARKLE_STAGGER_MS,
      easing: "linear",
      fill: "both",
    });
    const settle = () => {
      spark.cancel();
      sparkle.style.opacity = "0";
    };
    void spark.finished.then(settle, settle);
    anims.push(spark);
  });
}

/**
 * One visible ticket. Returns the gesture length (`resolveDrawSettleMs`).
 * Off-screen tickets are canvas and stay on the settled frame.
 */
export function playTicketDraw(
  card: TicketCard,
  cell: number,
  kind: DrawKind,
  cardWidth: number,
  cardHeight: number,
  onSettled?: () => void,
): number {
  const root = card.dom;
  const hasWin = root.classList.contains("ticketCard_win");
  if (prefersReducedMotion()) {
    onSettled?.();
    return 0;
  }
  const isMult = kind === "mult";
  const settleMs = resolveDrawSettleMs(
    kind,
    hasWin,
    resolveTicketSparklePlan(getActiveLayout()).settleMs,
  );

  card.cancelMotion();
  card.hideShine();
  card.clearSparkles();
  const token = card.beginMotion();

  const anims: Animation[] = [];
  playDip(root, isMult, anims);
  if (isMult) playMultBadge(card, cell, anims);
  else playDabBadge(card, cell, anims);
  if (drawPlaysShine(kind, hasWin)) playShineAndSparkles(card, isMult, cardWidth, cardHeight, anims);

  void whenGestureEnds(anims).then(() => {
    if (card.ownsMotion(token)) {
      refreshSvgOverlayInk(root);
      card.clearSparkles();
      card.hideShine();
      card.endMotion(token);
    }
    onSettled?.();
  });
  return settleMs;
}
