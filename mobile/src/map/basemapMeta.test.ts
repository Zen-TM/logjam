import { describe, expect, it } from "vitest";
import { pointBox } from "@logjam/shared";

import {
  defaultBasemap,
  effectiveBasemap,
  knownBasemaps,
  mobileBasemaps,
  settledView,
} from "./basemapMeta";
import { resolveMapSource } from "./sourceResolver";

const inNsw = pointBox(150.3, -33.7);
// The Tasman Sea: outside every region.
const atSea = pointBox(160, -40);

describe("the basemaps Logjam GPS offers", () => {
  // Mutation: change a catalogue entry's order or `offered`, or a region's
  // `defaultBasemap`, and NSW users' picker or opening map changes.
  it("are, over NSW, the list and default Logjam GPS always had", () => {
    expect(mobileBasemaps(inNsw)).toEqual([
      "protomaps",
      "osm-topo",
      "osm-cycle",
      "six-topo",
      "six-base",
      "six-imagery",
    ]);
    expect(defaultBasemap(["nsw"])).toBe("six-topo");
  });

  // Mutation: list by the account's chosen regions again, and a phone carried
  // out of NSW still offers SIX Maps there.
  it("leave out NSW's own over ground outside it", () => {
    expect(mobileBasemaps(atSea)).toEqual(["osm-topo", "osm-cycle"]);
  });

  // Mutation: add a catalogue entry to a region without teaching the
  // resolver the id, and resolveMapSource throws on it.
  it("are all ids the resolver draws", () => {
    const ids = knownBasemaps();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const [source] = resolveMapSource(
        { kind: "basemap", basemapId: id },
        { connectivity: "online", artifacts: [], cdnBaseUrl: "https://cdn" },
      );
      expect(source?.status, id).toBe("ok");
    }
  });
});

describe("the basemap in use while the map moves", () => {
  // Mutation: return `picked` unconditionally, and a basemap the view does not
  // offer keeps drawing blank after the map leaves its region.
  it("is the pick while the view offers it, else the default there", () => {
    expect(effectiveBasemap("osm-cycle", inNsw)).toBe("osm-cycle");
    expect(effectiveBasemap("six-imagery", inNsw)).toBe("six-imagery");
    expect(effectiveBasemap("six-imagery", atSea)).toBe("osm-topo");
    expect(effectiveBasemap("six-imagery", atSea)).toBe(
      effectiveBasemap("no-such-basemap", atSea),
    );
  });
});

describe("the view a map offers basemaps for", () => {
  // Mutation: return `start` always, and the gallery stays on the opening
  // ground while the map is panned elsewhere.
  it("is the last settle's bounds, else the start", () => {
    expect(settledView(null, inNsw)).toBe(inNsw);
    expect(settledView([150, -34, 151, -33], inNsw)).toEqual({
      west: 150,
      south: -34,
      east: 151,
      north: -33,
    });
  });
});
