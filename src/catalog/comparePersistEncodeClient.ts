/**
 * PNG encode for compare atlas IDB persist (main thread — reliable on Safari/WebKit).
 */

export async function encodeCompareCanvasPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
