import { describe, expect, it } from "vitest";

import { DEM_SOURCES, TERRARIUM } from "./demSources.js";
import { BASEMAP_CATALOG } from "./geoPdfBaseLayers.js";
import {
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

  it("cuts each region's terrain from one of its own height sources", () => {
    for (const region of REGIONS.filter((r) => r.terrain))
      expect(region.dem).toContain(region.terrain!.heights);
  });

  it("names a time zone the runtime knows", () => {
    for (const region of REGIONS)
      expect(
        () => new Intl.DateTimeFormat("en", { timeZone: region.timeZone }),
      ).not.toThrow();
  });

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
  it("keeps NSW's stored ids and paths", () => {
    expect(NSW_REGION.id).toBe("nsw");
    expect(NSW_REGION.terrain.heights.id).toBe("nsw-5m");
    expect(NSW_REGION.terrain.heights.archivePath).toBe(
      "master/dem/nsw-5m.pmtiles",
    );
    expect(NSW_REGION.placeSearch).toBe("master/places/v1/");
    expect(NSW_REGION.gauges).toBe("master/gauges/v1/");
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

  it("keeps the regions behind a choice in the picker's order", () => {
    expect(ids(regionsOf(["nz", "nsw"], two))).toEqual(["nsw", "nz"]);
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

  it("finds a box inside the border, and one around all of it", () => {
    expect(regionTouchesBox(NSW_REGION, box(150, -34, 150.1, -33.9))).toBe(
      true,
    );
    expect(regionTouchesBox(NSW_REGION, box(130, -45, 170, -20))).toBe(true);
  });

  it("refuses a box clear of it", () => {
    // Melbourne, and the Tasman Sea.
    expect(regionTouchesBox(NSW_REGION, box(144.9, -37.9, 145, -37.8))).toBe(
      false,
    );
    expect(regionTouchesBox(NSW_REGION, box(156, -34, 157, -33))).toBe(false);
  });

  // Mutation: drop the edge-crossing test, and a strip right across the
  // state, with every corner out of it and no vertex of the border in it, is
  // refused. The two above each fail on dropping one of the other two tests.
  it("finds a strip that only crosses the border's edges", () => {
    expect(regionTouchesBox(NSW_REGION, box(130, -33, 170, -32.99))).toBe(true);
  });

  it("bounds the border", () => {
    const { west, south, east, north } = regionBounds(NSW_REGION);
    expect(west).toBeLessThan(141);
    expect(east).toBeGreaterThan(153.6);
    expect(south).toBeLessThan(-37.5);
    expect(north).toBeGreaterThan(-28.2);
  });
});
