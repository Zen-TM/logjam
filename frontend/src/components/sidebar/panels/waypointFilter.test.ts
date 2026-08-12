import { describe, expect, it } from "vitest";

import { filterWaypoints, tagTallies } from "./waypointFilter";
import type { TWaypoint } from "../../../canyonUtils";

// Synthetic coords only (committed-fixture rule): never a real canyon.
function waypoint(overrides: Partial<TWaypoint> & { id: string }): TWaypoint {
  return {
    ownerId: "u1",
    syncRole: "owner",
    canyonIds: [],
    name: "Point",
    latitude: -33.65,
    longitude: 150.25,
    elevation: null,
    symbol: null,
    notes: null,
    tags: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const CARPARK = waypoint({ id: "a", name: "Trailhead", tags: ["carpark"] });
const EXIT = waypoint({
  id: "b",
  name: "Scramble out",
  notes: "Cairn on the ledge",
  tags: ["exit", "carpark"],
});
const BARE = waypoint({ id: "c", name: "Unnamed spot" });

describe("tagTallies", () => {
  it("counts tags in use, most-used first", () => {
    expect(tagTallies([CARPARK, EXIT, BARE])).toEqual([
      { tag: "carpark", count: 2 },
      { tag: "exit", count: 1 },
    ]);
  });

  it("offers nothing when no waypoint is tagged", () => {
    expect(tagTallies([BARE])).toEqual([]);
  });
});

describe("filterWaypoints", () => {
  const all = [CARPARK, EXIT, BARE];

  it("returns everything for an empty query and no tag", () => {
    expect(filterWaypoints(all, "  ", null)).toBe(all);
  });

  it("matches on name, case-insensitively", () => {
    expect(filterWaypoints(all, "trail", null).map((w) => w.id)).toEqual(["a"]);
  });

  it("matches on notes, which rows never show", () => {
    expect(filterWaypoints(all, "cairn", null).map((w) => w.id)).toEqual(["b"]);
  });

  it("matches on tags", () => {
    expect(filterWaypoints(all, "carpark", null).map((w) => w.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("narrows by tag alone", () => {
    expect(filterWaypoints(all, "", "exit").map((w) => w.id)).toEqual(["b"]);
  });

  it("applies query AND tag together, not either", () => {
    expect(filterWaypoints(all, "trailhead", "exit")).toEqual([]);
    expect(filterWaypoints(all, "scramble", "exit").map((w) => w.id)).toEqual([
      "b",
    ]);
  });
});
