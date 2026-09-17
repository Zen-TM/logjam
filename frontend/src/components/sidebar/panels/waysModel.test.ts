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
  filename: "their-file.gpx",
  displayName: null,
  origin: "import",
  fileSizeBytes: 2000,
  metadata: {},
  ...over,
});

const build = (args: {
  routes?: TRoute[];
  standaloneFiles?: StandaloneFile[];
  placeTracks?: PlaceTrack[];
  currentUserId?: string | null;
  sharedPlaceIds?: string[];
}): WayItem[] =>
  buildWays({
    routes: args.routes ?? [],
    standaloneFiles: args.standaloneFiles ?? [],
    placeTracks: args.placeTracks ?? [],
    currentUserId: args.currentUserId === undefined ? ME : args.currentUserId,
    sharedPlaceIds: new Set(args.sharedPlaceIds ?? []),
  });

describe("WAY_KINDS", () => {
  // Two lists that must agree: a kind with no word for it would render a blank
  // chip rather than fail.
  it("labels every kind", () => {
    expect(Object.keys(WAY_KIND_LABELS).sort()).toEqual([...WAY_KINDS].sort());
  });

  // Where a way lives is a property of the row. It was briefly a fourth chip,
  // which put "what a thing is" and "where it lives" on one axis.
  it("names only what a way IS", () => {
    expect([...WAY_KINDS]).toEqual(["route", "track", "import"]);
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

  // Opening a way fits the map to it, so every kind has to know its own extent
  // — a route from the geometry in hand, a file from the bbox its row carries.
  it("bounds a route from its points and a file from its bbox", () => {
    const [drawn] = build({ routes: [route()] });
    expect(drawn.bounds).toEqual([150, -33, 150.1, -33]);

    const [imported] = build({
      standaloneFiles: [file({ metadata: { bbox: [150.2, -33.6, 150.3, -33.5] } })],
    });
    expect(imported.bounds).toEqual([150.2, -33.6, 150.3, -33.5]);
  });

  it("leaves bounds null when nothing says where a file is", () => {
    const [imported] = build({ standaloneFiles: [file()] });
    expect(imported.bounds).toBeNull();
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

  // A track on a friend's place is an ordinary file, sorted by its own origin
  // and titled by its own name — not a kind named for where it lives.
  it("sorts a place's track by its origin and titles it by its name", () => {
    const ways = build({
      placeTracks: [
        placeTrack({ mediaId: "a", origin: "track", displayName: "Their recording" }),
        placeTrack({ mediaId: "b", origin: "import", filename: "their-import.kml" }),
      ],
    });
    expect(ways.map((way) => [way.kind, way.title])).toEqual([
      ["track", "Their recording"],
      ["import", "their-import.kml"],
    ]);
    expect(ways.every((way) => way.shared && way.placeId === "p1")).toBe(true);
  });

  // The two endpoints overlap: a file of the user's own linked to their own
  // place comes back from both, and the row that survives must be the one that
  // knows the file is theirs.
  it("lists a file on the user's own place once, as their own", () => {
    const ways = build({
      standaloneFiles: [file({ id: "m1", displayName: "Du Faur approach", linkedPlaceId: "p1" })],
      placeTracks: [placeTrack({ mediaId: "m1", placeId: "p1" })],
    });
    expect(ways).toHaveLength(1);
    expect(ways[0]).toMatchObject({ kind: "import", title: "Du Faur approach", shared: false });
  });

  // A friend's place's track is not among the user's own files, so it must
  // survive the de-duplication — it appears on no other page.
  it("keeps a track on a place a friend shared", () => {
    const ways = build({
      standaloneFiles: [file({ id: "mine" })],
      placeTracks: [placeTrack({ mediaId: "theirs" })],
    });
    expect(ways.map((way) => way.shared)).toEqual([false, true]);
  });

  // What separates a way you can drop from one you cannot: a directly-shared
  // route has a share row of its own, and a route sitting on a place someone
  // shared has none — the place's share is the only thing holding it.
  it("marks a shared route on a shared place as reached through that place", () => {
    const [way] = build({
      routes: [route({ ownerId: THEM, placeId: "theirs" })],
      sharedPlaceIds: ["theirs"],
    });
    expect(way).toMatchObject({ shared: true, viaPlace: true });
  });

  it("treats a route shared on its own as direct, place or no place", () => {
    const [bare] = build({ routes: [route({ ownerId: THEM })] });
    expect(bare).toMatchObject({ shared: true, viaPlace: false });

    // Its place is not one of theirs, so the share reaching the user is the
    // route's own.
    const [elsewhere] = build({
      routes: [route({ ownerId: THEM, placeId: "somewhere-else" })],
      sharedPlaceIds: ["theirs"],
    });
    expect(elsewhere.viaPlace).toBe(false);
  });

  // The user's own route on their own place is not shared at all, so it can
  // never be "reached through" anything.
  it("never calls the user's own route reached through a place", () => {
    const [way] = build({ routes: [route({ placeId: "mine" })], sharedPlaceIds: ["mine"] });
    expect(way).toMatchObject({ shared: false, viaPlace: false });
  });

  // `/places/tracks` IS the place's endpoint: nothing it returns has a share
  // row of its own.
  it("reaches every one of a place's tracks through that place", () => {
    const [way] = build({ placeTracks: [placeTrack()] });
    expect(way).toMatchObject({ shared: true, viaPlace: true });
  });

  // The list used to be routes, then files, then a friend's tracks — the order
  // the three fetches happened to be written in, which means nothing to the
  // reader: a track recorded this morning sat below a route drawn last year.
  it("orders every kind together, newest first", () => {
    const ways = build({
      routes: [route({ id: "old-route", createdAt: "2026-01-01T00:00:00.000Z" })],
      standaloneFiles: [file({ id: "new-file", createdAt: "2026-06-01T00:00:00.000Z" })],
    });
    expect(ways.map((way) => way.id)).toEqual(["new-file", "old-route"]);
  });

  // `/places/tracks` is the place's endpoint and carries no date, so those rows
  // cannot be ordered against the rest. Last is a position; an invented date
  // would be a lie that sorts them somewhere meaningless.
  it("puts the undated last, keeping the order they arrived in", () => {
    const ways = build({
      routes: [route({ id: "dated", createdAt: "2026-01-01T00:00:00.000Z" })],
      placeTracks: [placeTrack({ mediaId: "first" }), placeTrack({ mediaId: "second" })],
    });
    expect(ways.map((way) => way.id)).toEqual(["dated", "first", "second"]);
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
        placeTracks: [placeTrack({ origin: "import" })],
      }),
    );
    expect(counts).toEqual({ all: 4, route: 2, track: 1, import: 1 });
  });
});
