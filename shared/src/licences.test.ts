import { describe, expect, it } from "vitest";

import { TERRARIUM } from "./demSources.js";
import { BASEMAP_CATALOG } from "./geoPdfBaseLayers.js";
import {
  dataSources,
  LICENCES,
  sourcesNeedingReplacement,
  type DataSource,
} from "./licences.js";
import {
  NSW_REGION,
  REGIONS,
  REGIONS_WITH_SIMULATED,
  WORLD,
  type Region,
} from "./regions.js";
import {
  SHARPENED_LICENCE,
  sharpenedDemSource,
  type SharpenedArea,
} from "./sharpen.js";
import { SIM_REGIONS, SIM_WORLD } from "./simRegions.js";

const NSW_ONLY = dataSources([NSW_REGION], WORLD);
const WITH_SIM = dataSources([NSW_REGION, ...SIM_REGIONS], SIM_WORLD);
// Every source of every declared region, real or simulated: the guards that
// read it cover a region added to `REGIONS_WITH_SIMULATED`. `NSW_ONLY` and
// `WITH_SIM` are exact expectations and are extended by hand.
const EVERY_DECLARED = dataSources(REGIONS_WITH_SIMULATED, SIM_WORLD);
const ids = (sources: readonly DataSource[]) => sources.map((s) => s.id);

describe("LICENCES", () => {
  // Mutation: blank one licence's `url`, or point one at a path with no scheme.
  it("records each licence's terms at an https address", () => {
    const entries = Object.values(LICENCES);
    expect(entries.length).toBeGreaterThanOrEqual(13);
    for (const licence of entries) {
      expect(licence.name).not.toBe("");
      expect(licence.url).toMatch(/^https:\/\/\S+$/);
    }
  });
});

