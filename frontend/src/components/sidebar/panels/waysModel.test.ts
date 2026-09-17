import { describe, expect, it } from "vitest";
import {
  buildWays,
  WAY_KIND_LABELS,
  WAY_KINDS,
  wayKindCounts,
  wayMatchesSearch,
  type WayItem,
} from "./waysModel";
import type { PlaceTrack, TRoute } from "../../../placeUtils";
import type { StandaloneFile } from "@logjam/shared";

const ME = "user-me";
const THEM = "user-them";

const route = (over: Partial<TRoute> = {}): TRoute => ({
  id: "r1",
  ownerId: ME,
  placeId: null,
  name: "Claustral",
  color: "#e6194b",
  // Two points a degree apart, so the length is non-zero and stable.
  points: [
    [150, -33],
    [150.1, -33],
  ],
  anchors: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const file = (over: Partial<StandaloneFile> = {}): StandaloneFile => ({
  id: "f1",
  mediaType: "application/gpx+xml",
  filename: "walk.gpx",
  displayName: null,
  fileSizeBytes: 1000,
  color: "#3cb44b",
  origin: "import",
  metadata: {},
  linkedPlaceId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const placeTrack = (over: Partial<PlaceTrack> = {}): PlaceTrack => ({
  placeId: "p1",
  mediaId: "m1",
  color: "#ffe119",
  displayUrl: "https://example.invalid/track.gpx",
  ...over,
});

const build = (args: {
  routes?: TRoute[];
  standaloneFiles?: StandaloneFile[];
  placeTracks?: PlaceTrack[];
  currentUserId?: string | null;
}): WayItem[] =>
  buildWays({
    routes: args.routes ?? [],
    standaloneFiles: args.standaloneFiles ?? [],
    placeTracks: args.placeTracks ?? [],
    currentUserId: args.currentUserId === undefined ? ME : args.currentUserId,
    placeName: (id) => `Place ${id}`,
  });

describe("WAY_KINDS", () => {
  // Two lists that must agree: a kind with no word for it would render a blank
  // chip rather than fail.
  it("labels every kind", () => {
    expect(Object.keys(WAY_KIND_LABELS).sort()).toEqual([...WAY_KINDS].sort());
  });
});

describe("buildWays", () => {
  it("takes a file's kind from its own origin", () => {
    const ways = build({
      standaloneFiles: [
        file({ id: "a", origin: "track" }),
        file({ id: "b", origin: "import" }),
      ],
    });
    expect(ways.map((way) => way.kind)).toEqual(["track", "import"]);
  });

  it("measures a route from its geometry", () => {
    const [way] = build({ routes: [route()] });
    expect(way.kind).toBe("route");
    expect(way.distanceM).toBeGreaterThan(0);
  });

  it("carries a recorded file's distance and leaves an import's null", () => {
    const ways = build({
      standaloneFiles: [
        file({ id: "a", origin: "track", metadata: { distanceM: 7420 } }),
        file({ id: "b", origin: "import" }),
      ],
    });
    expect(ways.map((way) => way.distanceM)).toEqual([7420, null]);
  });

  it("marks a route owned by someone else as shared", () => {
    const ways = build({
      routes: [route({ id: "mine" }), route({ id: "theirs", ownerId: THEM })],
    });
    expect(ways.map((way) => way.shared)).toEqual([false, true]);
  });

  // Before the id is known, nothing can be called someone else's — saying so
  // would put a "shared" mark on every row the user drew.
  it("claims nothing is shared until the current user is known", () => {
    const ways = build({ routes: [route({ ownerId: THEM })], currentUserId: null });
    expect(ways[0].shared).toBe(false);
  });

  it("names a place's track after its place", () => {
    const [way] = build({ placeTracks: [placeTrack()] });
    expect(way).toMatchObject({ kind: "place", title: "Place p1", placeId: "p1", shared: true });
  });

  // The two endpoints overlap: a file of the user's own linked to their own
  // place comes back from both, and the row that survives must be the one that
  // knows the file's name.
  it("lists a file on the user's own place once, by name", () => {
    const ways = build({
      standaloneFiles: [file({ id: "m1", displayName: "Du Faur approach", linkedPlaceId: "p1" })],
      placeTracks: [placeTrack({ mediaId: "m1", placeId: "p1" })],
    });
    expect(ways).toHaveLength(1);
    expect(ways[0]).toMatchObject({ kind: "import", title: "Du Faur approach" });
  });

  // A friend's place's track is not among the user's own files, so it must
  // survive the de-duplication — it appears on no other page.
  it("keeps a track on a place a friend shared", () => {
    const ways = build({
      standaloneFiles: [file({ id: "mine" })],
      placeTracks: [placeTrack({ mediaId: "theirs" })],
    });
    expect(ways.map((way) => way.kind)).toEqual(["import", "place"]);
  });

  it("gives every row a key unique across the kinds", () => {
    const ways = build({
      routes: [route({ id: "shared-id" })],
      standaloneFiles: [file({ id: "shared-id" })],
      placeTracks: [placeTrack({ mediaId: "other" })],
    });
    expect(new Set(ways.map((way) => way.key)).size).toBe(ways.length);
  });
});

describe("wayMatchesSearch", () => {
  const way = build({ routes: [route({ name: "Claustral Canyon" })] })[0];

  it("matches part of a name, ignoring case and surrounding space", () => {
    expect(wayMatchesSearch(way, "claustral")).toBe(true);
    expect(wayMatchesSearch(way, "  CANYON  ")).toBe(true);
  });

  it("does not match something else", () => {
    expect(wayMatchesSearch(way, "wollangambe")).toBe(false);
  });

  it("matches everything when nothing is typed", () => {
    expect(wayMatchesSearch(way, "")).toBe(true);
    expect(wayMatchesSearch(way, "   ")).toBe(true);
  });
});

describe("wayKindCounts", () => {
  it("counts each kind and the whole list", () => {
    const counts = wayKindCounts(
      build({
        routes: [route({ id: "a" }), route({ id: "b" })],
        standaloneFiles: [file({ id: "c", origin: "track" })],
        placeTracks: [placeTrack()],
      }),
    );
    expect(counts).toEqual({ all: 4, route: 2, track: 1, import: 0, place: 1 });
  });
});
