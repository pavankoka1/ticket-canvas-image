/** Dev-only warm breakdown — filter console on `[catalog-warm-profile]`. */

let rasterMs = 0;
let rasterCalls = 0;
let persistEncodeMs = 0;
let persistEncodes = 0;
let idbPrefetchMs = 0;

export function resetWarmCompareProfile(): void {
  rasterMs = 0;
  rasterCalls = 0;
  persistEncodeMs = 0;
  persistEncodes = 0;
  idbPrefetchMs = 0;
}

export function addWarmRasterMs(ms: number): void {
  rasterCalls += 1;
  rasterMs += ms;
}

export function addWarmPersistEncodeMs(ms: number): void {
  persistEncodes += 1;
  persistEncodeMs += ms;
}

export function setWarmIdbPrefetchMs(ms: number): void {
  idbPrefetchMs = ms;
}

export function warmCompareProfileSnapshot(): {
  rasterMs: number;
  rasterCalls: number;
  persistEncodeMs: number;
  persistEncodes: number;
  idbPrefetchMs: number;
} {
  return {
    rasterMs: Math.round(rasterMs),
    rasterCalls,
    persistEncodeMs: Math.round(persistEncodeMs),
    persistEncodes,
    idbPrefetchMs: Math.round(idbPrefetchMs),
  };
}

export function logWarmCompareProfile(scope: string, extra: Record<string, unknown> = {}): void {
  console.info("[catalog-warm-profile]", scope, {
    ...warmCompareProfileSnapshot(),
    ...extra,
  });
}

export async function timeWarmRaster<T>(fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    addWarmRasterMs(performance.now() - t0);
  }
}
