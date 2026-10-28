// Logjam Web's side of the GeoPDF renderer: starts the worker, relays
// progress, and turns what comes back into a result. The dialog imports this
// only when it opens, so the renderer is its own chunk.
import { readCachedLimits, writeCachedLimits } from "./probe";
import type {
  GeoPdfProgress,
  GeoPdfRenderInput,
  GeoPdfResult,
  RenderDebug,
  RenderTimings,
  WorkerMessage,
  WorkerRequest,
} from "./types";

export type {
  GeoPdfProgress,
  GeoPdfRenderInput,
  GeoPdfResult,
} from "./types";

const PROGRESS_EVERY_MS = 100;

/** `Title` → `Title.pdf`, with the characters the server's names allowed. */
export function geoPdfFileName(title: string | undefined): string {
  const safe =
    (title ?? "")
      .replace(/[^a-zA-Z0-9 _-]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "logjam-geopdf";
  return `${safe}.pdf`;
}

export type RenderExtras = {
  timings: RenderTimings;
  pixels?: { width: number; height: number; data: ArrayBuffer };
};

/** `renderGeoPdf` with the test hooks and what only the bench wants back. */
export function runGeoPdfRender(
  input: GeoPdfRenderInput,
  opts: {
    onProgress?: (p: GeoPdfProgress) => void;
    signal?: AbortSignal;
    debug?: RenderDebug;
  },
): Promise<GeoPdfResult & Partial<RenderExtras>> {
  return new Promise((resolve) => {
    const { signal } = opts;
    if (signal?.aborted) return resolve({ ok: false, reason: "cancelled" });

    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    let settled = false;
    let lastFraction = 0;
    let lastPosted = 0;
    const finish = (result: GeoPdfResult & Partial<RenderExtras>) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      // The worker holds the canvases and tiles: ending it frees them all.
      worker.terminate();
      resolve(result);
    };
    const onAbort = () => finish({ ok: false, reason: "cancelled" });
    signal?.addEventListener("abort", onAbort);

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === "progress") {
        const now = performance.now();
        const p = m.progress;
        // Monotonic, and at most every 100 ms except the phase's last word.
        const fraction = Math.max(lastFraction, p.fraction);
        if (now - lastPosted >= PROGRESS_EVERY_MS || fraction === 1) {
          lastPosted = now;
          lastFraction = fraction;
          opts.onProgress?.({ ...p, fraction });
        }
      } else if (m.type === "limits") {
        writeCachedLimits(m.limits);
      } else if (m.type === "done") {
        finish({
          ok: true,
          pdf: new Blob([m.pdf], { type: "application/pdf" }),
          fileName: geoPdfFileName(input.config.elements.title),
          timings: m.timings,
          pixels: m.pixels,
        });
      } else if (m.type === "refused") {
        finish({ ok: false, reason: "too-large" });
      } else {
        finish({ ok: false, reason: "failed" });
      }
    };
    worker.onerror = () => finish({ ok: false, reason: "failed" });
    worker.onmessageerror = () => finish({ ok: false, reason: "failed" });

    const request: WorkerRequest = {
      type: "render",
      input,
      limits: readCachedLimits(),
      debug: opts.debug,
    };
    worker.postMessage(request);
  });
}

export function renderGeoPdf(
  input: GeoPdfRenderInput,
  opts: {
    onProgress?: (p: GeoPdfProgress) => void;
    signal?: AbortSignal;
  },
): Promise<GeoPdfResult> {
  return runGeoPdfRender(input, opts);
}
