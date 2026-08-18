import { hasTicketBitmap, setTicketBitmap } from './bitmapCache';
import { yieldToMain } from './captureDomTicket';
import type { DomCaptureStage } from './DomCaptureStage';
import type { Ticket } from './tickets';

export type BakeProgress = {
  done: number;
  total: number;
  /** Ids finished in the last sheet (for canvas refresh). */
  lastIds?: string[];
};

/**
 * Background bake: SnapDOM sheet on main (unavoidable) + worker crop.
 * Yields between sheets so scroll/UI stay responsive.
 */
export async function bakeTicketsInBackground(
  stage: DomCaptureStage,
  tickets: readonly Ticket[],
  onProgress?: (p: BakeProgress) => void
): Promise<void> {
  if (!stage.isReady) {
    throw new Error('bakeTicketsInBackground: capture stage not ready');
  }

  const pending = tickets.filter((t) => !hasTicketBitmap(t.id)).slice().reverse();
  const total = pending.length;
  if (total === 0) {
    onProgress?.({ done: 0, total: 0 });
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let done = 0;

  for (let i = 0; i < pending.length; ) {
    const chunkSize = Math.max(1, stage.sheetCapacity);
    const chunk = pending.slice(i, i + chunkSize);
    try {
      const bitmaps = await stage.captureSheet(chunk, dpr);
      const lastIds: string[] = [];
      for (let j = 0; j < chunk.length; j++) {
        const ticket = chunk[j]!;
        const bitmap = bitmaps[j];
        if (bitmap) {
          setTicketBitmap(ticket.id, bitmap);
          lastIds.push(ticket.id);
        }
      }
      done += chunk.length;
      onProgress?.({ done, total, lastIds });
    } catch (err) {
      console.warn('[bake] sheet failed', err);
      done += chunk.length;
      onProgress?.({ done, total });
    }
    i += chunk.length;
    // Free the main thread between sheets (SnapDOM is the heavy part).
    await yieldToMain();
  }

  onProgress?.({ done: total, total });
}
