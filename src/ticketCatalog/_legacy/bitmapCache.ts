/**
 * Session bitmap cache — the whole point of this POC.
 * Bake once on add (off main scroll path); scroll only `drawImage`s these.
 */

const bitmaps = new Map<string, ImageBitmap>();

export function getTicketBitmap(id: string): ImageBitmap | undefined {
  return bitmaps.get(id);
}

export function hasTicketBitmap(id: string): boolean {
  return bitmaps.has(id);
}

export function setTicketBitmap(id: string, bitmap: ImageBitmap): void {
  const prev = bitmaps.get(id);
  if (prev && prev !== bitmap) prev.close();
  bitmaps.set(id, bitmap);
}

export function clearTicketBitmaps(): void {
  for (const b of bitmaps.values()) b.close();
  bitmaps.clear();
}

export function bitmapCacheSize(): number {
  return bitmaps.size;
}
