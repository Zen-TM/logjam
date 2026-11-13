import { MAX_TYPICAL_ELVIS_TILE_KM2, WORKER_SPECS } from "@logjam/shared";

// What a ticked sharpen job's task needs for the vegetation pass, so /start can
// ask for a larger task than the task definition's. The pass's memory grows
// with the area (topo/worker_common.py declares and measures both numbers;
// vegetationMemory.unit.test.ts reads them from there and fails if they differ).
export const VEGETATION_BYTES_PER_M2 = 60;
export const VEGETATION_BASE_BYTES = 512 * 1024 ** 2;

const GIB = 1024 ** 3;
/**
 * What the task keeps for the worker and the sharpen outputs beside the pass.
 * Only here, not in the pass's own check: the pass measures what is free, and
 * the API asks for a size that leaves room, so it is not left out by a margin.
 */
const RESERVE_BYTES = GIB;

/** Fargate's valid task memory for 8 vCPU runs 16 to 60 GiB in 4 GiB steps. */
const TASK_MEMORY_GIB = [WORKER_SPECS.topo.memoryGiB, 32, 60] as const;

/**
 * The task-level memory (MiB) to launch a sharpen job with, from its mark and
 * its ZIP's point-cloud count, or undefined for the task definition's own
 * size (an unticked job, or an area that fits it). A ZIP
 * whose estimate fits no size gets the largest: the pass then declines it and
 * the job finishes without the layer. The tiles' areas are summed, which
 * equals the worker's bounding box (`union_area_m2`) only for a compact block
 * of tiles, and counts overlapping surveys twice. A set that is not compact
 * (diagonal, L-shaped: tiles picked along a creek) has a bigger box than its
 * sum, so it can be under-sized: the pass then declines the layer and the
 * owner is told.
 */
export function vegetationTaskMemoryMiB(
  mark: { vegetation: boolean },
  lazCount: number,
): number | undefined {
  if (!mark.vegetation) return undefined;
  const areaM2 = lazCount * MAX_TYPICAL_ELVIS_TILE_KM2 * 1e6;
  const need =
    VEGETATION_BASE_BYTES + VEGETATION_BYTES_PER_M2 * areaM2 + RESERVE_BYTES;
  const gib =
    TASK_MEMORY_GIB.find((size) => need <= size * GIB) ??
    TASK_MEMORY_GIB[TASK_MEMORY_GIB.length - 1];
  return gib === TASK_MEMORY_GIB[0] ? undefined : gib * 1024;
}
