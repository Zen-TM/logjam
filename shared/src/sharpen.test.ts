import { describe, expect, it } from "vitest";

import {
  demCredits,
  isClimbSource,
  NSW_5M,
  sampleDem,
  type DemTileReader,
} from "./demSources.js";
import { DEM_TILE_SIZE } from "./demTiles.js";
import { PLACE_VERBS } from "./contracts/placeVerbs.js";
import { buildElevationProfile, climbFromProfile } from "./elevation.js";
import {
  areasInBox,
  compareSharpenedAreas,
  demSourcesFor,
  terrainTileArchive,
  type RoutedTerrain,
  type SharpenedArea,
  LIDAR_JOB_COPY,
} from "./sharpen.js";

// Made-up areas near Katoomba: a z15 range of two by two z14 tiles.
const area = (over: Partial<SharpenedArea>): SharpenedArea => ({
  id: "a",
  zmax: 16,
  tiles15: [30100, 19400, 30103, 19403],
  coverage: [150.7, -33.8, 150.72, -33.78],
  contours: true,
  credit: "Elevation: derived from a LiDAR survey. CC BY 3.0 AU.",
  createdAt: "2026-10-20T00:00:00.000Z",
  ...over,
});

describe("compareSharpenedAreas", () => {
  // Mutations: the coarser first, the older first, or an order that depends
  // on how the list was fetched.
  it("puts the finer first, then the newer, then the lower id", () => {
    const coarse = area({ id: "c", createdAt: "2026-10-23T00:00:00.000Z" });
    const fine = area({ id: "f", zmax: 17 });
    const older = area({ id: "o", createdAt: "2026-10-01T00:00:00.000Z" });
    const twin = area({ id: "b" });
    expect(
      [older, twin, coarse, fine, area({})]
        .sort(compareSharpenedAreas)
        .map((a) => a.id),
    ).toEqual(["f", "c", "a", "b", "o"]);
  });

  // Mutation: rank on anything before `zmax`, and a saved statewide clip
  // beats a newer-dated area's sharper tiles.
  it("puts a statewide clip, z15 and undated, under every area", () => {
    const clip: RoutedTerrain = {
      ...area({ id: "0" }),
      zmax: 15,
      createdAt: "",
    };
    expect(
      [clip, area({ id: "o", createdAt: "2026-01-01T00:00:00.000Z" })]
        .sort(compareSharpenedAreas)
        .map((a) => a.id),
    ).toEqual(["o", "0"]);
  });
});

describe("areasInBox", () => {
  // Mutations: drop the filter (an area far from the box is read), or the
  // sort (an export's areas lose the router's order).
  it("keeps the areas meeting the box, finest first", () => {
    const coarse = area({ id: "coarse" });
    const fine = area({ id: "fine", zmax: 17 });
    const far = area({ id: "far", tiles15: [29000, 19000, 29001, 19001] });
    // A box inside the made-up range (z15 x 30100–30103, y 19400–19403).
    const box = { west: 150.7, south: -31.44, east: 150.71, north: -31.43 };
    expect(areasInBox([coarse, far, fine], box).map((a) => a.id)).toEqual([
      "fine",
      "coarse",
    ]);
  });
});

describe("terrainTileArchive", () => {
  const a = area({});
  const route = (
    layer: "heights" | "slope" | "contours",
    z: number,
    x: number,
    y: number,
    areas = [a],
  ) => {
    const answer = terrainTileArchive(areas, layer, z, x, y);
    return typeof answer === "string" ? answer : answer.id;
  };

  // Mutations: an area answering below z15 (its archives start there), or a
  // statewide tile past z15 (it would draw over or beside the area's).
  it("reads statewide below z15 and nothing past it outside an area", () => {
    expect(route("heights", 14, 15050, 9700)).toBe("statewide");
    expect(route("heights", 15, 30099, 19400)).toBe("statewide");
    expect(route("heights", 16, 60198, 38800)).toBe("absent");
    expect(route("slope", 17, 120396, 77600)).toBe("absent");
  });

  // Mutations: an off-by-one at either edge of the inclusive range, at z15
  // or at a descendant.
  it("holds exactly the range's tiles and their descendants", () => {
    expect(route("heights", 15, 30100, 19400)).toBe("a");
    expect(route("heights", 15, 30103, 19403)).toBe("a");
    expect(route("heights", 15, 30104, 19403)).toBe("statewide");
    expect(route("heights", 15, 30103, 19404)).toBe("statewide");
    expect(route("slope", 16, 30103 * 2 + 1, 19403 * 2 + 1)).toBe("a");
    expect(route("slope", 16, 30104 * 2, 19403 * 2)).toBe("absent");
    expect(route("slope", 16, 30100 * 2, 19400 * 2)).toBe("a");
    expect(route("slope", 16, 30100 * 2 - 1, 19400 * 2)).toBe("absent");
  });

  // Mutation: an area answering past its zmax, which it has no tile for.
  it("leaves a tile past the area's zmax to its parent", () => {
    expect(route("heights", 16, 60200, 38800)).toBe("a");
    expect(route("heights", 17, 120400, 77600)).toBe("absent");
    expect(route("heights", 17, 120400, 77600, [area({ zmax: 17 })])).toBe("a");
  });

  // Mutation: the coarser or the older area chosen where two overlap.
  it("answers from the finer, then the newer, area where two overlap", () => {
    const fine = area({
      id: "fine",
      zmax: 17,
      tiles15: [30102, 19402, 30105, 19405],
    });
    const newer = area({ id: "new", createdAt: "2026-10-22T00:00:00.000Z" });
    expect(route("heights", 15, 30102, 19402, [a, fine])).toBe("fine");
    expect(route("heights", 15, 30100, 19400, [a, fine])).toBe("a");
    // Inside the finer area's range at z17, and outside it in the other's.
    expect(route("heights", 17, 30102 * 4, 19402 * 4, [a, fine])).toBe("fine");
    expect(route("heights", 17, 30100 * 4, 19400 * 4, [a, fine])).toBe(
      "absent",
    );
    expect(route("slope", 16, 60200, 38800, [a, newer])).toBe("new");
  });

  // Mutations: contours routed from z15 (the statewide z14 tile would
  // overzoom across the area's edge), absent past z14, or taken from an
  // area with no contour archive.
  it("routes contours at z14 and never leaves one absent", () => {
    expect(route("contours", 13, 7525, 4850)).toBe("statewide");
    expect(route("contours", 14, 15050, 9700)).toBe("a");
    expect(route("contours", 14, 15051, 9701)).toBe("a");
    expect(route("contours", 14, 15052, 9700)).toBe("statewide");
    expect(route("contours", 16, 60200, 38800)).toBe("a");
    expect(route("contours", 16, 60208, 38800)).toBe("statewide");
    expect(
      route("contours", 14, 15050, 9700, [area({ contours: false })]),
    ).toBe("statewide");
  });
});

