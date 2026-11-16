import { beforeEach, describe, expect, it, vi } from "vitest";
import { GAUGE_PREFIX } from "@logjam/shared";

import { registerSavedGaugeHistoryRefresh } from "./savedPlaceHistories";

const h = vi.hoisted(() => ({
  places: [] as { latitude: number; longitude: number; gaugeId?: string }[],
  refresh: vi.fn(async (..._args: unknown[]) => {}),
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock("../sync/mirrorStore", () => ({
  listMirrorPlaces: async () => h.places,
}));
vi.mock("./gaugeFeed", () => ({ refreshGaugeHistories: h.refresh }));

beforeEach(() => h.refresh.mockClear());

describe("the saved places' gauge histories", () => {
  // Mutation: pass every saved gauge id to `GAUGE_PREFIX`, as before there was
  // a feed per region, and a gauge on a place outside every feed is asked for
  // from New South Wales's → red.
  it("are kept per feed, and none for a place outside every region", async () => {
    h.places = [
      { latitude: -33.7, longitude: 150.3, gaugeId: "900001" },
      { latitude: -45.1, longitude: 169.2, gaugeId: "900002" },
      { latitude: -33.8, longitude: 150.4 },
    ];
    registerSavedGaugeHistoryRefresh();
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.refresh.mock.calls).toEqual([[GAUGE_PREFIX, ["900001"]]]);
  });
});
