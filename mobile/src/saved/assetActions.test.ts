import { describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above these by the transform, so the descriptor still
// loads against the stubs below.
import {
  routeActions,
  trackActions,
  vectorImportActions,
  waypointActions,
} from "./assetActions";
import type { Track } from "../tracks/tracksDb";
import type { MirrorRoute, MirrorWaypoint } from "../sync/mirrorStore";
import type { VectorImport } from "../imports/importsDb";

// The descriptor's own modules all reach SQLite / the filesystem; this test is
// about which verbs the descriptor OFFERS, so they are stubbed wholesale.
vi.mock("../geopdf/importPipeline", () => ({ deleteGeoPdfImport: vi.fn() }));
vi.mock("../geopdf/geoPdfImportsDb", () => ({ updateGeoPdfImport: vi.fn() }));
vi.mock("../imports/importsDb", () => ({ renameVectorImport: vi.fn() }));
vi.mock("../imports/vectorImports", () => ({ deleteVectorImport: vi.fn() }));
vi.mock("../tracks/tracksDb", () => ({
  deleteTrack: vi.fn(),
  listTrackPoints: vi.fn(),
  updateTrack: vi.fn(),
}));
vi.mock("../sync/outbox", () => ({
  createRouteLocal: vi.fn(),
  deleteRouteLocal: vi.fn(),
  deleteWaypointLocal: vi.fn(),
  updateRouteLocal: vi.fn(),
  updateWaypointLocal: vi.fn(),
}));
vi.mock("../fileExport", () => ({ exportTrack: vi.fn(), exportStoredFile: vi.fn() }));
vi.mock("../sync/mediaUpload", () => ({ attachMediaLocal: vi.fn() }));
// Both reach expo-file-system, whose Flow sources vitest cannot parse — the
// same wall shareRowSubtitle.ts and map/elevationSources.ts were split out to
// stay behind.
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
}));
vi.mock("../offline/localStores", () => ({
  scratchFileUri: vi.fn(async (name: string) => `file:///scratch/${name}`),
}));

const route = (syncRole: "owner" | "shared") =>
  ({
    id: "r1",
    name: "Creek",
    points: [
      [150.1, -33.5],
      [150.2, -33.6],
    ],
    syncRole,
  }) as unknown as MirrorRoute;

const waypoint = (syncRole: "owner" | "shared") =>
  ({
    id: "w1",
    name: "Carpark",
    latitude: -33.5,
    longitude: 150.1,
    tags: [],
    canyonIds: [],
    syncRole,
  }) as unknown as MirrorWaypoint;

// The API's route/waypoint DELETE and PATCH are owner-only, so a write verb
// offered on a shared row removes it locally, parks the push as `blocked` and
// lets the next delta pull put it back. Absence of the verb is what every
// surface reads — the map sheet, the Saved overflow and the multi-select all
// branch on it — so it is the descriptor, not each screen, that must withhold.
describe("assetActions ownership", () => {
  it("gives an owned route every write verb", () => {
    const actions = routeActions(route("owner"));
    expect(actions.delete).toBeDefined();
    expect(actions.rename).toBeDefined();
    expect(actions.editableRouteId).toBe("r1");
  });

  it("withholds every write verb on a shared route, and keeps the read ones", () => {
    const actions = routeActions(route("shared"));
    expect(actions.delete).toBeUndefined();
    expect(actions.rename).toBeUndefined();
    expect(actions.editableRouteId).toBeUndefined();
    // Still viewable: a sharee can fly to it, which is the whole point of it
    // being on their phone.
    expect(actions.locatable).toBe(true);
  });

  it("gives an owned waypoint its write verbs", () => {
    const actions = waypointActions(waypoint("owner"));
    expect(actions.delete).toBeDefined();
    expect(actions.rename).toBeDefined();
  });

  it("withholds them on a shared waypoint", () => {
    const actions = waypointActions(waypoint("shared"));
    expect(actions.delete).toBeUndefined();
    expect(actions.rename).toBeUndefined();
    expect(actions.locatable).toBe(true);
  });

  // `sharedWithYou` is what every surface renders SHARED_READ_ONLY_HINT on,
  // and the hint's whole job is to explain the missing verbs — so a descriptor
  // that sets the flag while still offering a write verb puts a sentence on
  // screen that the buttons beside it contradict, and one that withholds the
  // verbs without the flag leaves them missing with nothing said. That second
  // case is not hypothetical: it is exactly what a shared LiDAR topo did,
  // because the screens read "no delete descriptor" as the proxy for shared.
  it.each([
    ["route", routeActions(route("shared"))],
    ["waypoint", waypointActions(waypoint("shared"))],
  ])("flags a shared %s and withholds every write verb with it", (_kind, actions) => {
    expect(actions.sharedWithYou).toBe(true);
    expect(actions.share).toBeUndefined();
    expect(actions.rename).toBeUndefined();
    expect(actions.delete).toBeUndefined();
  });

  it.each([
    ["route", routeActions(route("owner"))],
    ["waypoint", waypointActions(waypoint("owner"))],
  ])("leaves the flag off an owned %s, which keeps its verbs", (_kind, actions) => {
    expect(actions.sharedWithYou).toBeUndefined();
    expect(actions.share).toBeDefined();
    expect(actions.delete).toBeDefined();
  });
});

