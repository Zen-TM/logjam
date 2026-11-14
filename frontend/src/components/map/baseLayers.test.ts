import { pointBox } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { baseLayersFor, basemapPicked, viewForBasemaps } from "./baseLayers";

const ids = (view: Parameters<typeof baseLayersFor>[0]) =>
  baseLayersFor(view).map((layer) => layer.id);
const inNsw = pointBox(150.3, -33.7);
const overNz = pointBox(169.1, -44.62);

describe("baseLayersFor", () => {
  // Mutation: drop a basemap from NSW's `basemaps`, or list "osm" again, and
  // a map over NSW is no longer today's gallery.
  it("gives a map over NSW the gallery it has always had", () => {
    expect(ids(inNsw)).toEqual([
      "protomaps",
      "osm-topo",
      "osm-cycle",
      "six-topo",
      "six-base",
      "six-imagery",
    ]);
  });

  // Mutation: list by the account's chosen regions again (a constant "nsw"),
  // and a map panned to New Zealand still offers NSW's sheets.
  it("leaves out NSW's own basemaps over ground outside it", () => {
    expect(ids(overNz)).toEqual(["osm-topo", "osm-cycle"]);
  });
});

describe("viewForBasemaps", () => {
  // Mutation: return `next` always, and every pan makes a new view, so the
  // page redraws on each one.
  it("keeps the view while a pan offers the same basemaps", () => {
    const next = pointBox(151.2, -33.87);
    expect(viewForBasemaps(inNsw, next)).toBe(inNsw);
  });

  // Mutation: return `prev` always, and the gallery stays on NSW's after the
  // map leaves it.
  it("takes the new view once the offer changes", () => {
    expect(viewForBasemaps(inNsw, overNz)).toBe(overNz);
  });
});

describe("basemapPicked", () => {
  // Mutation: return `basemapHere`'s answer for an unoffered pick, and a stored
  // raster "Default" over NSW shows SIX Maps Topo where it showed the vector
  // map.
  it("shows the vector map for a pick not offered over NSW", () => {
    expect(basemapPicked("osm", inNsw)).toBe("protomaps");
    expect(basemapPicked("removed", inNsw)).toBe("protomaps");
  });

  // Mutation: return "protomaps" whatever the view, and over ground outside
  // our archive a stale pick shows a vector map that draws nothing there.
  it("shows the worldwide default where the vector map is not offered", () => {
    expect(basemapPicked("osm", overNz)).toBe("osm-topo");
  });

  // Mutation: always return the vector map, and a pick the view offers is
  // swapped for it.
  it("keeps a pick the view offers", () => {
    expect(basemapPicked("six-topo", inNsw)).toBe("six-topo");
  });
});
