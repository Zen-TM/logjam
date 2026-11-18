// The render worker's entry: one render per worker. The client terminates it
// to cancel, so nothing here listens for a cancel.
//
// A worker has its own global scope, so the simulated-regions switch the page
// set is not here: this import sets it again, before `@logjam/shared` loads,
// for the region a sheet's terrain is read from. Guards: workerSimRegions.test.ts,
// workerGrid.test.ts.
// The display units are in the same case: each request carries the page's, and
// the scale bar is written in them. Guard: worker.test.ts ("the render worker's
// display units").
import "../simRegions";
import { setDisplayUnits } from "@logjam/shared";
import { tileCache } from "./cache";
import { renderGeoPdf, TooLarge } from "./render";
import type { WorkerMessage, WorkerRequest } from "./types";

const scope = self as unknown as {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

scope.onmessage = async (e) => {
  if (e.data.type !== "render") return;
  const { input, limits, units, debug } = e.data;
  setDisplayUnits(units);
  try {
    const out = await renderGeoPdf(input, {
      signal: new AbortController().signal,
      limits,
      debug,
      cache: tileCache(),
      onLimits: (l) => scope.postMessage({ type: "limits", limits: l }),
      onProgress: (progress) =>
        scope.postMessage({ type: "progress", progress }),
    });
    const transfer: Transferable[] = [out.pdf.buffer as ArrayBuffer];
    if (out.pixels) for (const s of out.pixels.strips) transfer.push(s.data);
    scope.postMessage(
      {
        type: "done",
        pdf: out.pdf as Uint8Array<ArrayBuffer>,
        timings: out.timings,
        pixels: out.pixels,
      },
      transfer,
    );
  } catch (err) {
    // The kind only: an error's text can carry a URL.
    scope.postMessage(
      err instanceof TooLarge ? { type: "refused" } : { type: "failed" },
    );
  }
};
