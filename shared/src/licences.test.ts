import { describe, expect, it } from "vitest";

import { TERRARIUM } from "./demSources.js";
import {
  dataSources,
  LICENCES,
  sourcesNeedingReplacement,
  type DataSource,
} from "./licences.js";
import { NSW_REGION, WORLD, type Region } from "./regions.js";
import { sharpenedDemSource, type SharpenedArea } from "./sharpen.js";
import { SIM_REGIONS, SIM_WORLD } from "./simRegions.js";

const NSW_ONLY = dataSources([NSW_REGION], WORLD);
const WITH_SIM = dataSources([NSW_REGION, ...SIM_REGIONS], SIM_WORLD);
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
    expect(NSW_ONLY.length).toBeGreaterThanOrEqual(21);
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

  // Mutation: set NSW's `gaugesLicence` to null, or give a simulated region
  // a `placeSearchLicence` with no `placeSearch`.
  it("has a licence for a feed or a registry exactly where it has one", () => {
    const regions: Region[] = [NSW_REGION, ...SIM_REGIONS, SIM_WORLD, WORLD];
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

  // Mutation: tag the land layer `cc-by-3-au`, whose name its credit does not hold.
  it("tags a height source or archive with the licence its credit names", () => {
    const named = WITH_SIM.filter(
      (source) => source.credit?.match(/CC BY \d\.\d(?: AU)?/) != null,
    );
    expect(named.length).toBeGreaterThanOrEqual(7);
    for (const source of named) {
      const names = source.credit!.match(/CC BY \d\.\d(?: AU)?/g)!;
      expect(names, source.id).toContain(LICENCES[source.licence].name);
    }
  });

  // Mutation: tag the sharpened source `cc-by-4`.
  it("tags a sharpened area with the licence of the LiDAR its credit names", () => {
    const area: SharpenedArea = {
      id: "a",
      zmax: 16,
      tiles15: [30100, 19400, 30103, 19403],
      coverage: [150.7, -33.8, 150.72, -33.78],
      contours: true,
      credit: "Elevation: derived from a LiDAR survey. CC BY 3.0 AU.",
      createdAt: "2026-10-20T00:00:00.000Z",
    };
    const source = sharpenedDemSource(area);
    expect(source.credit).toContain(LICENCES[source.licence].name);
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
