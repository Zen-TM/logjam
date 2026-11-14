import { describe, expect, it } from "vitest";
import { TERRAIN_LAYER_DEFAULTS } from "@logjam/shared";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import { sheetTerrain } from "../../geoPdf/sheetTerrain";
import {
  contoursPrintedHere,
  hillshadeShadowedHere,
  layerMissingHere,
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

  // Mutation: drop `!isOverlayTerrainKey(key)`, and any print over one of the
  // user's own jobs tints the land nobody asked to see.
  it("prints Land only where the map shows it, job or no job", () => {
    const shown = (land: boolean) =>
      shownOverlays(new Set(), true, { ...mapShowsContours, land }, true);
    expect(shown(false).has("land")).toBe(false);
    expect(shown(true).has("land")).toBe(true);
  });

  // Mutation: drop the `VALID_GEOPDF_OVERLAY_NAMES` test, and a map showing
  // Fire history or Coverage asks the renderer for a layer it has no drawing of.
  it("never prints Fire history or Coverage, whatever the map shows", () => {
    for (const key of ["fire", "coverage"] as const) {
      const shown = (jobInArea: boolean) =>
        shownOverlays(
          new Set(),
          true,
          { ...mapShowsContours, [key]: true },
          jobInArea,
        );
      expect(shown(false).has(key)).toBe(false);
      expect(shown(true).has(key)).toBe(false);
    }
  });

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

describe("hillshadeShadowedHere", () => {
  // Mutation: return false, and imagery offers a shading over its own shadows.
  it("is true over imagery only", () => {
    expect(hillshadeShadowedHere("six-imagery")).toBe(true);
    expect(hillshadeShadowedHere("six-topo")).toBe(false);
    expect(hillshadeShadowedHere("protomaps")).toBe(false);
  });
});

describe("layerMissingHere", () => {
  const all = sheetTerrain(area);

  // Mutation: map `hillshade` to `slope` in ARCHIVE_OF in place of `heights`,
  // or drop its `land` key, and that layer is judged by the wrong archive or
  // never judged missing.
  it("is true for each layer whose archive the sheet's region lacks", () => {
    const keys = ["contours", "slope", "hillshade", "land"];
    for (const key of keys) expect(layerMissingHere(all, key), key).toBe(false);
    const bare = {
      ...all,
      contours: null,
      slope: null,
      heights: null,
      land: null,
    };
    for (const key of keys) expect(layerMissingHere(bare, key), key).toBe(true);
    expect(layerMissingHere({ ...all, heights: null }, "slope")).toBe(false);
    expect(layerMissingHere({ ...all, heights: null }, "hillshade")).toBe(true);
  });

  // Mutation: return true for a null `terrain`, and the form says nothing is
  // available before an area is set, which a prod with one region must not show.
  it("judges nothing before an area is set, and never a job's own layer", () => {
    expect(layerMissingHere(null, "slope")).toBe(false);
    const bare = {
      ...all,
      contours: null,
      slope: null,
      heights: null,
      land: null,
    };
    expect(layerMissingHere(bare, "vegetation")).toBe(false);
    expect(layerMissingHere(bare, "my-places")).toBe(false);
  });
});
