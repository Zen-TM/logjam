import { describe, expect, it, vi } from "vitest";

import { DEM_SOURCES, TERRARIUM } from "./demSources.js";
import { normalizeUserUiPreferences } from "./themeSchemes.js";
import { canyonOffersFor } from "./contracts/placesList.js";
import {
  regionChoiceProblem,
  regionOffRefusal,
  toggleRegion,
} from "./contracts/settings.js";
import {
  BASEMAP_CATALOG,
  defaultBasemapFor,
  offeredBasemaps,
} from "./geoPdfBaseLayers.js";
import {
  accountRegion,
  canyonRegionsOf,
  DEFAULT_REGION_IDS,
  layerIn,
  placeRegistryIn,
  NSW_REGION,
  normalizeRegionIds,
  offersRegionChoice,
  REGIONS,
  regionAt,
  regionBounds,
  regionInView,
  regionInWrappedView,
  regionsOf,
  regionsTouching,
  regionTouchesBox,
  simRegionsOn,
  WORLD,
  wrapView,
  type LonLatBox,
  type Region,
} from "./regions.js";
import { SIM_NZ, SIM_REGIONS, SIM_UTAH, SIM_WORLD } from "./simRegions.js";

const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);
const ALL: readonly Region[] = [NSW_REGION, ...SIM_REGIONS, SIM_WORLD, WORLD];

describe("the declaration", () => {
  // Mutation: give a second region NSW's id, and choosing one chooses both.
  it("gives each region its own id", () => {
    expect(new Set(ids(REGIONS)).size).toBe(REGIONS.length);
  });

  // Mutation: list "six-topo" under a second region too, and a user who
  // chose either sees it, so choosing stops meaning anything.
  it("puts each basemap in one region at most, and only real ones", () => {
    const claimed = REGIONS.flatMap((region) => region.basemaps);
    expect(new Set(claimed).size).toBe(claimed.length);
    for (const id of claimed) expect(ids(BASEMAP_CATALOG)).toContain(id);
  });

  // Mutation: set a default basemap the region doesn't list, and Logjam GPS
  // opens on a map its picker can't show. A region with none opens on a
  // worldwide entry, which no region lists.
  it("opens each region on one of its own basemaps", () => {
    const owned = ALL.flatMap((region) => region.basemaps);
    for (const region of ALL)
      if (region.basemaps.length > 0)
        expect(region.basemaps).toContain(region.defaultBasemap);
      else {
        expect(ids(BASEMAP_CATALOG)).toContain(region.defaultBasemap);
        expect(owned).not.toContain(region.defaultBasemap);
      }
  });

  // Mutation: an id with a capital or a hyphen, and a map's layer ids
  // (`${id}${layer}`) stop being plain words that never collide.
  it("keeps each id to lower-case letters and digits", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(5);
    for (const region of ALL) expect(region.id).toMatch(/^[a-z0-9]+$/);
  });

  // Mutation: add a DEM source with a coverage box to DEM_SOURCES by hand, or
  // drop a region's `dem`, and heights come from a source no region owns.
  it("derives DEM_SOURCES: every region's, finest first, then the worldwide one", () => {
    expect(DEM_SOURCES).toEqual([
      ...REGIONS.flatMap((region) => region.dem),
      TERRARIUM,
    ]);
    const owned = REGIONS.flatMap((region) => ids(region.dem));
    for (const source of DEM_SOURCES.filter((s) => s.coverage))
      expect(owned).toContain(source.id);
    expect(new Set(owned).size).toBe(owned.length);
  });

  // Mutation: cut the terrain from TERRARIUM, and the hillshade reads an
  // archive no region declares.
  it("cuts each region's terrain from one of its own height sources", () => {
    const withHeights = ALL.filter((r) => layerIn(r, "heights"));
    expect(withHeights.length).toBeGreaterThanOrEqual(4);
    for (const region of withHeights)
      expect(region.dem).toContain(region.terrain.heights);
  });

  // Mutation: "Australia/Sidney", and every date read in it throws.
  it("names a time zone the runtime knows", () => {
    for (const region of REGIONS)
      expect(
        () => new Intl.DateTimeFormat("en", { timeZone: region.timeZone }),
      ).not.toThrow();
  });

  // Mutation: a view centre in the sea, and a new map opens on nothing.
  it("opens its map inside its own border", () => {
    for (const region of [NSW_REGION, ...SIM_REGIONS]) {
      const [lon, lat] = region.view.center;
      expect(
        regionTouchesBox(region, {
          west: lon,
          south: lat,
          east: lon,
          north: lat,
        }),
      ).toBe(true);
    }
  });

  // Stored on phones, in climb labels and in installed builds: a new value
  // here strands every copy of the old one.
  // Mutation: rename any of these, and every phone, track and build that
  // stored the old value reads a source that no longer exists.
  it("keeps NSW's stored ids and paths", () => {
    expect(NSW_REGION.id).toBe("nsw");
    expect(NSW_REGION.terrain.heights.id).toBe("nsw-5m");
    expect(NSW_REGION.terrain.heights.archivePath).toBe(
      "master/dem/nsw-5m.pmtiles",
    );
    expect(NSW_REGION.placeSearch).toBe("master/places/v1/");
    expect(NSW_REGION.gauges).toBe("master/gauges/v1/");
    expect(NSW_REGION.basemaps).toEqual([
      "protomaps",
      "six-topo",
      "six-base",
      "six-imagery",
    ]);
    expect(NSW_REGION.defaultBasemap).toBe("six-topo");
    expect(NSW_REGION.terrain.fire.id).toBe("nsw-fire");
    expect(NSW_REGION.terrain.fire.archivePath).toBe(
      "master/fire/nsw-fire-history.pmtiles",
    );
    expect(NSW_REGION.terrain.coverage.id).toBe("nsw-coverage");
    expect(NSW_REGION.terrain.coverage.archivePath).toBe(
      "master/coverage/nsw-coverage.pmtiles",
    );
    expect(NSW_REGION.vector).toEqual({
      archivePath: "master/basemap/protomaps-nsw.pmtiles",
      maxzoom: 15,
    });
  });

  // Mutation: set the global in the test environment, and every other test
  // runs with the simulated regions in `REGIONS`.
  it("declares only NSW unless the simulated-regions flag is set", () => {
    expect(simRegionsOn()).toBe(false);
    expect(ids(REGIONS)).toEqual(["nsw"]);
    expect(WORLD.vector).toBeNull();
    expect(WORLD.terrain).toEqual({});
  });
});

