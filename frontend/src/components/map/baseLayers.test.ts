import { describe, expect, it } from "vitest";
import { baseLayersFor } from "./baseLayers";

describe("baseLayersFor", () => {
  // Mutation: drop a basemap from NSW's `basemaps`, or list "osm" again, and
  // an NSW account's gallery is no longer today's.
  it("gives an NSW account the gallery it has always had", () => {
    expect(baseLayersFor(["nsw"]).map((layer) => layer.id)).toEqual([
      "protomaps",
      "osm-topo",
      "osm-cycle",
      "six-topo",
      "six-base",
      "six-imagery",
    ]);
  });
});
