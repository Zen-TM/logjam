import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeoPdfRenderInput } from "./types";
import { runGeoPdfRender, WATCHDOG_MS } from "./client";

const input = {
  config: { elements: {} },
  slopeBands: [],
  areas: [],
  vegetationUrls: [],
  origin: "https://app.example",
} as unknown as GeoPdfRenderInput;

type Fake = {
  terminate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent) => void) | null;
};
let made: Fake[] = [];

function stubWorker(opts: { construct?: Error; post?: Error } = {}) {
  made = [];
  vi.stubGlobal(
    "Worker",
    class {
      terminate = vi.fn();
      postMessage = vi.fn(() => {
        if (opts.post) throw opts.post;
      });
      onmessage: Fake["onmessage"] = null;
      onerror = null;
      onmessageerror = null;
      constructor() {
        if (opts.construct) throw opts.construct;
        made.push(this as unknown as Fake);
      }
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runGeoPdfRender", () => {
  // Mutation: take `new Worker` or `postMessage` out of the try, and the
  // promise rejects (or never settles) instead of resolving "failed".
  it("resolves failed when the worker cannot be made", async () => {
    stubWorker({ construct: new Error("blocked") });
    const signal = new AbortController().signal;
    const remove = vi.spyOn(signal, "removeEventListener");
    await expect(runGeoPdfRender(input, { signal })).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("resolves failed, and ends the worker, when the request will not clone", async () => {
    stubWorker({ post: new DOMException("no", "DataCloneError") });
    const signal = new AbortController().signal;
    const remove = vi.spyOn(signal, "removeEventListener");
    await expect(runGeoPdfRender(input, { signal })).resolves.toMatchObject({
      ok: false,
      reason: "failed",
    });
    expect(made[0]!.terminate).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("resolves cancelled and ends the worker on abort", async () => {
    stubWorker();
    const ctl = new AbortController();
    const result = runGeoPdfRender(input, { signal: ctl.signal });
    ctl.abort();
    await expect(result).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(made[0]!.terminate).toHaveBeenCalled();
  });

  // Mutation: do not re-arm the timer on a message, or never arm it.
  it("gives up on a worker that goes quiet, but not on one that keeps posting", async () => {
    vi.useFakeTimers();
    stubWorker();
    const result = runGeoPdfRender(input, {});
    const progress = {
      data: {
        type: "progress",
        progress: { phase: "drawing", done: 0, total: 1, fraction: 0.1 },
      },
    } as MessageEvent;
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS - 1000);
    made[0]!.onmessage!(progress);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS - 1000);
    // 240 s in, but only 119 s since the last word.
    expect(made[0]!.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toEqual({ ok: false, reason: "failed" });
    expect(made[0]!.terminate).toHaveBeenCalled();
  });
});
