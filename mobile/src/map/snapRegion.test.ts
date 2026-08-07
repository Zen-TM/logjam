import { describe, it, expect } from "vitest";

import { regionCovering } from "./snapRegion";
import type { MapArtifact } from "./sourceResolver";

// Synthetic coordinates only — no real canyon locations in a committed test.
const region = (over: Partial<MapArtifact>): MapArtifact => ({
  id: "r1",
  kind: "basemap-region",
  logicalKey: "protomaps",
  format: "pmtiles",
  sourceType: "vector",
  path: "/data/regions/r1.pmtiles",
  bbox: [150.0, -34.0, 151.0, -33.0],
  minzoom: 0,
  maxzoom: 15,
  sizeBytes: 1,
  downloadedAt: "2026-08-07T00:00:00.000Z",
  label: null,
  ...over,
});

const INSIDE_A: [number, number] = [150.2, -33.5];
const INSIDE_B: [number, number] = [150.4, -33.6];
const OUTSIDE: [number, number] = [149.0, -33.5];

describe("regionCovering", () => {
  it("picks a region holding both ends", () => {
    expect(regionCovering([region({})], INSIDE_A, INSIDE_B)?.id).toBe("r1");
  });

  it("declines when only one end is inside", () => {
    expect(regionCovering([region({})], INSIDE_A, OUTSIDE)).toBeNull();
  });

  it("declines a region clipped shallower than the snap zoom", () => {
    // It would answer "no ways here" rather than "I don't have that" — worse
    // than falling back to the network.
    expect(regionCovering([region({ maxzoom: 13 })], INSIDE_A, INSIDE_B)).toBeNull();
  });

  it("ignores artifacts that are not vector basemap regions", () => {
    expect(
      regionCovering(
        [
          region({ kind: "topo-overlay" }),
          region({ format: "mbtiles" }),
          region({ bbox: null }),
        ],
        INSIDE_A,
        INSIDE_B,
      ),
    ).toBeNull();
  });

  it("is empty-safe", () => {
    expect(regionCovering([], INSIDE_A, INSIDE_B)).toBeNull();
  });
});
