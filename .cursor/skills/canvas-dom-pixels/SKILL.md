---
name: canvas-dom-pixels
description: Diagnose canvas-to-DOM misalignment when an overlay, HUD, hit-test, or text is 1px off, blurry, or drifts on zoom, DPR, or resize. Invoke with /canvas-dom-pixels.
---

# Canvas-DOM pixels

Do not edit pixel code until the probe object below is logged.

## Three sizes

Keep these separate. Do not treat one as another.

1. CSS box — `getBoundingClientRect` or the content box. Often fractional.
2. Device pixels — `ResizeObserver` `devicePixelContentBoxSize`. The pixels the element covers on screen.
3. Drawing buffer — `canvas.width` / `canvas.height`, or WebGL `drawingBufferWidth` / `drawingBufferHeight`.

Pixel-perfect means size 2 equals size 3. Place overlays in size 1 (CSS pixels of the same wrapper), snapped with the same rounding that produced size 2.

## Resize

- Observe with `ResizeObserver` and `box: "device-pixel-content-box"`.
- Read `devicePixelContentBoxSize` (inline and block). That is the backing-store size.
- If that box option is missing, fall back to `Math.round(contentBox * dpr)` and record that the fallback is not exact.
- Ban `clientWidth * dpr` as "pixel perfect". `clientWidth` is an integer CSS measure and drops the fractional box.
- Recompute on resize, zoom, and resolution media changes. `devicePixelRatio` is not constant.

## WebGL / Three

- Call `setSize(cssW, cssH, false)`.
- Set the drawing buffer from `devicePixelContentBoxSize`.
- Never let the renderer overwrite CSS size (`style.width` / `style.height`).

## Overlay and hit-test

- Keep the overlay in CSS pixels of the same wrapper as the canvas.
- Do not mix a canvas `getBoundingClientRect` with `pageX` / `pageY` and then scale by dpr.
- Hit-test with `(clientX - rect.left) / rect.width * drawingBufferWidth` (same for Y). Do not assume `rect.width === canvas.width`.
- Do not use `transform: translate(-50%, -50%)` on an overlay that must sit on a device pixel. Use integer CSS px after the shared snap.
- A 1px miss with matching buffers is rounding or transform. Mismatched buffers are the resize path. Edit only that layer.

## Required probe

Log this object for one frame before any code change. Stop if a field is missing.

```js
{
  dpr,
  zoom, // outerWidth / innerWidth
  rect, // { width, height } floats from getBoundingClientRect
  devicePixelContentBox, // { inline, block } or null if unsupported
  canvas, // { width: canvas.width, height: canvas.height }
  drawingBuffer, // { width: drawingBufferWidth, height: drawingBufferHeight }
  overlayRect,
  targetCanvasPoint // { x, y } in drawing-buffer pixels
}
```

Decide from those numbers. Then edit.
