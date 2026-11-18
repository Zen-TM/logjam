import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBasemapFallback } from "./useBasemapFallback";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../feedback/ToastProvider", () => ({ useToast: () => toast }));

const nsw = [
  { id: "protomaps", name: "OSM Vector" },
  { id: "six-topo", name: "SIX Maps Topo" },
];
const elsewhere = [{ id: "osm-topo", name: "OSM Topo" }];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useBasemapFallback", () => {
  // Mutation: fall back to "protomaps" whatever the layers, and over ground
  // outside our archive a down pick is swapped for a vector map that draws
  // nothing there.
  it("keeps the pick where the vector map is not offered", () => {
    const { result } = renderHook(() =>
      useBasemapFallback("osm-topo", elsewhere),
    );
    act(() => result.current.setHealth("osm-topo", true));
    expect(result.current.shownLayerId).toBe("osm-topo");
    expect(toast.error).not.toHaveBeenCalled();
  });

  // Mutation: drop the fallback, and a pick whose server is down stays blank.
  it("draws the vector map for a down pick, and says so", () => {
    const { result } = renderHook(() => useBasemapFallback("six-topo", nsw));
    act(() => result.current.setHealth("six-topo", true));
    expect(result.current.shownLayerId).toBe("protomaps");
    expect(toast.error).toHaveBeenCalledWith(
      "SIX Maps Topo isn't available right now. Showing OSM Vector instead.",
    );
  });
});
