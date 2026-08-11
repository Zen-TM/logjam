import { describe, expect, it } from "vitest";

import { DEFAULT_WAYPOINT_SYMBOL, waypointSymbol } from "./waypointSymbol";

describe("waypointSymbol", () => {
  it("derives from the first tag", () => {
    expect(waypointSymbol({ tags: ["carpark"] }).icon).toBe("truck");
  });

  it("keeps the first tag's answer when later tags also match", () => {
    // Stability: adding a lookup entry for `hazard` must not repaint every
    // waypoint that happens to carry it as a second tag.
    expect(waypointSymbol({ tags: ["water", "hazard"] }).icon).toBe("droplet");
  });

  it("is case-insensitive, because the tag vocabulary is free text", () => {
    expect(waypointSymbol({ tags: ["Carpark"] }).icon).toBe("truck");
  });

  it("lets an explicit symbol override the tags", () => {
    expect(waypointSymbol({ symbol: "anchor", tags: ["carpark"] }).icon).toBe(
      "anchor",
    );
  });

  it("falls back to the pin for an unknown tag or no tags at all", () => {
    expect(waypointSymbol({ tags: ["slippery log"] })).toEqual(
      DEFAULT_WAYPOINT_SYMBOL,
    );
    expect(waypointSymbol({})).toEqual(DEFAULT_WAYPOINT_SYMBOL);
    expect(waypointSymbol({ tags: [] })).toEqual(DEFAULT_WAYPOINT_SYMBOL);
  });
});
