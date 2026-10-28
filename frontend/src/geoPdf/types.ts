// What the dialog hands the renderer, what it gets back, and the messages
// between the client (main thread) and the worker.
import type { GeoPdfConfig, SharpenedOverlay, SlopeBand } from "@logjam/shared";
import type { CanvasLimits } from "./probe";

export type GeoPdfRenderInput = {
  config: GeoPdfConfig;
  slopeBands: readonly SlopeBand[];
  /** The sharpened areas the signed-in user may read. */
  areas: readonly SharpenedOverlay[];
  /** Presigned vegetation archives of the user's own jobs overlapping the extent, oldest first. */
  vegetationUrls: readonly string[];
  /** For the statewide archives, which are same-origin. */
  origin: string;
};

export type GeoPdfProgress = {
  phase: "preparing" | "drawing" | "finishing";
  done: number;
  total: number;
  fraction: number;
};

export type GeoPdfResult =
  | { ok: true; pdf: Blob; fileName: string }
  | { ok: false; reason: "too-large" | "failed" | "cancelled" };

/** Test hooks. The dialog never sets these; the bench page and e2e do. */
export type RenderDebug = {
  /** Plan strips of at most this many pixels, to get several of a small map. */
  maxStripPx?: number;
  /** Check the plan against these limits instead of probing. */
  limits?: CanvasLimits;
  /** Behave as if the strip's pixel check read back wrong. */
  failPixelCheck?: boolean;
  /** Return the map's pixels as drawn, before JPEG. */
  collectPixels?: boolean;
};

/** Wall-clock milliseconds a render spent, by phase. */
export type RenderTimings = {
  totalMs: number;
  prepareMs: number;
  /** Time spent waiting for tiles with nothing to draw. */
  fetchWaitMs: number;
  drawMs: number;
  encodeMs: number;
  pdfMs: number;
  /** From the first request to the last answer, per layer. */
  fetchSpanMs: Record<string, number>;
  requests: Record<string, number>;
  /** Drawing split by what drew. */
  drawBreakdownMs: Record<string, number>;
  strips: number;
  mapPx: [number, number];
};

/** The map as drawn before JPEG, strip by strip, overlap rows included. */
export type RenderPixels = {
  width: number;
  height: number;
  strips: { y: number; rows: number; owned: number; data: ArrayBuffer }[];
};

export type WorkerRequest = {
  type: "render";
  input: GeoPdfRenderInput;
  /** Cached limits, or null to probe. */
  limits: CanvasLimits | null;
  debug?: RenderDebug;
};

export type WorkerMessage =
  | { type: "progress"; progress: GeoPdfProgress }
  | { type: "limits"; limits: CanvasLimits }
  | {
      type: "done";
      pdf: Uint8Array<ArrayBuffer>;
      timings: RenderTimings;
      pixels?: RenderPixels;
    }
  | { type: "refused" }
  | { type: "failed" };
