import {
  canvasRows,
  planStrips,
  STRIP_MAX_PX,
  STRIP_ROW_MULTIPLE,
  type Strip,
} from "./strips";

export type CanvasLimits = {
  /** Largest single canvas that draws and reads back, in pixels. */
  maxCanvasPx: number;
  /** Pixels of canvas that can be alive at once (a lower bound: the probe stops once the worst plan fits). */
  maxTotalPx: number;
  /** Widest canvas of 16 rows that draws and reads back. */
  maxWidth: number;
};

/**
 * Pixels allowed on top of the strip and scratch canvases while a strip
 * renders: the 256x256 canvases that decode tiles (65 536 px each), about 30
 * of them. The renderer must keep its live decode canvases within this and
 * free each one after it draws.
 */
export const TILE_CANVAS_ALLOWANCE_PX = 2_000_000;

/**
 * Every canvas alive at once while `strip` renders. The renderer allocates
 * the strip canvas (`canvasRows`, with the halo above it), then a same-size
 * scratch canvas terrain composites through, and the tile decode allowance;
 * the scratch canvas is freed before the cropped `renderHeight` canvas the
 * JPEG is encoded from, so the peak is the first two (the crop beside the
 * strip canvas is smaller).
 */
export function peakCanvasPx(mapWidth: number, strip: Strip): number {
  return 2 * mapWidth * canvasRows(strip) + TILE_CANVAS_ALLOWANCE_PX;
}

export type PlanCheck = { ok: true; strips: Strip[] } | { ok: false };

/**
 * Whether this browser can render a map of this size, and the strips to do
 * it in. The caller refuses before fetching a tile when it is not ok.
 */
export function checkPlan(
  mapWidth: number,
  mapHeight: number,
  limits: CanvasLimits,
): PlanCheck {
  if (mapWidth > limits.maxWidth) return { ok: false };
  let strips: Strip[];
  try {
    strips = planStrips(
      mapWidth,
      mapHeight,
      Math.min(STRIP_MAX_PX, limits.maxCanvasPx),
    );
  } catch {
    return { ok: false };
  }
  const worst = Math.max(...strips.map((s) => peakCanvasPx(mapWidth, s)));
  return worst <= limits.maxTotalPx ? { ok: true, strips } : { ok: false };
}

type ProbeContext = {
  fillStyle: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { data: ArrayLike<number> };
};
export type ProbeCanvas = {
  width: number;
  height: number;
  getContext(id: "2d"): ProbeContext | null;
};
export type CanvasFactory = (width: number, height: number) => ProbeCanvas;

const defaultFactory: CanvasFactory = (w, h) =>
  new OffscreenCanvas(w, h) as unknown as ProbeCanvas;

const SINGLE_STEP_PX = 500_000;
const WIDTH_STEP_PX = 256;
const SHAPE_WIDTH = 4096;

/** Opaque, so a blank (transparent) canvas cannot pass for a working one. */
const PIXEL = [10, 20, 30, 255];

/**
 * Allocates a canvas, draws one pixel in its far corner and reads it back.
 * Safari hands back a blank canvas instead of throwing when it is over a
 * limit, so only a correct read-back counts. Returns null (canvas freed) on
 * any failure.
 */
function tryAlloc(
  make: CanvasFactory,
  width: number,
  height: number,
): ProbeCanvas | null {
  let canvas: ProbeCanvas | null = null;
  try {
    canvas = make(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = `rgb(${PIXEL[0]},${PIXEL[1]},${PIXEL[2]})`;
    ctx.fillRect(width - 1, height - 1, 1, 1);
    const got = ctx.getImageData(width - 1, height - 1, 1, 1).data;
    if (PIXEL.every((v, i) => got[i] === v)) return canvas;
  } catch {
    // over a limit: fall through and free
  }
  if (canvas) free(canvas);
  return null;
}

function free(canvas: ProbeCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Largest n in [lo, hi] (steps of `step`) with `works(n)`, assuming monotone; lo is taken as working. */
function searchDown(
  lo: number,
  hi: number,
  step: number,
  works: (n: number) => boolean,
): number {
  while (hi - lo > step) {
    const mid = Math.floor((lo + hi) / 2);
    if (works(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Measures what this browser's OffscreenCanvas can do, in a worker. Bounded
 * to what a GeoPDF needs: single canvases up to `ceilingPx` (default
 * STRIP_MAX_PX), total live pixels up to the peak of the worst plannable
 * strip, widths up to `ceilingPx / 16`. Allocations on a browser with no
 * limits near these: 1 (single) + 3 (total, at 16 MP) + 1 (width) = 5, about
 * 50 ms; a limited one adds about 5 binary-search steps for single and 12
 * for width. Every canvas is freed before returning.
 */
export async function probeCanvasLimits(
  opts: { ceilingPx?: number; makeCanvas?: CanvasFactory } = {},
): Promise<CanvasLimits> {
  const ceiling = opts.ceilingPx ?? STRIP_MAX_PX;
  const make = opts.makeCanvas ?? defaultFactory;
  const probe = (w: number, h: number) => {
    const c = tryAlloc(make, w, h);
    if (c) free(c);
    return c !== null;
  };
  const shaped = (px: number) =>
    probe(SHAPE_WIDTH, Math.ceil(px / SHAPE_WIDTH));

  const maxCanvasPx = shaped(ceiling)
    ? ceiling
    : searchDown(0, ceiling, SINGLE_STEP_PX, shaped);

  // Same shape as the single test; keep them alive until enough fit or one fails.
  const needed = 2 * maxCanvasPx + TILE_CANVAS_ALLOWANCE_PX;
  const live: ProbeCanvas[] = [];
  let maxTotalPx = 0;
  const h = Math.ceil(maxCanvasPx / SHAPE_WIDTH);
  while (maxTotalPx < needed && h > 0) {
    const c = tryAlloc(make, SHAPE_WIDTH, h);
    if (!c) break;
    live.push(c);
    maxTotalPx += SHAPE_WIDTH * h;
  }
  for (const c of live) free(c);

  const widthTop = Math.floor(maxCanvasPx / STRIP_ROW_MULTIPLE);
  const maxWidth =
    widthTop > 0 && probe(widthTop, STRIP_ROW_MULTIPLE)
      ? widthTop
      : searchDown(0, widthTop, WIDTH_STEP_PX, (w) =>
          probe(w, STRIP_ROW_MULTIPLE),
        );

  return { maxCanvasPx, maxTotalPx, maxWidth };
}

// Main thread only: the render worker has no localStorage, so the client
// reads the cache before starting a worker and writes what the worker probed.
const CACHE_KEY = "logjam.geoPdf.canvasLimits.v1";

function isLimits(v: unknown): v is CanvasLimits {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  return ["maxCanvasPx", "maxTotalPx", "maxWidth"].every(
    (k) => typeof l[k] === "number" && Number.isFinite(l[k]) && l[k] >= 0,
  );
}

/** The limits probed on this browser build, or null (other user agent, bad data, no storage). */
export function readCachedLimits(): CanvasLimits | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as { ua?: unknown; limits?: unknown } | null;
    if (v?.ua !== navigator.userAgent || !isLimits(v.limits)) return null;
    return v.limits;
  } catch {
    return null;
  }
}

export function writeCachedLimits(limits: CanvasLimits): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ua: navigator.userAgent, limits }),
    );
  } catch {
    // storage full or blocked: the next render probes again
  }
}
