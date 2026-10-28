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
    const pool = new TerrainPool(3);
    expect(pool.width).toBe(1);
    const [rgba] = await pool.run([band()]);
    expect(rgba).toEqual(runTerrainBand(band()));
  });

  it("hands a failed helper's band back to be done here", async () => {
    const made: { onerror: (() => void) | null; terminate: () => void }[] = [];
    vi.stubGlobal(
      "Worker",
      class {
        onerror: (() => void) | null = null;
        onmessage = null;
        terminate = vi.fn();
        // The helper never answers.
        postMessage = vi.fn(() => queueMicrotask(() => this.onerror?.()));
        constructor() {
          made.push(this);
        }
      },
    );
    const pool = new TerrainPool(1);
    expect(pool.width).toBe(2);
    const done = await pool.run([band(), band()]);
    expect(done[1]).toEqual(runTerrainBand(band()));
    expect(pool.width).toBe(1);
    pool.terminate();
  });
});
