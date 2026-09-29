/// <reference lib="webworker" />
/**
 * Decode PNG atlas blobs off the main thread. Main thread paints with the
 * returned ImageBitmaps (cells/chrome) or copies to canvas (id digits).
 */

type Req = { id: number; buffers: ArrayBuffer[] };

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, buffers } = e.data;
  const bitmaps: ImageBitmap[] = [];
  try {
    for (const buf of buffers) {
      try {
        bitmaps.push(
          await createImageBitmap(new Blob([buf], { type: "image/png" })),
        );
      } catch {
        try {
          bitmaps.push(
            await createImageBitmap(new Blob([buf], { type: "image/png" }), {
              premultiplyAlpha: "none",
            }),
          );
        } catch {
          self.postMessage({ id, error: "png decode failed" });
          return;
        }
      }
    }
    self.postMessage({ id, bitmaps }, bitmaps);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
