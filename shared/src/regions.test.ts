import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { DEM_SOURCES, TERRARIUM } from "./demSources.js";
import { normalizeUserUiPreferences } from "./themeSchemes.js";
import { canyonOffersFor } from "./contracts/placesList.js";
import {
  REGION_CHOICE,
  regionChoiceProblem,
  regionOffRefusal,
  toggleRegion,
} from "./contracts/settings.js";
import {
  BASEMAP_CATALOG,
  basemapHere,
  defaultBasemapFor,
  LISTED_BASEMAPS,
  offeredBasemaps,
  vectorBasemapIn,
} from "./geoPdfBaseLayers.js";
import {
  accountRegion,
  areasInRegion,
  canyonRegionsOf,
  DEFAULT_REGION_IDS,
  layerIn,
  placeRegistryIn,
  regionsWithRegistry,
  regionWithRegistry,
  NSW_REGION,
  normalizeRegionIds,
  offersRegionChoice,
  REGIONS,
  REGIONS_WITH_SIMULATED,
  regionAt,
  regionBounds,
  regionInView,
  regionOfArea,
  regionsOf,
  regionsTouching,
  regionTouchesBox,
  simRegionsOn,
  soleRegion,
  vectorArchiveAt,
  vectorsTouching,
  WORLD,
  type LonLatBox,
  type Region,
} from "./regions.js";
import { PLACE_REGISTRY_FORMAT } from "./placeRegistry.js";
import { SIM_NZ, SIM_REGIONS, SIM_UTAH, SIM_WORLD } from "./simRegions.js";

const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);
const ALL: readonly Region[] = [NSW_REGION, ...SIM_REGIONS, SIM_WORLD, WORLD];

