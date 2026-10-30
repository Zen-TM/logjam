import { RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTerrainBand, type TerrainBand } from "./terrainJobs";
import { helperCount, TerrainPool } from "./terrainPool";

afterEach(() => vi.unstubAllGlobals());

const band = (): TerrainBand => {
  const width = 8;
  const values = new Float32Array(width * 8);
  for (let i = 0; i < values.length; i++) values[i] = i % 7;
  return {
    kind: "slope",
    values,
    width,
    gridRow0: 0,
    blockRow0: 0,
    zoom: 15,
    tileY: 19650,
    bands: RASTER_TEMPLATE_DEFAULTS.slope.bands,
    place: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
    smooth: false,
    outW: 8,
    outY: 0,
    outH: 8,
  };
};

type Fake = {
  onerror: ((e: { preventDefault(): void }) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onmessageerror: (() => void) | null;
  posted: unknown[];
  terminate: ReturnType<typeof vi.fn>;
};

/** Helpers that take jobs and answer only when a test says so. */
function fakeHelpers(): Fake[] {
  const made: Fake[] = [];
  vi.stubGlobal(
    "Worker",
    class {
      onerror: Fake["onerror"] = null;
      onmessage: Fake["onmessage"] = null;
      onmessageerror: Fake["onmessageerror"] = null;
      posted: unknown[] = [];
      terminate = vi.fn();
      postMessage = vi.fn((m: unknown) => this.posted.push(m));
      constructor() {
        made.push(this);
      }
    },
  );
  return made;
}

describe("TerrainPool", () => {
  it("leaves a single core to do the work itself, and starts no more than seven", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    expect(helperCount()).toBe(0);
    vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
    expect(helperCount()).toBe(3);
    vi.stubGlobal("navigator", { hardwareConcurrency: 64 });
    expect(helperCount()).toBe(7);
  });

  // Mutation: let the constructor's error out, or drop `runQueueHere`: a
  // browser that will not start a worker from a worker draws nothing.
  it("does the work here when no helper can start", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("no nested workers");
        }
      },
    );
    const pool = new TerrainPool({ count: 3 });
    expect(pool.size).toBe(0);
    expect(await pool.band(band())).toEqual(runTerrainBand(band()));
  });

  // Mutation: hand jobs out in turn instead of to whichever helper is free
  // (the second helper then gets the third band while the first idles).
  it("gives the next job to the helper that is free, however many it has done", () => {
    const made = fakeHelpers();
    const pool = new TerrainPool({ count: 2 });
    for (let i = 0; i < 4; i++) void pool.band(band());
    expect(made.map((h) => h.posted.length)).toEqual([1, 1]);
    made[1]!.onmessage!({ data: { result: new Uint8ClampedArray(0) } });
    made[1]!.onmessage!({ data: { result: new Uint8ClampedArray(0) } });
    expect(made.map((h) => h.posted.length)).toEqual([1, 3]);
    expect(pool.helperBands).toBe(2);
    pool.terminate();
  });

  // Mutation: drop `e.preventDefault()` in the pool's onerror (the event ends
  // not defaultPrevented), or requeue every running job instead of the failed
  // helper's own (the healthy helper's band is then drawn twice).
  it("hands a failed helper's job to another, and only that helper's", async () => {
    const made = fakeHelpers();
    const pool = new TerrainPool({ count: 2 });
    let settled = 0;
    for (let i = 0; i < 3; i++) void pool.band(band()).then(() => settled++);
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    made[0]!.onerror!(event);
    expect(event.defaultPrevented).toBe(true);
    expect(made[0]!.terminate).toHaveBeenCalled();
    expect(pool.size).toBe(1);
    // The second helper still has its first band; the failed one's waits.
    expect(made[1]!.posted).toHaveLength(1);
    made[1]!.onmessage!({ data: { result: new Uint8ClampedArray(0) } });
    made[1]!.onmessage!({ data: { result: new Uint8ClampedArray(0) } });
    made[1]!.onmessage!({ data: { result: new Uint8ClampedArray(0) } });
    await Promise.resolve();
    expect(made[1]!.posted).toHaveLength(3);
    expect(settled).toBe(3);
  });

  it("does the work here once the last helper fails, an undeliverable result included", async () => {
    const made = fakeHelpers();
    const pool = new TerrainPool({ count: 1 });
    const running = Promise.all([pool.band(band()), pool.band(band())]);
    made[0]!.onmessageerror!();
    const done = await running;
    expect(done[0]).toEqual(runTerrainBand(band()));
    expect(done[1]).toEqual(runTerrainBand(band()));
  });
});