describe("dataSources", () => {
  // Mutation: stop adding one kind of source: the geocoder, or a region's
  // vector cut.
  it("flattens every declared source of the production declaration, once each", () => {
    expect(
      ids(NSW_ONLY),
      "A declared source was added or lost. Every source carries a `LicenceId` and joins `dataSources` in shared/src/licences.ts; a new kind of source gets its own `add` there, and its test here.",
    ).toEqual([
      "basemap:protomaps",
      "basemap:osm",
      "basemap:osm-topo",
      "basemap:osm-cycle",
      "basemap:six-topo",
      "basemap:six-base",
      "basemap:six-imagery",
      "dem:terrarium",
      "geocoder",
      "weather",
      "dem:sharpened",
      "dem:nsw-5m",
      "terrain:nsw-5m-slope",
      "terrain:nsw-5m-hillshade",
      "terrain:nsw-contours",
      "terrain:nsw-land",
      "terrain:nsw-fire",
      "terrain:nsw-coverage",
      "vector:nsw",
      "canyons:nsw",
      "gauges:nsw",
      "placeSearch:nsw",
    ]);
    expect(NSW_ONLY.length).toBeGreaterThanOrEqual(22);
  });

  // Mutation: leave a Terrain archive (the land, say) out of the flattening,
  // or stop adding a region's vector cut.
  it("tags every source of every simulated region, and the world's", () => {
    let checked = 0;
    for (const region of [...SIM_REGIONS, SIM_WORLD]) {
      const declared = [
        ...region.dem.map(({ id }) => `dem:${id}`),
        ...Object.entries(region.terrain)
          .filter(([key]) => key !== "heights")
          .map(([, archive]) => `terrain:${archive.id}`),
        ...(region.vector ? [`vector:${region.id}`] : []),
      ];
      checked += declared.length;
      for (const id of declared) {
        const found = WITH_SIM.find((source) => source.id === id);
        expect(found, id).toBeDefined();
        expect(LICENCES[found!.licence], id).toBeDefined();
      }
    }
    expect(checked).toBeGreaterThanOrEqual(18);
    expect(WITH_SIM.length).toBeGreaterThan(NSW_ONLY.length + 15);
  });

  // Mutation: add the Terrarium tiles whatever the world declares, and a
  // world with an archive of its own lists tiles the app no longer reads.
  it("lists the public worldwide height tiles only while the world has no archive of its own", () => {
    expect(ids(NSW_ONLY)).toContain("dem:terrarium");
    expect(ids(WITH_SIM)).not.toContain("dem:terrarium");
    expect(ids(WITH_SIM)).toContain("dem:simworld-heights");
  });

  // Mutation: set NSW's `gaugesLicence` to null, or give a simulated region
  // a `placeSearchLicence` with no `placeSearch`.
  it("has a licence for a feed or a registry exactly where it has one", () => {
    const regions: Region[] = [...REGIONS, WORLD, ...SIM_REGIONS, SIM_WORLD];
    for (const region of regions) {
      expect(region.gaugesLicence === null, region.id).toBe(
        region.gauges === null,
      );
      expect(region.placeSearchLicence === null, region.id).toBe(
        region.placeSearch === null,
      );
    }
    expect(regions.filter((r) => r.gauges !== null).length).toBeGreaterThan(0);
    expect(
      regions.filter((r) => r.placeSearch !== null).length,
    ).toBeGreaterThan(0);
  });

  // Mutation: leave a declared feed, registry or vector cut out of
  // `dataSources`' default list.
  it("lists, by default, every source of every region that is declared", () => {
    const listed = ids(dataSources());
    expect(REGIONS.length).toBeGreaterThan(0);
    for (const region of REGIONS) {
      expect(listed).toContain(`vector:${region.id}`);
      if (region.gauges !== null)
        expect(listed).toContain(`gauges:${region.id}`);
      if (region.placeSearch !== null)
        expect(listed).toContain(`placeSearch:${region.id}`);
    }
  });

  // Mutation: skip a region whose feed has no licence instead of throwing.
  it("refuses a feed or a registry with no licence", () => {
    const feed = { ...NSW_REGION, id: "madeup", gaugesLicence: null };
    const registry = { ...NSW_REGION, id: "madeup", placeSearchLicence: null };
    expect(() => dataSources([feed], WORLD)).toThrow(/madeup.*gauge feed/);
    expect(() => dataSources([registry], WORLD)).toThrow(
      /madeup.*place registry/,
    );
  });

  // Mutation: tag one simulated archive with another licence (Utah's heights
  // `cc0`, a vector cut `cc-by-4`), or leave an invented layer under a real
  // publisher's. The ground's licences are the publishers' (LINZ's CC BY 4.0
  // model for New Zealand, USGS's public domain for Utah, Copernicus for the
  // world's, OpenStreetMap's ODbL for every vector cut); the land, fire and
  // coverage layers are invented, so `cc0`.
  it("tags each simulated archive by where its ground comes from", () => {
    const tagged = new Map(WITH_SIM.map((s) => [s.id, s.licence]));
    const expected: Record<string, string> = {
      "dem:simnz-heights": "cc-by-4",
      "terrain:simnz-slope": "cc-by-4",
      "terrain:simnz-hillshade": "cc-by-4",
      "terrain:simnz-contours": "cc-by-4",
      "vector:simnz": "odbl",
      "terrain:simnz-land": "cc0",
      "terrain:simnz-fire": "cc0",
      "terrain:simnz-coverage": "cc0",
      "dem:simutah-heights": "us-public-domain",
      "terrain:simutah-slope": "us-public-domain",
      "terrain:simutah-hillshade": "us-public-domain",
      "terrain:simutah-contours": "us-public-domain",
      "vector:simutah": "odbl",
      "terrain:simutah-land": "cc0",
      "terrain:simutah-fire": "cc0",
      "dem:simworld-heights": "copernicus-dem",
      "terrain:simworld-hillshade": "copernicus-dem",
      "vector:world": "odbl",
    };
    expect(Object.keys(expected).length).toBe(18);
    for (const [id, licence] of Object.entries(expected))
      expect(tagged.get(id), id).toBe(licence);
  });

  // Mutation: set one region's `vector.licence` to `cc-by-4`, and it differs
  // from the "protomaps" catalogue entry's, which credits the same
  // OpenStreetMap data.
  it("gives every region's vector cut the licence the Protomaps basemap carries", () => {
    const protomaps = BASEMAP_CATALOG.find((entry) => entry.id === "protomaps");
    expect(protomaps).toBeDefined();
    const withVector = [...REGIONS_WITH_SIMULATED, WORLD, SIM_WORLD].filter(
      (region) => region.vector !== null,
    );
    expect(withVector.length).toBeGreaterThanOrEqual(4);
    for (const region of withVector)
      expect(region.vector!.licence, region.id).toBe(protomaps!.licence);
  });

  // Mutation: tag the land layer `cc-by-3-au`, whose name its credit does not hold.
  it("tags a height source or archive with the licence its credit names", () => {
    const named = EVERY_DECLARED.filter(
      (source) => source.credit?.match(/CC BY \d\.\d(?: AU)?/) != null,
    );
    expect(named.length).toBeGreaterThanOrEqual(7);
    for (const source of named) {
      const names = source.credit!.match(/CC BY \d\.\d(?: AU)?/g)!;
      expect(names, source.id).toContain(LICENCES[source.licence].name);
    }
  });

  // Mutation: write a licence into `sharpenedDemSource` instead of
  // `SHARPENED_LICENCE`, or tag the kind `cc-by-4`.
  it("lists the sharpened heights once, under the licence the source carries", () => {
    const area: SharpenedArea = {
      id: "a",
      zmax: 16,
      tiles15: [30100, 19400, 30103, 19403],
      coverage: [150.7, -33.8, 150.72, -33.78],
      contours: true,
      credit: "Elevation: made up for this test.",
      createdAt: "2026-10-20T00:00:00.000Z",
    };
    const listed = NSW_ONLY.find((source) => source.id === "dem:sharpened");
    expect(listed?.licence).toBe(SHARPENED_LICENCE);
    expect(sharpenedDemSource(area).licence).toBe(listed?.licence);
  });

  // Mutation: change the licence's name in NSW's `sharpen.credit`, or tag the
  // kind with a licence its credit does not name.
  it("names the sharpened heights' licence in the region's sharpen credit", () => {
    const credits = REGIONS.flatMap((region) =>
      region.sharpen.mode === "upload" ? [region.sharpen.credit] : [],
    );
    expect(credits.length).toBeGreaterThanOrEqual(1);
    expect(
      credits.some((c) => c.includes(`${LICENCES[SHARPENED_LICENCE].name}.`)),
    ).toBe(true);
  });
});

describe("sourcesNeedingReplacement", () => {
  // Mutation: tag RopeWiki's list `cc-by-4`, or mark `open-meteo-free`'s
  // `commercialUse` true. A commercial Logjam replaces each of these or gets
  // its owner's permission.
  it("is exactly the canyon list, the gauge feed and the free forecast", () => {
    expect(ids(sourcesNeedingReplacement(NSW_ONLY))).toEqual([
      "weather",
      "canyons:nsw",
      "gauges:nsw",
    ]);
    expect(ids(sourcesNeedingReplacement(WITH_SIM))).toEqual(
      ids(sourcesNeedingReplacement(NSW_ONLY)),
    );
  });

  // Mutation: tag the worldwide height tiles `open-meteo-free`.
  it("leaves the worldwide height tiles, the geocoder and every basemap out", () => {
    const needing = ids(sourcesNeedingReplacement(NSW_ONLY));
    expect(needing).not.toContain(`dem:${TERRARIUM.id}`);
    expect(needing).not.toContain("geocoder");
    expect(needing.filter((id) => id.startsWith("basemap:"))).toEqual([]);
  });
});