describe("canyonOffersFor", () => {
  // Mutation: read `uiPreferences.regions` as it is, and an account that
  // never chose (or holds a retired id) is offered no canyon import.
  it("reads the account's preferences through their normaliser", () => {
    expect(canyonOffersFor(null)).toEqual([NSW_REGION]);
    expect(canyonOffersFor({ regions: ["nsw", "atlantis"] })).toEqual([
      NSW_REGION,
    ]);
    expect(canyonOffersFor({ regions: ["atlantis"] })).toEqual([NSW_REGION]);
  });
});

describe("canyon sources", () => {
  // Mutation: copy NSW's snapshot key into a second region, and one region's
  // fresh fetch replaces the other's cached corpus (api ropeWikiCache.ts).
  it("give each region its own RopeWiki region and snapshot", () => {
    const sources = REGIONS.flatMap((region) =>
      region.canyons ? [region.canyons] : [],
    );
    for (const key of ["snapshotKey", "ropewikiRegion"] as const) {
      const values = sources.map((source) => source[key]);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("normalizeRegionIds", () => {
  const two: readonly Region[] = [
    NSW_REGION,
    { ...NSW_REGION, id: "nz", name: "New Zealand" },
  ];

  // Mutation: return [] for an absent key, and every account that signed up
  // before there was a choice loses NSW's maps.
  it("reads an absent or damaged choice as NSW", () => {
    expect(DEFAULT_REGION_IDS).toEqual(["nsw"]);
    for (const value of [undefined, null, "nsw", {}, [], [42]])
      expect(normalizeRegionIds(value)).toEqual(["nsw"]);
  });

  // Mutation: keep the stored list as it is.
  it("drops ids no region has, and any repeat", () => {
    expect(normalizeRegionIds(["atlantis", "nsw", "nsw"])).toEqual(["nsw"]);
    expect(normalizeRegionIds(["atlantis"])).toEqual(["nsw"]);
  });

  // Mutation: return the ids in the order chosen, and the import offers and
  // the default basemap change with the order a user ticked them.
  it("keeps the regions behind a choice in the picker's order", () => {
    expect(ids(regionsOf(["nz", "nsw"], two))).toEqual(["nsw", "nz"]);
  });
});

describe("accountRegion", () => {
  const all: readonly Region[] = [NSW_REGION, SIM_NZ, SIM_UTAH];
  const home = (regions: unknown) => accountRegion({ regions }, all).id;

  // Mutation: return the id the user ticked first, not the first in
  // `REGIONS` order, and the season changes with the order they ticked.
  it("is the first chosen region in REGIONS order", () => {
    expect(home(["simutah", "simnz"])).toBe("simnz");
    expect(home(["simutah", "nsw"])).toBe("nsw");
  });

  // Mutation: return null or throw for an account with no stored choice.
  it("is NSW for an account that never chose", () => {
    for (const prefs of [undefined, null, "nsw", {}, { regions: [] }])
      expect(accountRegion(prefs, all)).toBe(NSW_REGION);
    expect(accountRegion({ regions: ["atlantis"] }).id).toBe("nsw");
  });
});

describe("canyonRegionsOf", () => {
  // Mutation: drop the `canyons` test, and a region with no canyon list is
  // offered an import that can only fail.
  it("offers an import for each chosen region with a canyon source", () => {
    const nz = { ...NSW_REGION, id: "nz", canyons: null };
    expect(ids(canyonRegionsOf(["nsw", "nz"], [NSW_REGION, nz]))).toEqual([
      "nsw",
    ]);
    expect(canyonRegionsOf(["nz"], [NSW_REGION, nz])).toEqual([]);
  });
});

describe("offersRegionChoice", () => {
  // Mutation: `>= 1`, and every user is asked a question with one answer.
  it("asks only once there are two regions", () => {
    expect(offersRegionChoice([NSW_REGION])).toBe(false);
    expect(offersRegionChoice([NSW_REGION, { ...NSW_REGION, id: "nz" }])).toBe(
      true,
    );
  });
});

describe("regionTouchesBox", () => {
  const box = (west: number, south: number, east: number, north: number) => ({
    west,
    south,
    east,
    north,
  });

  // Mutation: drop the corner-in-border test (the small box) or the
  // vertex-in-box test (the big one), and that box is refused.
  it("finds a box inside the border, and one around all of it", () => {
    expect(regionTouchesBox(NSW_REGION, box(150, -34, 150.1, -33.9))).toBe(
      true,
    );
    expect(regionTouchesBox(NSW_REGION, box(130, -45, 170, -20))).toBe(true);
  });

  // Mutation: test against `regionBounds` instead, and Melbourne passes.
  it("refuses a box clear of it", () => {
    // Melbourne, and the Tasman Sea.
    expect(regionTouchesBox(NSW_REGION, box(144.9, -37.9, 145, -37.8))).toBe(
      false,
    );
    expect(regionTouchesBox(NSW_REGION, box(156, -34, 157, -33))).toBe(false);
    // Bendigo: inside the border's bounds, south of the Murray.
    expect(regionTouchesBox(NSW_REGION, box(144, -37.2, 144.1, -37.1))).toBe(
      false,
    );
  });

  // Mutation: drop the edge-crossing test, and a strip right across the
  // state, with every corner out of it and no vertex of the border in it, is
  // refused. The two above each fail on dropping one of the other two tests.
  it("finds a strip that only crosses the border's edges", () => {
    expect(regionTouchesBox(NSW_REGION, box(130, -33, 170, -32.99))).toBe(true);
  });

  // Mutation: pull a vertex in at the Tweed, the Murray or Cape Howe, and a
  // real NSW export is refused at submit.
  it("holds every edge of NSW and the ACT", () => {
    const edges: [string, number, number][] = [
      ["Point Danger", 153.55, -28.165],
      ["Cape Byron", 153.638, -28.638],
      ["Boggabilla", 150.36, -28.6],
      ["Mungindi", 148.98, -28.98],
      ["Cameron Corner", 140.999, -28.999],
      ["Tibooburra", 142.01, -29.43],
      ["Broken Hill", 141.47, -31.95],
      ["Wentworth", 141.92, -34.11],
      ["Corowa", 146.39, -36.0],
      ["Albury", 146.92, -36.08],
      ["Thredbo", 148.3, -36.5],
      ["Cape Howe", 149.976, -37.505],
      ["Eden", 149.9, -37.07],
      ["Canberra", 149.13, -35.28],
    ];
    for (const [name, lon, lat] of edges)
      expect(regionTouchesBox(NSW_REGION, box(lon, lat, lon, lat)), name).toBe(
        true,
      );
  });

  // Mutation: take min for east, and the geocoder's view box is empty.
  it("bounds the border, and refuses a region with none", () => {
    const { west, south, east, north } = regionBounds(NSW_REGION);
    expect(west).toBeLessThan(141);
    expect(east).toBeGreaterThan(153.6);
    expect(south).toBeLessThan(-37.5);
    expect(north).toBeGreaterThan(-28.2);
    // Mutation: drop the empty check, and the geocoder's box is +/-Infinity.
    expect(() => regionBounds(WORLD)).toThrow(/no border/);
  });
});

describe("offeredBasemaps", () => {
  const nz: Region = {
    ...NSW_REGION,
    id: "nz",
    name: "New Zealand",
    basemaps: ["osm-cycle"],
    defaultBasemap: "osm-cycle",
  };
  const two = [NSW_REGION, nz];

  // Mutation: list every catalogue entry, and a user who chose New Zealand is
  // offered SIX Maps of NSW.
  it("lists the worldwide basemaps and the chosen regions' own", () => {
    expect(ids(offeredBasemaps(["nz"], two))).toEqual([
      "osm-topo",
      "osm-cycle",
    ]);
    expect(ids(offeredBasemaps(["nsw"], two))).toEqual([
      "protomaps",
      "osm-topo",
      "six-topo",
      "six-base",
      "six-imagery",
    ]);
  });

  // Mutation: drop the `offered` test, and both pickers grow a second
  // OpenStreetMap row that can't be saved.
  it("leaves out what no picker lists", () => {
    expect(ids(offeredBasemaps(["nsw"]))).not.toContain("osm");
  });

  it("opens on the first chosen region's default, else a worldwide one", () => {
    expect(defaultBasemapFor(["nsw"])).toBe("six-topo");
    expect(defaultBasemapFor(["nz", "nsw"], two)).toBe("six-topo");
    expect(defaultBasemapFor(["nz"], two)).toBe("osm-cycle");
    expect(defaultBasemapFor([], two)).toBe("osm-topo");
  });
});

describe("uiPreferences.regions", () => {
  // Mutation: leave `regions` out of normalizeUserUiPreferences, and a
  // client reads undefined for every account that never chose.
  it("is NSW for an account that never chose, and drops unknown ids", () => {
    expect(normalizeUserUiPreferences(null).regions).toEqual(["nsw"]);
    expect(normalizeUserUiPreferences({}).regions).toEqual(["nsw"]);
    expect(
      normalizeUserUiPreferences({ regions: ["nsw", "atlantis"] }).regions,
    ).toEqual(["nsw"]);
  });
});

describe("toggleRegion and regionOffRefusal", () => {
  const two: readonly Region[] = [
    NSW_REGION,
    { ...NSW_REGION, id: "nz", name: "New Zealand" },
  ];

  // Mutation: append the switched id, and the two clients store one choice in
  // two orders.
  it("switches a region, keeping the picker's order", () => {
    expect(toggleRegion(["nz"], "nsw", two)).toEqual(["nsw", "nz"]);
    expect(toggleRegion(["nsw", "nz"], "nsw", two)).toEqual(["nz"]);
  });

  // Mutation: refuse whenever one region is chosen, and the one that is off
  // can't be switched on.
  it("refuses to switch off only the last chosen region", () => {
    expect(regionOffRefusal(["nsw"], "nsw")).toBe(regionChoiceProblem([]));
    expect(regionOffRefusal(["nsw"], "nz")).toBeNull();
    expect(regionOffRefusal(["nsw", "nz"], "nsw")).toBeNull();
  });
});

describe("the simulated regions", () => {
  // Mutation: reuse an id or an archive path across two, and a clip or a map
  // layer of one answers for another.
  it("share no id or archive path with each other or with NSW", () => {
    const declared = [NSW_REGION, ...SIM_REGIONS, SIM_WORLD];
    const archives = declared.flatMap((r) => [
      ...Object.values(r.terrain).map((a) => a.id),
      ...Object.values(r.terrain).map((a) => a.archivePath),
    ]);
    // A hillshade shares its archive with the heights, so count the ids.
    const idsOnly = declared.flatMap((r) =>
      Object.values(r.terrain).map((a) => a.id),
    );
    expect(new Set(idsOnly).size).toBe(idsOnly.length);
    expect(archives.length).toBeGreaterThan(15);
    for (const sim of [...SIM_REGIONS, SIM_WORLD])
      for (const archive of Object.values(sim.terrain))
        expect(archive.archivePath).toContain(
          sim === SIM_WORLD ? "simworld" : sim.id,
        );
  });

  // Mutation: duplicate a `source` or `name` in a simulated region's land
  // classes, or a carrier `id` in its coverage: `landColor` builds a `match`
  // with a repeated label, which MapLibre rejects, and a picker lists one
  // carrier twice.
  it("list each land class and each carrier once", () => {
    const declared = [NSW_REGION, ...SIM_REGIONS, SIM_WORLD];
    const unique = (values: string[]) => new Set(values).size === values.length;
    const withLand = declared.filter((r) => r.terrain.land);
    const withCoverage = declared.filter((r) => r.terrain.coverage);
    expect(withLand.length).toBeGreaterThanOrEqual(3);
    expect(withCoverage.length).toBeGreaterThanOrEqual(2);
    for (const r of withLand) {
      const classes = r.terrain.land!.classes;
      expect(unique(classes.map((c) => c.source)), r.id).toBe(true);
      expect(unique(classes.map((c) => c.name)), r.id).toBe(true);
    }
    for (const r of withCoverage)
      expect(unique(r.terrain.coverage!.carriers.map((c) => c.id)), r.id).toBe(
        true,
      );
  });

  // Mutation: draw a ring over the sea between the islands.
  it("give NZ one ring for each island", () => {
    expect(SIM_NZ.borders).toHaveLength(2);
    expect(SIM_UTAH.borders).toHaveLength(1);
  });
});

describe("simRegionsOn", () => {
  // Mutation: read the flag when `REGIONS` is used instead of when the module
  // loads, or ignore it, and the clients' tables built at load disagree.
  it("puts the simulated regions and their world in the declaration at load", async () => {
    const flag = globalThis as { LOGJAM_SIM_REGIONS?: unknown };
    vi.resetModules();
    flag.LOGJAM_SIM_REGIONS = true;
    try {
      const on = await import("./regions.js");
      const sim = await import("./simRegions.js");
      expect(on.simRegionsOn()).toBe(true);
      expect(ids(on.REGIONS)).toEqual(["nsw", "simnz", "simutah"]);
      expect(on.WORLD).toBe(sim.SIM_WORLD);
      const demSources = await import("./demSources.js");
      expect(ids(demSources.DEM_SOURCES)).toContain("simnz-heights");
    } finally {
      delete flag.LOGJAM_SIM_REGIONS;
      vi.resetModules();
    }
    expect(simRegionsOn()).toBe(false);
  });
});

describe("regionAt", () => {
  const two = [NSW_REGION, ...SIM_REGIONS];
  const wanaka: [number, number] = [169.1, -44.62];
  const coromandel: [number, number] = [175.6, -37.0];

  // Mutation: test only `borders[0]`, and a point on the second island
  // belongs to no region.
  it("finds a point on each island of a region", () => {
    expect(regionAt(...wanaka, two)).toBe(SIM_NZ);
    expect(regionAt(...coromandel, two)).toBe(SIM_NZ);
  });

  // Mutation: test the region's bounding box, and the strait between the
  // islands is New Zealand.
  it("finds nothing in the strait, at sea or in a gap between regions", () => {
    expect(regionAt(174.5, -41.2, two)).toBeNull();
    expect(regionAt(156, -33, two)).toBeNull();
    // Inside the box round NZ's two rings, between them.
    expect(regionAt(172.0, -40.0, two)).toBeNull();
  });

  // Mutation: return NSW whatever the point, and Utah is New South Wales.
  it("tells the hemispheres apart", () => {
    expect(regionAt(-110.8, 38.27, two)).toBe(SIM_UTAH);
    expect(regionAt(150.31, -33.7, two)).toBe(NSW_REGION);
  });

  // Mutation: fall back to WORLD for a point no region holds.
  it("never returns the world", () => {
    expect(regionAt(0, 0, [...two, SIM_WORLD])).toBeNull();
  });

  // Mutation: search from the end, and an overlap reads as the later region.
  it("takes the first region in order where two overlap", () => {
    const twin: Region = { ...SIM_NZ, id: "twin" };
    expect(regionAt(...wanaka, [SIM_NZ, twin])).toBe(SIM_NZ);
    expect(regionAt(...wanaka, [twin, SIM_NZ])).toBe(twin);
  });
});

describe("regionsTouching", () => {
  const two = [NSW_REGION, ...SIM_REGIONS];

  // Mutation: stop at the first region, and a box across both islands is
  // saved with the South Island's data alone.
  it("lists every region a box shares ground with", () => {
    expect(
      ids(
        regionsTouching({ west: 168, south: -45, east: 176, north: -36 }, two),
      ),
    ).toEqual(["simnz"]);
    expect(
      ids(
        regionsTouching({ west: -111, south: -40, east: 155, north: 40 }, two),
      ),
    ).toEqual(["nsw", "simutah"]);
  });

  it("is empty for a box over the sea", () => {
    expect(
      regionsTouching(
        { west: 174, south: -41.5, east: 174.5, north: -41 },
        two,
      ),
    ).toEqual([]);
  });
});

describe("regionInView", () => {
  const two = [NSW_REGION, ...SIM_REGIONS];
  const around = (lon: number, lat: number, half: number) => ({
    west: lon - half,
    south: lat - half,
    east: lon + half,
    north: lat + half,
  });
  const quiet: Region = { ...SIM_WORLD, vector: null, terrain: {} };

  // Mutation: take the first region touching the view, and a view centred on
  // the next region's ground draws NSW because it clips NSW's coast.
  it("takes the region under the view's centre", () => {
    const next: Region = {
      ...SIM_NZ,
      id: "next",
      borders: [
        [
          [154.3, -33],
          [155, -33],
          [155, -32],
          [154.3, -32],
        ],
      ],
    };
    const view = { west: 153.9, south: -33.2, east: 154.9, north: -32.8 };
    expect(regionsTouching(view, [NSW_REGION, next])[0]).toBe(NSW_REGION);
    expect(regionInView(view, [NSW_REGION, next], quiet)).toBe(next);
  });

  // Mutation: return null when the centre is in no region, and a view that
  // only grazes one draws none of its layers.
  it("falls back to the first region touching the view", () => {
    // Centred in the strait, one island at the edge of the view.
    const view = { west: 174.0, south: -41.5, east: 176.0, north: -36.9 };
    expect(regionAt(175, -39.2, two)).toBeNull();
    expect(regionInView(view, two, quiet)).toBe(SIM_NZ);
  });

  // Mutation: return WORLD for a world that declares nothing, and prod's
  // layers read "available" outside NSW.
  it("falls back to the world only when it declares something", () => {
    const sea = around(156, -33, 0.5);
    expect(regionInView(sea, two, quiet)).toBeNull();
    expect(regionInView(sea, two, SIM_WORLD)).toBe(SIM_WORLD);
    expect(regionInView(sea)).toBeNull();
  });

  // Mutation: let the world win over a region that holds the centre.
  it("prefers a region to the world", () => {
    expect(regionInView(around(150.31, -33.7, 1), two, SIM_WORLD)).toBe(
      NSW_REGION,
    );
  });
});

describe("placeRegistryIn", () => {
  const nz: Region = { ...SIM_NZ, placeSearch: "master/places/simnz/v1/" };
  const two = [NSW_REGION, nz, SIM_UTAH];
  const over = (lon: number, lat: number) => ({
    west: lon - 0.05,
    south: lat - 0.05,
    east: lon + 0.05,
    north: lat + 0.05,
  });

  // Mutation: return `regionInView(view)` as it is, without the `placeSearch`
  // test, and a map over Utah (no registry) reads as having one.
  it("is the region in view when it has a registry, and null when it has none", () => {
    expect(placeRegistryIn(over(150.31, -33.7), two)).toBe(NSW_REGION);
    expect(placeRegistryIn(over(...nz.view.center), two)).toBe(nz);
    expect(placeRegistryIn(over(...SIM_UTAH.view.center), two)).toBeNull();
  });

  // Mutation: fall back to the first region with a registry for a view in
  // none, and a map over the open sea is searched as NSW.
  it("is null outside every region, whatever the world declares", () => {
    expect(placeRegistryIn(over(156, -33), two, SIM_WORLD)).toBeNull();
    expect(placeRegistryIn(over(156, -33))).toBeNull();
  });

  // Mutation: read an unknown view as the default region, and a map not yet
  // settled asks the registry for a place it is not showing.
  it("is null for a view that is not known yet", () => {
    expect(placeRegistryIn(null, two)).toBeNull();
    expect(placeRegistryIn(undefined, two)).toBeNull();
  });

  // Mutation: drop the `wrapView` call, and a map panned once round the world
  // matches no region.
  it("reads a map panned round the world", () => {
    const [lon, lat] = nz.view.center;
    expect(placeRegistryIn(over(lon + 360, lat), two)).toBe(nz);
  });
});

describe("layerIn", () => {
  // Mutation: return `{}` or the region for an absent layer, and a switch
  // reads "available" over no data.
  it("is the region's archive, or null where it has none", () => {
    expect(layerIn(NSW_REGION, "land")).toBe(NSW_REGION.terrain.land);
    expect(layerIn(SIM_NZ, "heights")).toBe(SIM_NZ.terrain.heights);
    expect(layerIn(SIM_NZ, "land")).toBe(SIM_NZ.terrain.land);
    expect(layerIn(SIM_UTAH, "coverage")).toBeNull();
    expect(layerIn(SIM_WORLD, "land")).toBeNull();
    expect(layerIn(SIM_WORLD, "fire")).toBeNull();
    expect(layerIn(SIM_WORLD, "slope")).toBeNull();
    expect(layerIn(SIM_WORLD, "hillshade")).not.toBeNull();
  });

  it("is null for no region", () => {
    expect(layerIn(null, "heights")).toBeNull();
  });
});

describe("regionInWrappedView", () => {
  // Mutation: pass the view to `regionInView` without `wrapView`, and a map
  // panned a turn round the world is over no region.
  it("reads a view panned past the antimeridian by whole turns", () => {
    const at = (lon: number): LonLatBox => ({
      west: lon - 0.1,
      south: -33.8,
      east: lon + 0.1,
      north: -33.6,
    });
    expect(regionInWrappedView(at(150.3))).toBe(NSW_REGION);
    expect(regionInWrappedView(at(150.3 + 360))).toBe(NSW_REGION);
    expect(regionInWrappedView(at(150.3 - 360))).toBe(NSW_REGION);
    expect(regionInView(at(150.3 + 360))).toBeNull();
  });
});

describe("wrapView", () => {
  // Mutation: round the turn the other way, so a centre at 180 stays at 180.
  it("moves a box by whole turns until its centre is in [-180, 180)", () => {
    const at = (centre: number): LonLatBox => ({
      west: centre - 1,
      south: -1,
      east: centre + 1,
      north: 1,
    });
    const centreOf = (view: LonLatBox) => (view.west + view.east) / 2;
    expect(centreOf(wrapView(at(-180)))).toBe(-180);
    expect(centreOf(wrapView(at(179.9)))).toBeCloseTo(179.9);
    expect(centreOf(wrapView(at(180)))).toBe(-180);
    expect(centreOf(wrapView(at(540)))).toBe(-180);
    expect(wrapView(at(-190))).toEqual({
      west: 169,
      south: -1,
      east: 171,
      north: 1,
    });
  });
});
