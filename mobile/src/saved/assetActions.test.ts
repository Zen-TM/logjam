import { describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above these by the transform, so the descriptor still
// loads against the stubs below.
import { routeActions, waypointActions } from "./assetActions";
import type { MirrorRoute, MirrorWaypoint } from "../sync/mirrorStore";

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
vi.mock("../fileExport", () => ({ exportTrack: vi.fn() }));

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
    expect(actions.reverse).toBeDefined();
    expect(actions.setColor).toBeDefined();
  });

  it("withholds every write verb on a shared route, and keeps the read ones", () => {
    const actions = routeActions(route("shared"));
    expect(actions.delete).toBeUndefined();
    expect(actions.rename).toBeUndefined();
    expect(actions.editableRouteId).toBeUndefined();
    expect(actions.reverse).toBeUndefined();
    expect(actions.setColor).toBeUndefined();
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
});
