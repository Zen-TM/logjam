import { describe, expect, it, vi } from "vitest";

vi.mock("../prefsDb", () => ({
  readPref: vi.fn(() => "six-imagery"),
  writePref: vi.fn(() => true),
}));
vi.mock("../regionsPreference", () => ({ readRegions: () => ["nsw"] }));

const { pickPointStart } = await import("./pickPointStart");

const HOME = { center: [150.3, -33.7] as [number, number], zoom: 11 };
// The main map looking over the sea, where it drew OSM Topo in place of the pick.
const LAST = {
  center: [160, -40] as [number, number],
  zoom: 6,
  basemapId: "osm-topo",
};

describe("where Pick a point opens", () => {
  // Mutation: seed the basemap from `lastCamera.basemapId`, and a pick the
  // main map could not draw there is forgotten on this screen, so panning
  // back to ground that offers it does not bring it back.
  it("starts on the stored pick, not the basemap the main map drew", () => {
    expect(pickPointStart(null, LAST, HOME).pickedBasemapId).toBe(
      "six-imagery",
    );
  });

  // Mutation: prefer `lastCamera` over the typed point, and "nudge what I
  // typed" opens somewhere else.
  it("opens on the typed point, else the last camera, else home", () => {
    const typed = { latitude: -33.8, longitude: 151.2 };
    expect(pickPointStart(typed, LAST, HOME)).toMatchObject({
      center: [151.2, -33.8],
      zoom: 15,
    });
    expect(pickPointStart(null, LAST, HOME)).toMatchObject({
      center: [160, -40],
      zoom: 6,
    });
    expect(pickPointStart(null, null, HOME)).toMatchObject({
      center: [150.3, -33.7],
      zoom: 11,
    });
  });
});
