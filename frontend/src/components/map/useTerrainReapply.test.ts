import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useTerrainReapply } from "./useTerrainReapply";

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
});
