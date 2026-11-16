import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NSW_REGION, SIM_NZ, type SharpenedOverlay } from "@logjam/shared";

import { terrainReapplyKey } from "./terrainSource";
import { useTerrainReapply } from "./useTerrainReapply";

const area: SharpenedOverlay = {
  id: "a1",
  zmax: 16,
  tiles15: [30100, 19654, 30103, 19657],
  coverage: [150.7, -33.8, 150.72, -33.78],
  contours: false,
  credit: "Elevation: a made-up survey.",
  createdAt: "2026-10-24T00:00:00.000Z",
  heightsUrl: "https://bucket.test/h?sig",
  slopeUrl: "https://bucket.test/s?sig",
  contoursUrl: null,
};

// Mutations (each red): delete the effect; drop the `active` test (3D off
// would re-apply); drop the key dependency (a changed set is not re-applied).
describe("useTerrainReapply", () => {
  it("re-applies when the areas change while 3D is on", () => {
    const reapply = vi.fn();
    const { rerender } = renderHook(
      ({ key, on }) => useTerrainReapply(key, on, reapply),
      { initialProps: { key: "a", on: true } },
    );
    expect(reapply).not.toHaveBeenCalled();
    rerender({ key: "a", on: true });
    expect(reapply).not.toHaveBeenCalled();
    rerender({ key: "b", on: true });
    expect(reapply).toHaveBeenCalledTimes(1);
  });

  it("leaves 3D alone while it is off", () => {
    const reapply = vi.fn();
    const { rerender } = renderHook(
      ({ key, on }) => useTerrainReapply(key, on, reapply),
      { initialProps: { key: "a", on: false } },
    );
    rerender({ key: "b", on: false });
    expect(reapply).not.toHaveBeenCalled();
  });

  // Mutation: leave the region out of `terrainReapplyKey`, and 3D on a pan
  // across a border keeps the first region's archive and the new region draws
  // no heights.
  it("re-applies when the map crosses into another region, and not for a pan inside one", () => {
    const reapply = vi.fn();
    const { rerender } = renderHook(
      ({ region }) =>
        useTerrainReapply(terrainReapplyKey(region, []), true, reapply),
      { initialProps: { region: NSW_REGION as typeof SIM_NZ | null } },
    );
    rerender({ region: NSW_REGION });
    expect(reapply).not.toHaveBeenCalled();
    rerender({ region: SIM_NZ });
    expect(reapply).toHaveBeenCalledTimes(1);
    rerender({ region: null });
    expect(reapply).toHaveBeenCalledTimes(2);
  });
});

describe("terrainReapplyKey", () => {
  // Mutation: drop the areas' key from `terrainReapplyKey`, and a changed set
  // of sharpened areas is no longer drawn again.
  it("changes with the areas as well as the region", () => {
    expect(terrainReapplyKey(NSW_REGION, [area])).not.toBe(
      terrainReapplyKey(NSW_REGION, []),
    );
    expect(terrainReapplyKey(NSW_REGION, [])).toBe(
      terrainReapplyKey(NSW_REGION, []),
    );
  });
});
