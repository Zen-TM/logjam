import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VEGETATION_BASE_BYTES,
  VEGETATION_BYTES_PER_M2,
  vegetationTaskMemoryMiB,
} from "./vegetationMemory";

const ticked = { vegetation: true };

const worker = readFileSync(
  join(import.meta.dirname, "../../../topo/worker_common.py"),
  "utf8",
);

describe("the vegetation pass's memory numbers", () => {
  // Mutation: change either number here or in topo/worker_common.py, and the
  // task the API asks for no longer matches the check the pass makes.
  it("are the ones the worker declares", () => {
    const rate = Number(/^VEGETATION_BYTES_PER_M2 = (\d+)$/m.exec(worker)![1]);
    const base = /^VEGETATION_BASE_BYTES = (\d+) \* 1024\*\*2$/m.exec(
      worker,
    )![1];
    expect(VEGETATION_BYTES_PER_M2).toBe(rate);
    expect(VEGETATION_BASE_BYTES).toBe(Number(base) * 1024 ** 2);
  });
});

describe("vegetationTaskMemoryMiB", () => {
  // Mutation: drop the tick check, and every unticked job of a big ZIP
  // launches (and is billed) at the larger size for a layer it never makes.
  it("never enlarges an unticked job's task", () => {
    expect(vegetationTaskMemoryMiB({ vegetation: false }, 500)).toBeUndefined();
  });

  // Mutation: size from the wrong tile area, or let a small job off the task
  // definition's size (every ticked job then pays for a bigger task).
  it("leaves a small area at the task definition's size", () => {
    expect(vegetationTaskMemoryMiB(ticked, 1)).toBeUndefined();
    expect(vegetationTaskMemoryMiB(ticked, 40)).toBeUndefined();
  });

  // Mutation: a step off the valid Fargate sizes (16 to 60 GiB in 4 GiB
  // steps), which RunTask refuses and so fails the job at /start.
  it("steps up through 32 GiB to 60 GiB, all valid Fargate sizes", () => {
    const sizes = new Set<number>();
    for (let tiles = 1; tiles <= 500; tiles++) {
      const mib = vegetationTaskMemoryMiB(ticked, tiles);
      if (mib !== undefined) sizes.add(mib);
    }
    expect([...sizes].sort((a, b) => a - b)).toEqual([32768, 61440]);
    for (const mib of sizes) {
      expect(mib % 4096).toBe(0);
      expect(mib).toBeGreaterThanOrEqual(16384);
      expect(mib).toBeLessThanOrEqual(61440);
    }
  });

  // Mutation: keep nothing back for the worker (RESERVE_BYTES = 0), and a ZIP
  // the pass would decline in 16 GiB is launched in it.
  it("asks for the next size once the estimate passes the last", () => {
    // 4 km² a tile: 60 bytes a m² is 240 MB a tile, plus 0.5 GiB and 1 GiB
    // kept back; 16 GiB holds 64 tiles and 32 GiB holds 136.
    expect(vegetationTaskMemoryMiB(ticked, 64)).toBeUndefined();
    expect(vegetationTaskMemoryMiB(ticked, 65)).toBe(32768);
    expect(vegetationTaskMemoryMiB(ticked, 136)).toBe(32768);
    expect(vegetationTaskMemoryMiB(ticked, 137)).toBe(61440);
  });

  // Mutation: fall back to the smallest size when none fits, and the largest
  // areas get no larger task.
  it("asks for the most when nothing fits, so the pass declines it", () => {
    expect(vegetationTaskMemoryMiB(ticked, 10_000)).toBe(61440);
  });
});
