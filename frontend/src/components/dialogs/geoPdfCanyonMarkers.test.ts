import { describe, it, expect } from "vitest";
import { buildCanyonMarkers } from "./geoPdfCanyonMarkers";
import type { MarkerExtent } from "./geoPdfCanyonMarkers";

// PRIV-006 export-default privacy boundary: friends' shared canyons must
// never reach a printable GeoPDF unless the user explicitly opted in.
const EXTENT: MarkerExtent = {
  north: -33.0,
  south: -34.0,
  east: 151.0,
  west: 150.0,
};

const ownedIn = { latitude: -33.5, longitude: 150.5, name: "Owned In" };
const ownedOut = { latitude: -35.0, longitude: 150.5, name: "Owned Out" };
const sharedIn = { latitude: -33.6, longitude: 150.6, name: "Friend Canyon" };
const sharedOut = { latitude: -33.6, longitude: 152.0, name: "Friend Far" };

describe("buildCanyonMarkers", () => {
  it("never emits shared canyons when includeShared is false, regardless of extent", () => {
    const markers = buildCanyonMarkers(
      [ownedIn, ownedOut],
      [sharedIn, sharedOut],
      EXTENT,
      { includeOwned: true, includeShared: false },
    );
    expect(markers).toEqual([
      { lat: -33.5, lon: 150.5, name: "Owned In", color: "owned" },
    ]);
    expect(JSON.stringify(markers)).not.toContain("Friend");
  });

  it("includes in-extent shared canyons with color 'shared' when opted in", () => {
    const markers = buildCanyonMarkers([], [sharedIn, sharedOut], EXTENT, {
      includeOwned: true,
      includeShared: true,
    });
    expect(markers).toEqual([
      { lat: -33.6, lon: 150.6, name: "Friend Canyon", color: "shared" },
    ]);
  });

  it("never emits owned canyons when includeOwned is false", () => {
    const markers = buildCanyonMarkers([ownedIn], [sharedIn], EXTENT, {
      includeOwned: false,
      includeShared: true,
    });
    expect(markers).toEqual([
      { lat: -33.6, lon: 150.6, name: "Friend Canyon", color: "shared" },
    ]);
  });

  it("filters out-of-extent canyons on every edge", () => {
    const north = { latitude: -32.9, longitude: 150.5, name: "N" };
    const south = { latitude: -34.1, longitude: 150.5, name: "S" };
    const east = { latitude: -33.5, longitude: 151.1, name: "E" };
    const west = { latitude: -33.5, longitude: 149.9, name: "W" };
    const markers = buildCanyonMarkers(
      [north, south, east, west],
      [],
      EXTENT,
      { includeOwned: true, includeShared: true },
    );
    expect(markers).toEqual([]);
  });

  it("includes canyons exactly on the extent boundary (inclusive edges)", () => {
    const onCorner = { latitude: -34.0, longitude: 151.0, name: "Corner" };
    const markers = buildCanyonMarkers([onCorner], [], EXTENT, {
      includeOwned: true,
      includeShared: true,
    });
    expect(markers).toHaveLength(1);
    expect(markers[0].name).toBe("Corner");
  });

  it("returns [] for empty or undefined inputs (caller omits canyonMarkers from the config)", () => {
    expect(
      buildCanyonMarkers([], [], EXTENT, {
        includeOwned: true,
        includeShared: true,
      }),
    ).toEqual([]);
    expect(
      buildCanyonMarkers(undefined, undefined, EXTENT, {
        includeOwned: true,
        includeShared: true,
      }),
    ).toEqual([]);
  });
});