// An import's export rows decide WHICH FILE the user gets back, and getting it
// wrong hands them a lossy GeoJSON while the row says "original". The three
// cases differ only in the stored source, so they are easy to conflate.
describe("vectorImportActions exports", () => {
  const imported = (sourcePath: string | null) =>
    ({
      id: "i1",
      name: "Kanangra",
      path: "/data/imports/i1.geojson",
      sourcePath,
      bbox: [150, -34, 151, -33],
    }) as unknown as VectorImport;

  it("offers the original plus the derived GeoJSON for a GPX source", () => {
    const titles = vectorImportActions(
      imported("/data/imports/i1-source.gpx"),
    ).exports?.map((option) => option.title);
    expect(titles).toEqual(["Export original (GPX)", "Export as GeoJSON"]);
  });

  it("names the original by its own format, not the import's", () => {
    const titles = vectorImportActions(
      imported("/data/imports/i1-source.kml"),
    ).exports?.map((option) => option.title);
    expect(titles).toEqual(["Export original (KML)", "Export as GeoJSON"]);
  });

  it("collapses to one row when the source WAS GeoJSON", () => {
    const titles = vectorImportActions(
      imported("/data/imports/i1-source.geojson"),
    ).exports?.map((option) => option.title);
    expect(titles).toEqual(["Export as GeoJSON"]);
  });

  it("offers GeoJSON only when no original was kept", () => {
    // A row from before originals were stored. It must still export something
    // rather than showing a button that reads back a file that isn't there.
    const titles = vectorImportActions(imported(null)).exports?.map(
      (option) => option.title,
    );
    expect(titles).toEqual(["Export as GeoJSON"]);
  });
});

const track = (pointCount: number) =>
  ({
    id: "t1",
    name: "Kanangra",
    pointCount,
    startedAt: "2026-08-22T00:00:00.000Z",
  }) as unknown as Track;

const importRow = (overrides: Partial<VectorImport> = {}) =>
  ({
    id: "i1",
    name: "Roundtrip",
    path: "/imports/i1.geojson",
    sourcePath: "/imports/i1-source.gpx",
    featureCount: 2,
    sizeBytes: 673,
    createdAt: "2026-08-22T00:00:00.000Z",
    sentBy: null,
    ...overrides,
  }) as unknown as VectorImport;

