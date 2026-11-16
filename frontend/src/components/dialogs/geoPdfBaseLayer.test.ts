// @vitest-environment node
import { NSW_REGION, REGIONS } from "@logjam/shared";
import { describe, expect, it, vi } from "vitest";

// The simulated regions are read once, when @logjam/shared loads, so the
// switch is set before the imports below run.
vi.hoisted(() => {
  (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS = true;
});

import {
  baseLayerHere,
  printableBaseLayersFor,
  seedBaseLayer,
  sheetBox,
} from "./geoPdfBaseLayer";

// Made-up boxes: Katoomba (NSW), inside the first simulated New Zealand box,
// inside simulated Utah's, and open ocean (the world patch).
const KATOOMBA = { north: -33.7, south: -33.76, east: 150.36, west: 150.3 };
const NZ = { north: -44.03, south: -44.08, east: 169.28, west: 169.22 };
const UTAH = { north: 37.32, south: 37.27, east: -112.9, west: -112.95 };
const OCEAN = { north: -10, south: -10.1, east: -140, west: -140.1 };
const ids = (box: Parameters<typeof printableBaseLayersFor>[0]) =>
  printableBaseLayersFor(box).map((layer) => layer.id);

describe("the base layers a sheet can be printed from", () => {
  // A floor: the boxes above are inside the two simulated regions and the world
  // patch, so a list without them would test nothing. Mutation: delete the
  // `vi.hoisted` line that sets the switch, and `REGIONS` is New South Wales alone.
  it("reads the simulated regions", () => {
    expect(REGIONS.length).toBeGreaterThanOrEqual(3);
  });

  // Mutation: return `PRINTABLE_BASE_LAYERS` from `printableBaseLayersFor`
  // whatever the box, and a sheet over New Zealand lists the three SIX maps.
  it("lists no SIX map outside New South Wales, and the same set inside", () => {
    expect(ids(KATOOMBA)).toEqual([
      "protomaps",
      "osm-topo",
      "six-topo",
      "six-base",
      "six-imagery",
    ]);
    for (const box of [NZ, UTAH, OCEAN]) {
      expect(ids(box)).toEqual(["protomaps", "osm-topo"]);
    }
  });

  // Mutation: have `offeredIn` return an empty set for a null box, so a form
  // with no ground known lists nothing to print from.
  it("lists every printable basemap while no ground is known", () => {
    expect(ids(null)).toEqual([
      "protomaps",
      "osm-topo",
      "six-topo",
      "six-base",
      "six-imagery",
    ]);
  });
});

describe("the base layer a sheet is printed from", () => {
  // Mutation: return `picked` unchecked from `baseLayerHere`, and a sheet over
  // New Zealand prints from the SIX map picked over New South Wales.
  it("keeps a pick the ground prints, and falls to the ground's default otherwise", () => {
    expect(baseLayerHere("six-imagery", KATOOMBA)).toBe("six-imagery");
    expect(baseLayerHere("osm-topo", NZ)).toBe("osm-topo");
    expect(baseLayerHere("six-imagery", NZ)).toBe("osm-topo");
    expect(baseLayerHere("six-topo", OCEAN)).toBe("osm-topo");
    expect(baseLayerHere("osm-cycle", KATOOMBA)).toBe(
      NSW_REGION.defaultBasemap,
    );
  });

  // Mutation: read `FALLBACK_BASE_LAYER` whatever the ground, and the sheet
  // over Utah opens on "six-topo", which prints nothing there.
  it("opens on the ground's own default when neither the map's layer nor the last printed one prints there", () => {
    expect(seedBaseLayer("osm-cycle", UTAH, "six-base")).toBe("osm-topo");
    expect(seedBaseLayer("osm-cycle", KATOOMBA)).toBe("six-topo");
    expect(seedBaseLayer("osm-topo", UTAH, "six-base")).toBe("osm-topo");
    expect(seedBaseLayer("osm-cycle", NZ, "protomaps")).toBe("protomaps");
  });

  // Mutation: return the centre's point box before the area in `sheetBox`,
  // and a sheet whose area is set reads the ground under the map's centre.
  it("reads the area once set, else the point the form opened over", () => {
    expect(sheetBox(NZ, { lat: -33.7, lng: 150.3 })).toBe(NZ);
    expect(sheetBox(null, { lat: -33.7, lng: 150.3 + 360 })).toEqual({
      north: -33.7,
      south: -33.7,
      east: 150.3,
      west: 150.3,
    });
    expect(sheetBox(null, null)).toBeNull();
  });
});
