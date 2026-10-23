import { describe, expect, it } from "vitest";
import { TERRAIN_LAYER_DEFAULTS } from "@logjam/shared";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import {
  contoursPrintedHere,
  LIDAR_ONLY_OVERLAYS,
  ownJobInArea,
  seedOverlays,
  shownOverlays,
} from "./geoPdfOverlays";

// Made-up boxes near Katoomba.
const area = { north: -33.7, south: -33.76, east: 150.36, west: 150.3 };
const elsewhere = { north: -33.9, south: -33.96, east: 150.36, west: 150.3 };
const job = (syncRole: "owner" | "shared"): CompletedTopoJob =>
  ({
    syncRole,
    footprint: {
      type: "Polygon",
      coordinates: [
        [
          [150.31, -33.75],
          [150.33, -33.75],
          [150.33, -33.71],
          [150.31, -33.75],
        ],
      ],
    },
  }) as CompletedTopoJob;

describe("ownJobInArea", () => {
  // Mutation: count shared jobs too, which the renderer never draws.
  it("counts only the user's own jobs, where they are", () => {
    expect(ownJobInArea([job("owner")], area)).toBe(true);
    expect(ownJobInArea([job("owner")], elsewhere)).toBe(false);
    expect(ownJobInArea([job("shared")], area)).toBe(false);
    expect(ownJobInArea([], area)).toBe(false);
  });
});

describe("shownOverlays", () => {
  const mapShowsContours = {
    ...TERRAIN_LAYER_DEFAULTS,
    contours: true,
    slope: false,
    hillshade: false,
  };

  // Mutation: turn every Terrain layer on when no job is in the area
  // (`true || jobInArea`), and a map showing contours alone prints slope and
  // shading.
  it("opens on the Terrain layers the map shows, and every LiDAR-only one", () => {
    const shown = shownOverlays(seedOverlays(), true, mapShowsContours, false);
    expect([...shown].sort()).toEqual(
      ["contours", ...LIDAR_ONLY_OVERLAYS.map((layer) => layer.name)].sort(),
    );
  });

  // Mutation: follow only the map's switches, and a GeoPDF over a job no
  // longer prints the job's own slope and hillshade, as it did before.
  it("turns every Terrain layer on over a job of the user's", () => {
    const shown = shownOverlays(seedOverlays(), true, mapShowsContours, true);
    for (const key of ["contours", "slope", "hillshade"])
      expect(shown.has(key)).toBe(true);
  });

  // Mutation: ignore `terrainFollowsMap`, and an unticked layer comes back
  // when the area moves over a job.
  it("keeps what the user chose once they chose", () => {
    const chosen = new Set(["contours", "vegetation"]);
    expect(shownOverlays(chosen, false, mapShowsContours, true)).toEqual(
      chosen,
    );
  });

  it("leaves no Terrain layer among the LiDAR-only ones", () => {
    expect(LIDAR_ONLY_OVERLAYS.map((layer) => layer.name)).toEqual([
      "vegetation",
      "features",
    ]);
  });
});

describe("contoursPrintedHere", () => {
  // Mutation: ignore the LiDAR overlap, and a job's own contours over the
  // topographic sheet can no longer be ticked.
  it("is true only over a sheet that prints its own, with no job in the area", () => {
    expect(contoursPrintedHere("six-topo", false)).toBe(true);
    expect(contoursPrintedHere("six-topo", true)).toBe(false);
    expect(contoursPrintedHere("six-imagery", false)).toBe(false);
  });
});