// WHICH KIND GETS WHICH VERB, as a table.
//
// This exists because the verb matrix has now broken twice in a way no other
// test could see: a Share verb wired into one of four render sites shipped
// invisible, and a track's "Send a copy" was reported missing from the UI
// while the descriptor had it all along. The descriptor is the single source
// every surface reads, so the matrix belongs here — a surface that fails to
// render a verb is a separate bug, but a descriptor that never offers one
// makes every surface wrong at once.
//
// The two verbs are NOT interchangeable and the table is the place that says
// so: `share` is a live, revocable view of a server-backed row; `sendCopy`
// hands over a file for good.
describe("the share / send-a-copy verb matrix", () => {
  it("gives an owned route and waypoint Share, and never sendCopy", () => {
    for (const actions of [routeActions(route("owner")), waypointActions(waypoint("owner"))]) {
      expect(actions.share).toBeDefined();
      // A route is a synced row, not a file — there is nothing to hand over.
      expect(actions.sendCopy).toBeUndefined();
    }
  });

  it("withholds Share on a route or waypoint shared WITH this user", () => {
    // The API's share endpoint is owner-only; offering it would 403.
    expect(routeActions(route("shared")).share).toBeUndefined();
    expect(waypointActions(waypoint("shared")).share).toBeUndefined();
  });

  it("gives a recording Send a copy, and never Share", () => {
    const actions = trackActions(track(3));
    expect(actions.sendCopy).toBeDefined();
    expect(actions.sendCopy?.sourceKind).toBe("track");
    // A recording is device-local: there is no server row to grant a view of.
    expect(actions.share).toBeUndefined();
  });

  it("withholds Send a copy on an empty recording", () => {
    // Nothing to serialise — a zero-point GPX is not worth a friend's tap.
    expect(trackActions(track(0)).sendCopy).toBeUndefined();
  });

  it("gives an import with its original bytes Send a copy, and never Share", () => {
    const actions = vectorImportActions(importRow());
    expect(actions.sendCopy).toBeDefined();
    expect(actions.sendCopy?.sourceKind).toBe("import");
    expect(actions.share).toBeUndefined();
  });

  it("withholds Send a copy on an import with no retained original", () => {
    // Pre-retention rows degrade to GeoJSON-only export rather than sending a
    // derivation the sender never chose (GPX → GeoJSON is lossy).
    expect(vectorImportActions(importRow({ sourcePath: null })).sendCopy).toBeUndefined();
  });

  // A canyon's route slot takes TRACK media and nothing else, so this verb has
  // a narrower gate than Send a copy over the very same file — the row that can
  // only fail is absent, not offered (DESIGN.md §7).
  it("gives an import with a GPX or KML original Attach to a canyon", () => {
    for (const sourcePath of ["/imports/i1-source.gpx", "/imports/i1-source.kml"]) {
      expect(vectorImportActions(importRow({ sourcePath })).attachToCanyon).toBeDefined();
    }
  });

  it("withholds Attach to a canyon on a GeoJSON import and on one with no original", () => {
    expect(
      vectorImportActions(importRow({ sourcePath: "/imports/i1-source.geojson" }))
        .attachToCanyon,
    ).toBeUndefined();
    expect(
      vectorImportActions(importRow({ sourcePath: null })).attachToCanyon,
    ).toBeUndefined();
  });

  it("never offers Attach to a canyon on the kinds that are not files", () => {
    expect(routeActions(route("owner")).attachToCanyon).toBeUndefined();
    expect(waypointActions(waypoint("owner")).attachToCanyon).toBeUndefined();
    // A recording gets there through createRouteFrom instead: the track itself
    // is never linked, a route made from it is.
    expect(trackActions(track(3)).attachToCanyon).toBeUndefined();
    expect(trackActions(track(3)).createRouteFrom).toBeDefined();
  });

  it("offers setColor on trackActions and updates track color", async () => {
    const { updateTrack } = await import("../tracks/tracksDb");
    const t = { ...track(3), id: "track-123", color: "#e6194b" } as unknown as Track;
    const actions = trackActions(t);
    expect(actions.setColor).toBeDefined();
    await actions.setColor?.("#3cb44b");
    expect(updateTrack).toHaveBeenCalledWith("track-123", { color: "#3cb44b" });
  });

  it("passes track.color to createRouteLocal in createRouteFrom", async () => {
    const { createRouteLocal } = await import("../sync/outbox");
    const { listTrackPoints } = await import("../tracks/tracksDb");
    vi.mocked(listTrackPoints).mockResolvedValueOnce([
      { lon: 150.1, lat: -33.5, ele: 100, time: "2026-08-22T00:00:00Z" },
      { lon: 150.2, lat: -33.6, ele: 100, time: "2026-08-22T00:01:00Z" },
    ] as never);
    const t = { ...track(2), name: "My Track", color: "#911eb4" } as unknown as Track;
    const actions = trackActions(t);
    await actions.createRouteFrom?.();
    expect(createRouteLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        color: "#911eb4",
        name: "My Track (route)",
      }),
    );
  });
});
