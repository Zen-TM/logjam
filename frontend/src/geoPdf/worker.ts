// The render worker's entry: one render per worker. The client terminates it
// to cancel, so nothing here listens for a cancel.
import { renderGeoPdf, TooLarge } from "./render";
import type { WorkerMessage, WorkerRequest } from "./types";

const scope = self as unknown as {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

scope.onmessage = async (e) => {
  if (e.data.type !== "render") return;
  const { input, limits, debug } = e.data;
  try {
    const out = await renderGeoPdf(input, {
      signal: new AbortController().signal,
      limits,
      debug,
      onLimits: (l) => scope.postMessage({ type: "limits", limits: l }),
      onProgress: (progress) =>
        scope.postMessage({ type: "progress", progress }),
    });
    const transfer: Transferable[] = [out.pdf.buffer as ArrayBuffer];
    if (out.pixels) transfer.push(out.pixels.data);
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
