import { describe, expect, it } from "vitest";
import { offeredBasemaps, REGIONS } from "@logjam/shared";

import {
  defaultBasemap,
  effectiveBasemap,
  mobileBasemaps,
} from "./basemapMeta";
import { resolveMapSource, type BasemapId } from "./sourceResolver";

describe("the basemaps Logjam GPS offers", () => {
  // Mutation: change a catalogue entry's order or `offered`, or a region's
  // `defaultBasemap`, and NSW users' picker or opening map changes.
  it("are, for NSW, the list and default Logjam GPS always had", () => {
    expect(mobileBasemaps(["nsw"])).toEqual([
      "protomaps",
      "osm-topo",
      "osm-cycle",
      "six-topo",
      "six-base",
      "six-imagery",
    ]);
    expect(defaultBasemap(["nsw"])).toBe("six-topo");
  });

  // Mutation: add a catalogue entry to a region without teaching the
  // resolver (and `BasemapId`) the id, and resolveMapSource throws on it.
  it("are all ids the resolver draws", () => {
    const ids = new Set([
      ...offeredBasemaps([]),
      ...offeredBasemaps(REGIONS.map((region) => region.id)),
    ]);
    for (const { id } of ids) {
      const [source] = resolveMapSource(
        { kind: "basemap", basemapId: id as BasemapId },
        { connectivity: "online", artifacts: [], cdnBaseUrl: "https://cdn" },
      );
      expect(source?.status, id).toBe("ok");
    }
  });
});

describe("the basemap in use while regions change under an open map", () => {
  // Mutation: return `picked` unconditionally, and a basemap no chosen region
  // offers keeps drawing after its region is unchosen.
  it("is the pick while a chosen region offers it, else the default", () => {
    expect(effectiveBasemap("osm-cycle", ["nsw"])).toBe("osm-cycle");
    // A region id nothing offers stands in for "unchosen": only the worldwide
    // maps remain, so the NSW-only pick falls to that choice's default.
    expect(effectiveBasemap("six-imagery", [])).toBe(defaultBasemap([]));
    expect(mobileBasemaps([])).not.toContain("six-imagery");
    // The pick is not rewritten: choosing the region again restores it.
    expect(effectiveBasemap("six-imagery", ["nsw"])).toBe("six-imagery");
  });
});
