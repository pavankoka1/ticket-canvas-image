const MIN_THUMB_CSS = 38;

export type CatalogScrollbarRefs = {
  host: HTMLElement;
  scroll: HTMLElement;
  lane: HTMLElement;
  thumb: HTMLElement;
};

/** Lane + thumb outside the ticket band; hidden when content does not overflow. */
export function syncCatalogScrollbar(refs: CatalogScrollbarRefs): void {
  const { host, scroll, lane, thumb } = refs;
  const canScroll = scroll.scrollHeight > scroll.clientHeight + 1;
  host.classList.toggle("ticketCatalogHost_isScrollable", canScroll);
  if (!canScroll) {
    thumb.style.removeProperty("height");
    thumb.style.removeProperty("transform");
    return;
  }

  const laneH = lane.clientHeight;
  const ratio = scroll.clientHeight / scroll.scrollHeight;
  const thumbH = Math.max(MIN_THUMB_CSS, Math.round(laneH * ratio));
  const maxTop = Math.max(0, laneH - thumbH);
  const scrollRange = scroll.scrollHeight - scroll.clientHeight;
  const top = scrollRange <= 0 ? 0 : (scroll.scrollTop / scrollRange) * maxTop;
  thumb.style.height = `${thumbH}px`;
  thumb.style.transform = `translateY(${top}px)`;
}

export function bindCatalogScrollbarDrag(
  refs: CatalogScrollbarRefs,
  onScroll: () => void,
): () => void {
  const { scroll, lane, thumb } = refs;
  let drag: { startY: number; startScroll: number; thumbH: number; maxTop: number } | null =
    null;

  const onThumbDown = (e: PointerEvent) => {
    if (scroll.scrollHeight <= scroll.clientHeight + 1) return;
    const laneH = lane.clientHeight;
    const ratio = scroll.clientHeight / scroll.scrollHeight;
    const thumbH = Math.max(MIN_THUMB_CSS, Math.round(laneH * ratio));
    const maxTop = Math.max(0, laneH - thumbH);
    drag = { startY: e.clientY, startScroll: scroll.scrollTop, thumbH, maxTop };
    thumb.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onThumbMove = (e: PointerEvent) => {
    if (!drag) return;
    const scrollRange = scroll.scrollHeight - scroll.clientHeight;
    if (scrollRange <= 0 || drag.maxTop <= 0) return;
    const deltaY = e.clientY - drag.startY;
    const scrollDelta = (deltaY / drag.maxTop) * scrollRange;
    scroll.scrollTop = drag.startScroll + scrollDelta;
    onScroll();
  };

  const onThumbUp = (e: PointerEvent) => {
    if (!drag) return;
    drag = null;
    thumb.releasePointerCapture(e.pointerId);
  };

  const onLaneDown = (e: PointerEvent) => {
    if (e.target !== lane) return;
    if (scroll.scrollHeight <= scroll.clientHeight + 1) return;
    const laneRect = lane.getBoundingClientRect();
    const laneH = lane.clientHeight;
    const ratio = scroll.clientHeight / scroll.scrollHeight;
    const thumbH = Math.max(MIN_THUMB_CSS, Math.round(laneH * ratio));
    const maxTop = Math.max(0, laneH - thumbH);
    const clickY = e.clientY - laneRect.top - thumbH / 2;
    const top = Math.min(maxTop, Math.max(0, clickY));
    const scrollRange = scroll.scrollHeight - scroll.clientHeight;
    scroll.scrollTop = maxTop <= 0 ? 0 : (top / maxTop) * scrollRange;
    onScroll();
  };

  thumb.addEventListener("pointerdown", onThumbDown);
  thumb.addEventListener("pointermove", onThumbMove);
  thumb.addEventListener("pointerup", onThumbUp);
  thumb.addEventListener("pointercancel", onThumbUp);
  lane.addEventListener("pointerdown", onLaneDown);

  return () => {
    thumb.removeEventListener("pointerdown", onThumbDown);
    thumb.removeEventListener("pointermove", onThumbMove);
    thumb.removeEventListener("pointerup", onThumbUp);
    thumb.removeEventListener("pointercancel", onThumbUp);
    lane.removeEventListener("pointerdown", onLaneDown);
  };
}
