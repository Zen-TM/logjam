import { describe, it, expect } from "vitest";
import { buildPlaceMarkers } from "./geoPdfPlaceMarkers";
import type { MarkerExtent } from "./geoPdfPlaceMarkers";

// PRIV-006 export-default privacy boundary: friends' shared places must
// never reach a printable GeoPDF unless the user explicitly opted in.
const EXTENT: MarkerExtent = {
  north: -33.0,
  south: -34.0,
  east: 151.0,
  west: 150.0,
};

const ownedIn = { latitude: -33.5, longitude: 150.5, name: "Owned In" };
const ownedOut = { latitude: -35.0, longitude: 150.5, name: "Owned Out" };
const sharedIn = { latitude: -33.6, longitude: 150.6, name: "Friend Place" };
const sharedOut = { latitude: -33.6, longitude: 152.0, name: "Friend Far" };

describe("buildPlaceMarkers", () => {
  it("never emits shared places when includeShared is false, regardless of extent", () => {
    const markers = buildPlaceMarkers(
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

  it("includes in-extent shared places with color 'shared' when opted in", () => {
    const markers = buildPlaceMarkers([], [sharedIn, sharedOut], EXTENT, {
      includeOwned: true,
      includeShared: true,
    });
    expect(markers).toEqual([
      { lat: -33.6, lon: 150.6, name: "Friend Place", color: "shared" },
    ]);
  });

  it("never emits owned places when includeOwned is false", () => {
    const markers = buildPlaceMarkers([ownedIn], [sharedIn], EXTENT, {
      includeOwned: false,
      includeShared: true,
    });
    expect(markers).toEqual([
      { lat: -33.6, lon: 150.6, name: "Friend Place", color: "shared" },
    ]);
  });

  it("filters out-of-extent places on every edge", () => {
    const north = { latitude: -32.9, longitude: 150.5, name: "N" };
    const south = { latitude: -34.1, longitude: 150.5, name: "S" };
    const east = { latitude: -33.5, longitude: 151.1, name: "E" };
    const west = { latitude: -33.5, longitude: 149.9, name: "W" };
    const markers = buildPlaceMarkers(
      [north, south, east, west],
      [],
      EXTENT,
      { includeOwned: true, includeShared: true },
    );
    expect(markers).toEqual([]);
  });

  it("includes places exactly on the extent boundary (inclusive edges)", () => {
    const onCorner = { latitude: -34.0, longitude: 151.0, name: "Corner" };
    const markers = buildPlaceMarkers([onCorner], [], EXTENT, {
      includeOwned: true,
      includeShared: true,
    });
    expect(markers).toHaveLength(1);
    expect(markers[0].name).toBe("Corner");
  });

  it("returns [] for empty or undefined inputs (caller omits placeMarkers from the config)", () => {
    expect(
      buildPlaceMarkers([], [], EXTENT, {
        includeOwned: true,
        includeShared: true,
      }),
    ).toEqual([]);
    expect(
      buildPlaceMarkers(undefined, undefined, EXTENT, {
        includeOwned: true,
        includeShared: true,
      }),
    ).toEqual([]);
  });
});
