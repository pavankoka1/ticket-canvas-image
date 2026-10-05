/// <reference lib="webworker" />
/** PNG-encode compare warm canvases off the main thread. */

type Req = { id: number; image: ImageData };
type Res = { id: number; buffer?: ArrayBuffer; error?: string };

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, image } = e.data;
  try {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const buffer = await blob.arrayBuffer();
    const res: Res = { id, buffer };
    self.postMessage(res, [buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) } satisfies Res);
  }
};
