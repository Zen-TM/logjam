import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getCustomFields: vi.fn(),
  getPlaceTypes: vi.fn(),
}));
vi.mock("./placeUtils", () => api);

import { useBootDefinitions } from "./useBootDefinitions";

afterEach(() => vi.resetAllMocks());

// Mutation that turns this red: key the effect on `authenticated` again
// (i.e. pass true while the gate is up), and the requests leave behind
// ConsentGate; or drop `enabled` from the deps, and they never leave after
// consent is accepted.
describe("useBootDefinitions", () => {
  it("sends nothing while the consent gate is up, then loads once it settles", async () => {
    api.getCustomFields.mockResolvedValue([]);
    api.getPlaceTypes.mockResolvedValue([]);
    const set = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useBootDefinitions(enabled, set, set, set),
      { initialProps: { enabled: false } },
    );
    expect(api.getCustomFields).not.toHaveBeenCalled();
    expect(api.getPlaceTypes).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(api.getCustomFields).toHaveBeenCalledWith("place");
    expect(api.getCustomFields).toHaveBeenCalledWith("trip-log");
    expect(api.getPlaceTypes).toHaveBeenCalledTimes(1);
  });
});
