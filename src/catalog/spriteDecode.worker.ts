/// <reference lib="webworker" />
/**
 * Decode PNG atlas blobs off the main thread. Main thread paints with the
 * returned ImageBitmaps (cells/chrome) or copies to canvas (id digits).
 */

type Req = { id: number; buffers: ArrayBuffer[] };

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, buffers } = e.data;
  try {
    const bitmaps = await Promise.all(
      buffers.map((buf) =>
        createImageBitmap(new Blob([buf], { type: "image/png" })),
      ),
    );
    self.postMessage({ id, bitmaps }, bitmaps);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
