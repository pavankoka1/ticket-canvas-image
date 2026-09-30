/** On-device evidence for DOM/SVG differences; never changes paint geometry. */
import { useState } from 'react';
import { activeDpr } from './cellBoxModel';

async function deviceBox(canvas: HTMLCanvasElement) {
  return new Promise<{ inline: number; block: number } | null>(resolve => {
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.devicePixelContentBoxSize?.[0];
      finish(box ? { inline: box.inlineSize, block: box.blockSize } : null);
    });
    const timer = window.setTimeout(() => finish(null), 250);
    function finish(value: { inline: number; block: number } | null) {
      window.clearTimeout(timer);
      observer.disconnect();
      resolve(value);
    }
    try { observer.observe(canvas, { box: 'device-pixel-content-box' }); }
    catch { observer.observe(canvas); }
  });
}

function rect(element: Element) {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

export function CompareDiagnostics() {
  const [report, setReport] = useState('Open after both rows finish rendering.');
  async function collect() {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const rows = await Promise.all([...document.querySelectorAll<HTMLElement>('[data-renderer]')].map(async section => {
      const canvas = section.querySelector<HTMLCanvasElement>('canvas')!;
      const card = section.querySelector<HTMLElement>('.ticketCard')!;
      const typography = [...card.querySelectorAll<HTMLElement>('.ticketCard__id,.ticketCard__win,.ticketCard__multiplier,.ticketCard__cell')].map(element => {
        const style = getComputedStyle(element);
        return { class: element.className, text: element.textContent, rect: rect(element), font: style.font,
          lineHeight: style.lineHeight, textSizeAdjust: style.getPropertyValue('-webkit-text-size-adjust') };
      });
      return { renderer: section.dataset.renderer, ticket: section.dataset.ticket,
        dpr: window.devicePixelRatio, activeDpr: activeDpr(), zoom: window.outerWidth / window.innerWidth,
        rect: rect(canvas), devicePixelContentBox: await deviceBox(canvas),
        canvas: { width: canvas.width, height: canvas.height },
        drawingBuffer: { width: canvas.width, height: canvas.height },
        overlayRect: rect(card), targetCanvasPoint: { x: 0, y: 0 }, typography };
    }));
    const result = { revision: 'compare-text-size-fixed-v12', userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight, scale: window.visualViewport?.scale },
      fontStatus: document.fonts.status, fontLoaded: document.fonts.check('700 18px "MB-Onest"'), rows };
    console.info('Compare pixel probe', result);
    setReport(JSON.stringify(result, null, 2));
  }
  return <details className="compare__diagnostics" onToggle={event => { if (event.currentTarget.open) void collect(); }}>
    <summary>Rendering diagnostics · text-size fix v12</summary>
    <pre>{report}</pre>
  </details>;
}
