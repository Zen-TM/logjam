import { describe, expect, it } from "vitest";

import { DEM_SOURCES, TERRARIUM } from "./demSources.js";
import { normalizeUserUiPreferences } from "./themeSchemes.js";
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
  canyonRegionsOf,
  DEFAULT_REGION_IDS,
  NSW_REGION,
  normalizeRegionIds,
  offersRegionChoice,
  REGIONS,
  regionBounds,
  regionsOf,
  regionTouchesBox,
  type Region,
} from "./regions.js";

const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);

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
  // opens on a map its picker can't show.
  it("opens each region on one of its own basemaps", () => {
    for (const region of REGIONS)
      expect(region.basemaps).toContain(region.defaultBasemap);
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
    for (const region of REGIONS.filter((r) => r.terrain))
      expect(region.dem).toContain(region.terrain!.heights);
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
    for (const region of REGIONS) {
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
  it("bounds the border", () => {
    const { west, south, east, north } = regionBounds(NSW_REGION);
    expect(west).toBeLessThan(141);
    expect(east).toBeGreaterThan(153.6);
    expect(south).toBeLessThan(-37.5);
    expect(north).toBeGreaterThan(-28.2);
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
