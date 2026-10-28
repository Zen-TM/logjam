// Logjam Web's side of the GeoPDF renderer: starts the worker, relays
// progress, and turns what comes back into a result. The dialog imports this
// only when it opens, so the renderer is its own chunk.
import { readCachedLimits, writeCachedLimits } from "./probe";
import type {
  GeoPdfProgress,
  GeoPdfRenderInput,
  GeoPdfResult,
  RenderDebug,
  RenderPixels,
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
  pixels?: RenderPixels;
};

/**
 * A worker that says nothing for this long is taken to be stuck. A live
 * render posts progress between layers, between strips and with every tile,
 * far more often.
 */
export const WATCHDOG_MS = 120_000;

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

    let worker: Worker | null = null;
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let lastFraction = 0;
    let lastPosted = 0;
    const finish = (result: GeoPdfResult & Partial<RenderExtras>) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      signal?.removeEventListener("abort", onAbort);
      try {
        // The worker holds the canvases and tiles: ending it frees them all.
        worker?.terminate();
      } catch {
        // already gone
      }
      resolve(result);
    };
    const onAbort = () => finish({ ok: false, reason: "cancelled" });
    const failed = () => finish({ ok: false, reason: "failed" });
    signal?.addEventListener("abort", onAbort);

    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        clearTimeout(watchdog);
        watchdog = setTimeout(failed, WATCHDOG_MS);
        const m = e.data;
        if (m.type === "progress") {
          const now = performance.now();
          const p = m.progress;
          // Monotonic, and at most every 100 ms.
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
          failed();
        }
      };
      worker.onerror = failed;
      worker.onmessageerror = failed;
      watchdog = setTimeout(failed, WATCHDOG_MS);
      const request: WorkerRequest = {
        type: "render",
        input,
        limits: readCachedLimits(),
        debug: opts.debug,
      };
      worker.postMessage(request);
    } catch {
      // No worker to start (a policy, memory), or an input that will not
      // clone: a failure to report, not a rejection.
      failed();
    }
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
