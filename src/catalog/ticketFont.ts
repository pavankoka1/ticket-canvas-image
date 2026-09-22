/**
 * Ticket face is self-hosted Onest 700 (aliased as MB-Onest). SnapDOM embedFonts
 * reads the same-origin /fonts/onest-700.woff2 — no Google Fonts CORS.
 * Always await this before measuring advances or capturing sprites.
 */
export async function ensureTicketFont(sizePx: number): Promise<{
  face: string;
  mbOnest700: boolean;
  onest700: boolean;
}> {
  try {
    await Promise.all([
      document.fonts.load(`700 ${sizePx}px "MB-Onest"`),
      document.fonts.load(`700 ${sizePx}px Onest`),
    ]);
    await document.fonts.ready;
  } catch {
    // fonts API unavailable — callers key on whatever resolved
  }
  const mbOnest700 = !!document.fonts?.check?.(`700 ${sizePx}px "MB-Onest"`);
  const onest700 = !!document.fonts?.check?.(`700 ${sizePx}px Onest`);
  const face = mbOnest700 ? "MB-Onest" : onest700 ? "Onest" : "fallback-system";
  return { face, mbOnest700, onest700 };
}
