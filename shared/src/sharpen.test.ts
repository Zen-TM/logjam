import { describe, expect, it } from "vitest";

import {
  demCredits,
  isClimbSource,
  sampleDem,
  type DemTileReader,
} from "./demSources.js";
import { DEM_TILE_SIZE } from "./demTiles.js";
import { MAP_TERRAIN } from "./contracts/mapTerrain.js";
import { PLACE_VERBS } from "./contracts/placeVerbs.js";
import { buildElevationProfile, climbFromProfile } from "./elevation.js";
import {
  areasInBox,
  compareSharpenedAreas,
  demSourcesFor,
  sharpenOffer,
  sharpenOfferFor,
  sharpenUnavailable,
  SHARPEN_OFF_REASON,
  terrainTileArchive,
  type RoutedTerrain,
  type SharpenedArea,
  LIDAR_JOB_COPY,
} from "./sharpen.js";
import { NSW_REGION, WORLD } from "./regions.js";
import { SIM_NZ, SIM_REGIONS, SIM_UTAH } from "./simRegions.js";

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
    statewideMax = 15,
  ) => {
    const answer = terrainTileArchive(areas, layer, z, x, y, statewideMax);
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

  // Mutation: answer "absent" at z16 or z17 outside every area whatever
  // `statewideMax` is (the old literal z15), and a region whose archive holds
  // z17 has its two deepest zooms read as absent once an area is held.
  it("reads statewide to the region's own deepest zoom outside an area", () => {
    for (const layer of ["heights", "slope"] as const) {
      expect(route(layer, 16, 60198, 38800, [a], 17)).toBe("statewide");
      expect(route(layer, 17, 120396, 77600, [a], 17)).toBe("statewide");
      expect(route(layer, 17, 120396, 77600, [], 17)).toBe("statewide");
      expect(route(layer, 18, 240792, 155200, [a], 17)).toBe("absent");
      // An archive that stops at z16 reads nothing at z17.
      expect(route(layer, 16, 60198, 38800, [a], 16)).toBe("statewide");
      expect(route(layer, 17, 120396, 77600, [a], 16)).toBe("absent");
    }
  });

  // Mutations: drop the `Math.max(from, …)` floor (z15 outside an area is then
  // absent when `statewideMax` is 0), or answer contours "absent" for a small
  // `statewideMax`. Callers that ask only at these zooms (Logjam GPS's
  // `terrainRoutes`, the GeoPDF contour grouping) pass a stand-in.
  it("answers at the routed zoom, and for contours, whatever the archive's deepest zoom", () => {
    const tiles = [
      [30100, 19400],
      [30103, 19403],
      [30104, 19403],
      [30099, 19400],
    ];
    const contourTiles = [
      [15050, 9700, 14],
      [15049, 9700, 14],
      [60200, 38800, 16],
      [60198, 38800, 16],
      [120400, 77600, 17],
    ];
    for (const max of [0, 15, 17]) {
      for (const layer of ["heights", "slope"] as const)
        for (const [x, y] of tiles)
          expect(route(layer, 15, x, y, [a], max)).toBe(
            route(layer, 15, x, y, [a], 15),
          );
      for (const [x, y, z] of contourTiles)
        expect(route("contours", z, x, y, [a], max)).toBe(
          route("contours", z, x, y, [a], 15),
        );
    }
    expect(route("heights", 15, 30104, 19403, [a], 0)).toBe("statewide");
    expect(route("contours", 14, 15049, 9700, [a], 0)).toBe("statewide");
  });

  // Mutations: let `statewideMax` lift an area's zmax (it answers a z17 tile
  // it has none of), or answer statewide past the area's zmax (the archive's
  // z17 tile is drawn beside the area's own z16 one).
  it("still gives an area's range to the area where the archive goes deeper", () => {
    expect(route("heights", 16, 60200, 38800, [a], 17)).toBe("a");
    expect(route("slope", 17, 120400, 77600, [a], 17)).toBe("absent");
    expect(route("slope", 17, 120400, 77600, [area({ zmax: 17 })], 17)).toBe(
      "a",
    );
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
    [NSW_REGION.terrain.heights.id]: 3,
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
      NSW_REGION.terrain.heights.credit,
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
      NSW_REGION.terrain.heights.credit,
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

describe("sharpenOffer", () => {
  const UPLOADING = [NSW_REGION, ...SIM_REGIONS].filter(
    (r) => r.sharpen.mode === "upload",
  );

  // Mutation: delete a region's `portal` from regions.ts or simRegions.ts, or
  // give it an address that is not https, and the dialog names a portal it
  // cannot link to.
  it("gives every upload region a portal", () => {
    expect(UPLOADING.map((r) => r.id)).toEqual(["nsw", "simutah"]);
    for (const region of UPLOADING) {
      const offer = sharpenOffer(region);
      if (offer.mode !== "upload") throw new Error(region.id);
      expect(offer.portal.name, region.id).not.toBe("");
      expect(offer.portal.url, region.id).toMatch(/^https:\/\/\S+$/);
    }
  });

  // Mutation: in sharpen.ts change `(region ?? WORLD).sharpen` to
  // `REGIONS[0]!.sharpen`, and Utah is sent to ELVIS.
  it("offers the region's own portal and vegetation model", () => {
    expect(sharpenOffer(NSW_REGION)).toEqual({
      mode: "upload",
      portal: {
        name: "ELVIS",
        url: "https://elevation.fsdf.org.au/",
        steps: "elvis",
      },
      vegetation: true,
    });
    expect(sharpenOffer(SIM_UTAH)).toMatchObject({
      mode: "upload",
      portal: { name: "USGS", steps: "link" },
      vegetation: false,
    });
  });

  // Mutation: in sharpen.ts change `SHARPEN_OFF_REASON[entry.reason]` to
  // `SHARPEN_OFF_REASON["no-lidar"]`, or make the two sentences the same.
  it("says why a region that is off is off", () => {
    expect(sharpenOffer(SIM_NZ)).toEqual({
      mode: "off",
      reason: SHARPEN_OFF_REASON["already-fine"],
    });
    expect(sharpenOffer(WORLD)).toEqual({
      mode: "off",
      reason: SHARPEN_OFF_REASON["no-lidar"],
    });
    expect(SHARPEN_OFF_REASON["already-fine"]).not.toBe(
      SHARPEN_OFF_REASON["no-lidar"],
    );
  });

  // Mutation: in sharpen.ts change `const entry: RegionSharpen = (region ?? WORLD).sharpen;`
  // to `(region ?? REGIONS[0]!).sharpen`, and a map over no region offers
  // ELVIS's errand.
  it("is off with no LiDAR over ground no region declares", () => {
    expect(sharpenOffer(null)).toEqual({
      mode: "off",
      reason: SHARPEN_OFF_REASON["no-lidar"],
    });
  });
});

describe("sharpenOfferFor", () => {
  const all = [NSW_REGION, ...SIM_REGIONS];
  const inUtah = { west: -112.97, south: 37.26, east: -112.93, north: 37.3 };
  const atSea = { west: 0, south: 0, east: 0.1, north: 0.1 };

  // Mutation: in sharpen.ts replace `if (!box) return sharpenOffer(view);` and
  // the `return sharpenOffer(` call after it with `return sharpenOffer(view);`,
  // and a Utah place's Sharpen offers ELVIS because the map is over New South Wales.
  it("lets the box's region decide, whatever the map shows", () => {
    expect(sharpenOfferFor(inUtah, NSW_REGION, all)).toEqual(
      sharpenOffer(SIM_UTAH),
    );
  });

  // Mutation: in sharpen.ts end the box branch with `?? view` after the
  // `regionOfArea(...)` call, and a box in no region is offered the map's
  // region's errand.
  it("is off for a box in no region, with no fall back to the map's region", () => {
    expect(sharpenOfferFor(atSea, NSW_REGION, all)).toEqual({
      mode: "off",
      reason: SHARPEN_OFF_REASON["no-lidar"],
    });
  });

  // Mutation: in sharpen.ts change `if (!box) return sharpenOffer(view);` to
  // `if (!box) return sharpenOffer(null);`, and the map's own entry points
  // ignore the region in view.
  it("reads the map's region for an action about no box", () => {
    expect(sharpenOfferFor(null, SIM_NZ, all)).toEqual(sharpenOffer(SIM_NZ));
    expect(sharpenOfferFor(null, NSW_REGION, all)).toEqual(
      sharpenOffer(NSW_REGION),
    );
  });
});

describe("sharpenUnavailable", () => {
  // Mutation: in sharpen.ts change `offer.mode === "off"` in
  // `sharpenUnavailable` to `offer.mode !== "off"`, or write the state's words
  // there instead of reading the Terrain layers' (`MAP_TERRAIN.copy.notHere`).
  it("says Not available here, with the region's reason, only where it is off", () => {
    expect(sharpenUnavailable(sharpenOffer(NSW_REGION))).toBeNull();
    expect(sharpenUnavailable(sharpenOffer(SIM_NZ))).toEqual({
      state: MAP_TERRAIN.copy.notHere,
      reason: SHARPEN_OFF_REASON["already-fine"],
    });
  });
});