describe("a sharpened area's heights", () => {
  const older = area({ id: "older", createdAt: "2026-10-01T00:00:00.000Z" });
  const fine = area({
    id: "fine",
    zmax: 17,
    coverage: [150.71, -33.8, 150.72, -33.79],
  });
  const sources = demSourcesFor([older, fine]);
  // Each source answers one height everywhere it is asked.
  const height: Record<string, number> = {
    "lidar-fine": 1,
    "lidar-older": 2,
    [NSW_5M.id]: 3,
    terrarium: 4,
  };
  const reader: DemTileReader = async (source, tiles) =>
    new Map(
      tiles.map((t) => [
        `${t.tileX}/${t.tileY}`,
        new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE).fill(
          height[source.id]!,
        ),
      ]),
    );
  const at = (lon: number, lat: number) => ({ lon, lat, distanceM: 0 });

  // Mutations: areas ranked after the public sources, or an area sampled
  // at a zoom other than its zmax.
  it("ranks the areas above the public sources, in their own order", () => {
    expect(sources.map((s) => s.id)).toEqual([
      "lidar-fine",
      "lidar-older",
      "nsw-5m",
      "terrarium",
    ]);
    expect(sources[0]!.sampleZoom).toBe(17);
  });

  // Mutation: the sampler's sources in fetch order, so the older area
  // answers inside the finer one.
  it("come from the finest area that covers a position", async () => {
    const dem = await sampleDem(
      [at(150.715, -33.795), at(150.705, -33.795), at(150.5, -33.795)],
      reader,
      sources,
    );
    expect(dem.heights).toEqual([1, 2, 3]);
    expect(dem.sourceIds).toEqual(["lidar-fine", "lidar-older", "nsw-5m"]);
  });

  // Mutations: the profile dropping an area's id (its credit then never
  // shows), or the climb stored under the job id.
  it("credit the survey and the 5 m data, and store a climb as lidar", async () => {
    const positions = [at(150.715, -33.795), at(150.716, -33.795)];
    const profile = buildElevationProfile(
      positions,
      await sampleDem(positions, reader, sources),
    );
    expect(profile.demSourceIds).toEqual(["lidar-fine"]);
    expect(demCredits(profile.demSourceIds, sources)).toEqual([
      fine.credit,
      NSW_5M.credit,
    ]);
    expect(climbFromProfile(profile)?.elevationSource).toBe("lidar");
    expect(isClimbSource("lidar")).toBe(true);
  });

  // Mutation: store a climb that leaves the area as `lidar`, and the track
  // is never offered again when a finer source covers the rest.
  it("store a climb that leaves the area as the coarser source", async () => {
    const positions = [at(150.715, -33.795), at(150.5, -33.795)];
    const profile = buildElevationProfile(
      positions,
      await sampleDem(positions, reader, sources),
    );
    expect(profile.demSourceIds).toEqual(["lidar-fine", "nsw-5m"]);
    expect(climbFromProfile(profile)?.elevationSource).toBe("nsw-5m");
    expect(demCredits(profile.demSourceIds, sources)).toEqual([
      fine.credit,
      NSW_5M.credit,
    ]);
  });
});

describe("LIDAR_JOB_COPY", () => {
  // Mutation: an entry point that writes its own label, as the place verb
  // once kept "Make a LiDAR topo here".
  it("names a new job in one place", () => {
    const verb = PLACE_VERBS.find((v) => v.id === "makeTopo")!;
    expect(verb.label).toBe(LIDAR_JOB_COPY.makeHere);
  });
});