describe("the declaration", () => {
  // Mutation: write a vertex of any ring at a longitude of 190 or -190, and
  // `regionTouchesBox`, which reads a ring in [-180, 180] and the box in every
  // world copy, misses the ground east of the line.
  it("keeps every border longitude in [-180, 180]", () => {
    const lons = ALL.flatMap((region) =>
      region.borders.flat().map(([lon]) => lon),
    );
    expect(lons.length).toBeGreaterThan(20);
    for (const lon of lons) {
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
  });

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

  // Mutation: list "protomaps" in a region's `basemaps` again, and the vector
  // map is offered by ownership as well as by `vector`: two declarations that
  // can disagree.
  it("leaves the vector basemap out of every region's basemaps", () => {
    const vector = BASEMAP_CATALOG.filter((entry) => entry.kind === "vector");
    expect(vector.length).toBeGreaterThan(0);
    for (const region of ALL)
      for (const entry of vector)
        expect(region.basemaps).not.toContain(entry.id);
  });

  // Mutation: set a default basemap the region doesn't list, or default to an
  // `offered: false` entry, and Logjam GPS opens on a map its picker can't
  // show. A region with none opens on a worldwide entry, which no region lists.
  it("opens each region on one of its own basemaps", () => {
    const owned = ALL.flatMap((region) => region.basemaps);
    for (const region of ALL) {
      expect(ids(LISTED_BASEMAPS)).toContain(region.defaultBasemap);
      if (region.basemaps.length > 0)
        expect(region.basemaps).toContain(region.defaultBasemap);
      else {
        expect(ids(BASEMAP_CATALOG)).toContain(region.defaultBasemap);
        expect(owned).not.toContain(region.defaultBasemap);
      }
    }
  });

  // Mutation: an id with a capital or a hyphen, and a map's layer ids
  // (`${id}${layer}`) stop being plain words that never collide.
  it("keeps each id to lower-case letters and digits", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(5);
    for (const region of ALL) expect(region.id).toMatch(/^[a-z0-9]+$/);
  });

  // Mutation: add a second entry to `REGIONS` whose heights reuse NSW's id
  // (`nsw-5m`), or give a simulated slope another region's id, and a save
  // queues two clips under one key and prices the archive twice.
  it("gives every terrain archive an id no other has, across every region", () => {
    const archiveIds = [...new Set([...REGIONS, ...ALL])].flatMap((region) =>
      Object.values(region.terrain).map((archive) => archive.id),
    );
    expect(archiveIds.length).toBeGreaterThanOrEqual(15);
    expect(new Set(archiveIds).size).toBe(archiveIds.length);
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

  // Mutation: drop the trailing slash from `GAUGE_PREFIX`, and a feed's files
  // are asked for at `…v1latest.json`.
  it("every gauge feed prefix ends in a slash", () => {
    const feeds = ALL.flatMap((region) => region.gauges ?? []);
    expect(feeds.length).toBeGreaterThan(0);
    for (const feed of feeds) expect(feed.endsWith("/")).toBe(true);
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
    expect(NSW_REGION.vector).toMatchObject({
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

describe("soleRegion", () => {
  // Mutation: return `regions[0]` whatever the length, and a list of two
  // regions is read as the first one.
  it("is the region of a list of one, and null for none or several", () => {
    expect(soleRegion([NSW_REGION])).toBe(NSW_REGION);
    expect(soleRegion([])).toBeNull();
    expect(soleRegion([NSW_REGION, SIM_NZ])).toBeNull();
  });
});

describe("REGION_CHOICE.hint", () => {
  // Mutation: restore the old sentence, which says the choice decides what the
  // maps offer (ADR 0049: the map decides, the choice sets defaults).
  it("says what a chosen region sets", () => {
    expect(REGION_CHOICE.hint).toBe(
      "Logjam opens on your regions and offers their canyon lists.",
    );
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
    ...SIM_NZ,
    basemaps: ["osm-cycle"],
    defaultBasemap: "osm-cycle",
  };
  const two = [NSW_REGION, nz];
  const around = (
    [lon, lat]: readonly [number, number],
    r = 0.1,
  ): LonLatBox => ({
    west: lon - r,
    south: lat - r,
    east: lon + r,
    north: lat + r,
  });
  const inNsw = around([150.3, -33.7]);
  const inNz = around([169.25, -44.055]);
  const atSea = around([160, -40]);
  const both: LonLatBox = { west: 140, south: -45, east: 175, north: -30 };

  // Mutation: list every catalogue entry, and a map over New Zealand is
  // offered SIX Maps of NSW.
  it("lists the worldwide basemaps and the own ones of what the view touches", () => {
    expect(ids(offeredBasemaps(inNz, two))).toEqual([
      "protomaps",
      "osm-topo",
      "osm-cycle",
    ]);
    expect(ids(offeredBasemaps(inNsw, two))).toEqual([
      "protomaps",
      "osm-topo",
      "six-topo",
      "six-base",
      "six-imagery",
    ]);
    expect(ids(offeredBasemaps(atSea, two))).toEqual(["osm-topo"]);
  });

  // Mutation: read only the region under the centre, and a view that shows
  // two regions loses one's basemaps.
  it("lists every region the view touches, in the catalogue's order", () => {
    expect(ids(offeredBasemaps(both, two))).toEqual([
      "protomaps",
      "osm-topo",
      "osm-cycle",
      "six-topo",
      "six-base",
      "six-imagery",
    ]);
  });

  // Mutation: in `regionTouchesBox` read the box only as given (set `first`
  // and `last` to 0), and a map panned a turn past the antimeridian loses
  // New Zealand's basemaps.
  it("reads a view panned past the antimeridian where it is on the globe", () => {
    expect(
      ids(
        offeredBasemaps(
          { ...inNz, west: inNz.west + 360, east: inNz.east + 360 },
          two,
        ),
      ),
    ).toEqual(["protomaps", "osm-topo", "osm-cycle"]);
  });

  // Mutation: drop the `offered` test, and both pickers grow a second
  // OpenStreetMap row that can't be saved.
  it("leaves out what no picker lists", () => {
    expect(ids(offeredBasemaps(inNsw))).not.toContain("osm");
  });

  // Mutation: take the last chosen region's, and an account that chose two
  // opens on the second's map.
  it("opens on the first chosen region's default, else a worldwide one", () => {
    expect(defaultBasemapFor(["nsw"])).toBe("six-topo");
    expect(defaultBasemapFor([nz.id, "nsw"], two)).toBe("six-topo");
    expect(defaultBasemapFor([nz.id], two)).toBe("osm-cycle");
    expect(defaultBasemapFor([], two)).toBe("osm-topo");
  });

  // Mutation: return the region's default for any pick, and a pick the view
  // offers is swapped for the default.
  it("keeps a pick the view offers", () => {
    expect(basemapHere("six-base", inNsw, two)).toBe("six-base");
    expect(basemapHere("osm-topo", inNz, two)).toBe("osm-topo");
  });

  // Mutation: fall back to the first offered, and over New Zealand a picked
  // NSW sheet shows OSM Topo instead of the region's own default.
  it("shows the default of the region in view for a pick it does not offer", () => {
    expect(basemapHere("six-base", inNz, two)).toBe("osm-cycle");
    expect(basemapHere("osm-cycle", inNsw, two)).toBe("six-topo");
    expect(basemapHere("gone", both, two)).toBe("six-topo");
  });

  // Mutation: return the pick when no region is in view, and a map over open
  // sea draws a sheet that covers none of it.
  it("shows the first offered where no region is in view", () => {
    expect(basemapHere("six-base", atSea, two)).toBe("osm-topo");
  });
});

describe("LISTED_BASEMAPS", () => {
  // Mutation: drop the `offered` test, and Logjam Web mounts, and Logjam GPS
  // accepts a stored pick of, the raster "Default" no picker lists.
  it("is the catalogue without what no picker lists, in its order", () => {
    expect(ids(LISTED_BASEMAPS)).toEqual(
      ids(BASEMAP_CATALOG).filter((id) => id !== "osm"),
    );
  });
});

describe("the vector basemap", () => {
  const bare: Region = { ...SIM_UTAH, vector: null };
  const three = [NSW_REGION, SIM_NZ, bare];
  const at = ([lon, lat]: readonly [number, number]): LonLatBox => ({
    west: lon - 0.05,
    south: lat - 0.05,
    east: lon + 0.05,
    north: lat + 0.05,
  });
  const inNsw = at([150.3, -33.7]);
  const inNz = at([169.25, -44.055]);
  const inBare = at(bare.view.center);
  const atSea = at([160, -40]);
  const offers = (view: LonLatBox, world?: Region) =>
    ids(offeredBasemaps(view, three, world)).includes("protomaps");

  // Mutation: offer the vector entry whatever the view, and a map over a
  // region with no vector extract lists a map that draws nothing; offer it
  // only where `NSW_REGION` is, and New Zealand's own cut is never listed.
  it("is offered where the region in view declares an archive of it", () => {
    expect(offers(inNsw)).toBe(true);
    expect(offers(inNz)).toBe(true);
    expect(offers(inBare)).toBe(false);
    expect(offers(atSea)).toBe(false);
  });

  // Mutation: read `world.vector` whatever touches, and a view over a region
  // with none is offered the planet's.
  it("falls to the world's archive only where no region is in view", () => {
    expect(offers(atSea, SIM_WORLD)).toBe(true);
    expect(offers(inBare, SIM_WORLD)).toBe(false);
  });

  // Mutation: look in `REGIONS` alone, and a saved clip of the world's archive
  // reads as one no one declares; look nowhere but the first region, and a
  // clip of a later region's archive does too.
  it("vectorArchiveAt: finds a declared archive by its path, else none", () => {
    expect(vectorArchiveAt(NSW_REGION.vector!.archivePath, three)).toBe(
      NSW_REGION.vector,
    );
    expect(vectorArchiveAt(SIM_NZ.vector!.archivePath, three)).toBe(
      SIM_NZ.vector,
    );
    expect(
      vectorArchiveAt(SIM_WORLD.vector!.archivePath, three, SIM_WORLD),
    ).toBe(SIM_WORLD.vector);
    expect(vectorArchiveAt(SIM_WORLD.vector!.archivePath, three)).toBeNull();
    expect(vectorArchiveAt("master/basemap/none.pmtiles", three)).toBeNull();
  });

  // Mutation: take only the first touching region's, and a save over two
  // regions has no vector map for the second; take the world's as well, and a
  // save over a region adds the planet's archive.
  it("vectorsTouching: every touching region's archive, else the world's", () => {
    const wide: LonLatBox = { west: 140, south: -50, east: 175, north: -30 };
    expect(vectorsTouching(wide, three, SIM_WORLD)).toEqual([
      NSW_REGION.vector,
      SIM_NZ.vector,
    ]);
    expect(vectorsTouching(inNsw, three, SIM_WORLD)).toEqual([
      NSW_REGION.vector,
    ]);
    expect(vectorsTouching(inBare, three, SIM_WORLD)).toEqual([]);
    expect(vectorsTouching(atSea, three, SIM_WORLD)).toEqual([
      SIM_WORLD.vector,
    ]);
    expect(vectorsTouching(atSea, three)).toEqual([]);
  });
});

describe("vectorBasemapIn", () => {
  // Mutation: return the vector id without the `includes` test, and a client
  // falls to a vector map over ground its archive does not cover; return the
  // first id offered, and it falls to a map that is not the vector one.
  it("names the vector basemap only where it is offered", () => {
    expect(vectorBasemapIn(["osm-topo", "protomaps"])).toBe("protomaps");
    expect(vectorBasemapIn(["six-topo", "protomaps"])).toBe("protomaps");
    expect(vectorBasemapIn(["osm-topo", "osm-cycle"])).toBeUndefined();
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
  // Mutation: name a simulated archive's path without its region's id, and a
  // clip of one region's data could be taken for another's.
  it("keep each archive under its own region's path", () => {
    let checked = 0;
    for (const sim of [...SIM_REGIONS, SIM_WORLD])
      for (const archive of Object.values(sim.terrain)) {
        checked++;
        expect(archive.archivePath).toContain(
          sim === SIM_WORLD ? "simworld" : sim.id,
        );
      }
    expect(checked).toBeGreaterThanOrEqual(15);
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
  const makarora: [number, number] = [169.25, -44.055];
  const coromandel: [number, number] = [175.63, -37.1];

  // Mutation: test only `borders[0]`, and a point on the second island
  // belongs to no region.
  it("finds a point on each island of a region", () => {
    expect(regionAt(...makarora, two)).toBe(SIM_NZ);
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
    expect(regionAt(-112.945, 37.285, two)).toBe(SIM_UTAH);
    expect(regionAt(150.31, -33.7, two)).toBe(NSW_REGION);
  });

  // Mutation: fall back to WORLD for a point no region holds.
  it("never returns the world", () => {
    expect(regionAt(0, 0, [...two, SIM_WORLD])).toBeNull();
  });

  // Mutation: search from the end, and an overlap reads as the later region.
  it("takes the first region in order where two overlap", () => {
    const twin: Region = { ...SIM_NZ, id: "twin" };
    expect(regionAt(...makarora, [SIM_NZ, twin])).toBe(SIM_NZ);
    expect(regionAt(...makarora, [twin, SIM_NZ])).toBe(twin);
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
        regionsTouching({ west: -113, south: -40, east: 155, north: 40 }, two),
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

  // Mutation: read the box only as given in `regionTouchesBox` (set `first` and
  // `last` to 0) and the centre unwrapped in `regionInView`, and a map panned
  // once round the world matches no region.
  it("reads a map panned round the world", () => {
    const [lon, lat] = nz.view.center;
    expect(placeRegistryIn(over(lon + 360, lat), two)).toBe(nz);
  });
});

describe("regionsWithRegistry and regionWithRegistry", () => {
  const nz: Region = { ...SIM_NZ, placeSearch: "master/places/simnz/v1/" };
  const all = [NSW_REGION, nz, SIM_UTAH];

  // Mutation: return `regions` unfiltered from `regionsWithRegistry`.
  it("lists, in order, the regions that declare a registry", () => {
    expect(regionsWithRegistry(all)).toEqual([NSW_REGION, nz]);
    expect(regionsWithRegistry([SIM_UTAH])).toEqual([]);
  });

  // Mutation: find by id in `regions` without the registry filter, and a
  // region with no registry is answered as having one.
  it("finds a region by its id only when it declares a registry, whatever the id's type", () => {
    expect(regionWithRegistry(nz.id, all)).toBe(nz);
    expect(regionWithRegistry(SIM_UTAH.id, all)).toBeNull();
    expect(regionWithRegistry("nowhere", all)).toBeNull();
    for (const id of [7, [nz.id], {}, null, undefined]) {
      expect(regionWithRegistry(id, all), JSON.stringify(id)).toBeNull();
    }
  });
});

describe("a region's registry prefix", () => {
  const current = new RegExp(`/v${PLACE_REGISTRY_FORMAT}/$`);

  // The prefix carries the file's format, so a bump moves every region's
  // registry (ADR 0034). Mutation: give any declared region a literal prefix
  // for another format, e.g. NSW's `placeSearch` as "master/places/v0/", or a
  // simulated region's `placeSearch` as "master/places/simnz/v0/".
  it("carries the current registry format, for every declared and simulated region", () => {
    const declared = regionsWithRegistry([
      NSW_REGION,
      ...SIM_REGIONS,
      SIM_WORLD,
    ]);
    // A floor: a filter that stopped matching would check nothing.
    expect(declared.length).toBeGreaterThanOrEqual(1);
    for (const region of declared) {
      expect(region.placeSearch, region.id).toMatch(current);
    }
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

describe("areasInRegion", () => {
  const area = (id: string, coverage: [number, number, number, number]) => ({
    id,
    coverage,
  });
  const inside = area("inside", [150.3, -33.7, 150.32, -33.68]);
  // Its centre (154.5) is in the sea, east of NSW's border, but its west edge
  // is inside.
  const coastal = area("coastal", [154.0, -33.9, 155.0, -33.5]);
  const abroad = area("abroad", [169.22, -44.08, 169.24, -44.06]);

  // Mutation: test the box's centre in `areasInRegion` in place of its
  // overlap with the border, and the coastal area drops out of NSW.
  it("keeps an area whose box touches the border, though its centre is outside", () => {
    expect(areasInRegion(NSW_REGION, [inside, coastal, abroad])).toEqual([
      inside,
      coastal,
    ]);
  });

  // Mutation: keep every area whatever the region, and an NSW area is routed
  // in another region.
  it("holds none of another region's, and none for no region", () => {
    expect(areasInRegion(SIM_NZ, [inside, coastal, abroad])).toEqual([abroad]);
    expect(areasInRegion(null, [inside])).toEqual([]);
  });
});

describe("regionOfArea", () => {
  // Mutation: test a corner of the box (`regionAt(west, south, regions)`) in
  // place of its centre, and the clients credit an area to a region
  // topo/regions.py `region_of_area` did not fill it from (its test reads the
  // same cases).
  it("is the region holding the centre of the area's box, as the worker picks it", () => {
    const { cases } = JSON.parse(
      readFileSync(
        new URL("./__fixtures__/area-region.json", import.meta.url),
        "utf8",
      ),
    ) as {
      cases: {
        why: string;
        coverage: [number, number, number, number];
        region: string | null;
      }[];
    };
    expect(cases.length).toBeGreaterThanOrEqual(6);
    for (const { why, coverage, region } of cases)
      expect(
        regionOfArea(coverage, REGIONS_WITH_SIMULATED)?.id ?? null,
        why,
      ).toBe(region);
  });
});

describe("a view panned round the world", () => {
  const at = (lon: number): LonLatBox => ({
    west: lon - 0.1,
    south: -33.8,
    east: lon + 0.1,
    north: -33.6,
  });

  // Mutation: read the box only as given in `regionTouchesBox` (set `first` and
  // `last` to 0) and the centre unwrapped in `regionInView`, and a map panned a
  // turn round the world is over no region.
  it("reads a view past the antimeridian by whole turns", () => {
    expect(regionInView(at(150.3))).toBe(NSW_REGION);
    expect(regionInView(at(150.3 + 360))).toBe(NSW_REGION);
    expect(regionInView(at(150.3 - 360))).toBe(NSW_REGION);
  });

  // Mutation: drop `wrapLon` from the centre `regionInView` reads, and the
  // view's centre, a turn over, is in no region; the first region the view
  // touches (here the other) is drawn.
  it("takes the region under the centre, in whatever world copy the view is", () => {
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
    const over = { ...view, west: view.west + 360, east: view.east + 360 };
    expect(regionsTouching(over, [NSW_REGION, next])[0]).toBe(NSW_REGION);
    expect(regionInView(over, [NSW_REGION, next], WORLD)).toBe(next);
  });
});

describe("regionTouchesBox across the date line", () => {
  // Made-up ground, one ring either side of the line as a region's borders
  // are cut (each in [-180, 180]), and a speck of ground well away from it.
  const fiji: Region = {
    ...NSW_REGION,
    id: "fiji",
    borders: [
      [
        [177, -19],
        [180, -19],
        [180, -16],
        [177, -16],
      ],
      [
        [-180, -19],
        [-178, -19],
        [-178, -16],
        [-180, -16],
      ],
      [
        [-177, -45],
        [-176, -45],
        [-176, -44],
        [-177, -44],
      ],
    ],
  };
  const box = (west: number, east: number, south = -18, north = -17) => ({
    west,
    south,
    east,
    north,
  });

  // Mutation: read the box only as given in `regionTouchesBox` (set `first` and
  // `last` to 0), and the view -181 to -180.5, which is 179 to 179.5 over the
  // line, finds no ground.
  it.each([
    ["east of the line, unwrapped", box(178, 179)],
    ["west of the line", box(-179.5, -179)],
    ["across the line, unwrapped", box(179, 181)],
    ["across the line, wrapped", box(179, -179)],
    ["wholly on the far side, unwrapped", box(-181, -180.5)],
    ["a turn over, west of the line", box(178.5 + 360, 179 + 360)],
    ["a turn under, across the line", box(179 - 360, 181 - 360)],
  ])("touches the region from a view %s", (_name, view) => {
    expect(regionTouchesBox(fiji, view)).toBe(true);
  });

  // Mutation: read the box only as given in `regionTouchesBox` (set `first` and
  // `last` to 0), and the view 100 to 500 misses the island at -177 to -176,
  // which lies in its copy a turn under.
  it("touches the region from a view more than a turn wide", () => {
    expect(regionTouchesBox(fiji, box(-200, 200))).toBe(true);
    expect(regionTouchesBox(fiji, box(-190, 180))).toBe(true);
    expect(regionTouchesBox(fiji, box(100, 500, -44.8, -44.2))).toBe(true);
    // A turn wide still has to share the region's latitudes.
    expect(regionTouchesBox(fiji, box(-200, 200, -10, -5))).toBe(false);
  });

  // Mutation: let the wrapped box's east edge stand in its own turn (the
  // `box.west + width` line as `box.east`), and 170 to -170 reads as empty.
  it("reads a wrapped box as the way it runs across the line", () => {
    expect(regionTouchesBox(fiji, box(170, -170))).toBe(true);
    expect(regionTouchesBox(fiji, box(100, -100))).toBe(true);
  });

  // Mutation: in `regionTouchesBox` return true from the loop whatever the
  // ring (replace its `ringTouchesBox` test by `true`).
  it("is not touched by a box on the ground between", () => {
    expect(regionTouchesBox(fiji, box(176, 176.5))).toBe(false);
    expect(regionTouchesBox(fiji, box(-177.8, -177.5))).toBe(false);
    expect(
      regionTouchesBox(fiji, box(-176.8 + 360, -176.2 + 360, -43, -42)),
    ).toBe(false);
    expect(regionTouchesBox(fiji, box(179, 181, -30, -25))).toBe(false);
  });

  // Mutation: test only the first ring of the region in `regionTouchesBox`, and
  // the island at -176.5 is never found.
  it("finds a separate island in any world copy", () => {
    const island = box(-176.8 + 360, -176.2 + 360, -44.8, -44.2);
    expect(regionTouchesBox(fiji, island)).toBe(true);
    expect(regionTouchesBox(fiji, box(-176.8, -176.2, -44.8, -44.2))).toBe(
      true,
    );
  });
});
