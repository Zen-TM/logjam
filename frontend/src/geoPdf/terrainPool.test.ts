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

describe("TerrainPool", () => {
  it("leaves a device with few cores to do the work itself", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
    expect(helperCount()).toBe(0);
    vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
    expect(helperCount()).toBe(2);
    vi.stubGlobal("navigator", { hardwareConcurrency: 64 });
    expect(helperCount()).toBe(3);
  });

  // Mutation: let the constructor's error out, or drop the inline path in
  // `run`: a browser that will not start a worker from a worker draws nothing.
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
    expect(pool.width).toBe(1);
    const [rgba] = await pool.run([band()]);
    expect(rgba).toEqual(runTerrainBand(band()));
  });

  // Mutation: drop `e.preventDefault()` in the pool's onerror (the event ends
  // not defaultPrevented), or redo every pending band instead of the failed
  // helper's own (the healthy helper's band is then drawn twice).
  it("hands a failed helper's band back to be done here, and only that helper's", async () => {
    type Fake = {
      onerror: ((e: { preventDefault(): void }) => void) | null;
      posted: unknown[];
      terminate: ReturnType<typeof vi.fn>;
    };
    const made: Fake[] = [];
    vi.stubGlobal(
      "Worker",
      class {
        onerror: Fake["onerror"] = null;
        onmessage = null;
        onmessageerror = null;
        posted: unknown[] = [];
        terminate = vi.fn();
        postMessage = vi.fn((m: unknown) => this.posted.push(m));
        constructor() {
          made.push(this);
        }
      },
    );
    const pool = new TerrainPool({ count: 2 });
    expect(pool.width).toBe(3);
    const running = pool.run([band(), band(), band()]);
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    made[0]!.onerror!(event);
    expect(event.defaultPrevented).toBe(true);
    // Only the first helper's band was redone here: the second's is still out.
    expect(made[1]!.posted).toHaveLength(1);
    let settled = false;
    void running.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    expect(pool.width).toBe(2);
    pool.terminate();
  });

  it("falls back on an undeliverable result too", async () => {
    const made: { onmessageerror: (() => void) | null }[] = [];
    vi.stubGlobal(
      "Worker",
      class {
        onerror = null;
        onmessage = null;
        onmessageerror: (() => void) | null = null;
        terminate = vi.fn();
        postMessage = vi.fn();
        constructor() {
          made.push(this);
        }
      },
    );
    const pool = new TerrainPool({ count: 1 });
    const running = pool.run([band(), band()]);
    made[0]!.onmessageerror!();
    const done = await running;
    expect(done[1]).toEqual(runTerrainBand(band()));
  });
});
