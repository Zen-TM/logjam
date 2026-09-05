import { beforeEach, describe, expect, it, vi } from "vitest";

// A malformed row from the server must not be able to stop sync.
//
// The push path can throw on a bad row: the outbox entry is already gone, the
// local value stands, and the next pull corrects it. The pull path cannot. Its
// upserts and its cursor write share one transaction, so a throw rolls back the
// cursor with the page — and the client then re-fetches that same page forever.
// That is exactly MSYNC-001 (a canyon tombstone hitting a dropped column killed
// delta pull permanently on every fresh install), reachable a second way: by
// anything the server sends that this client version cannot read.
//
// So: drop the row, name it (fields only — these rows carry canyon names and
// coordinates), apply the rest of the page, advance the cursor, and count a
// sync issue so it is visible rather than silent.

const applied = {
  canyons: [] as string[],
  waypoints: [] as string[],
  tombstones: [] as string[],
};
const stateWrites: Record<string, string> = {};
let pages: Record<string, unknown>[] = [];
let fetchCount = 0;

vi.mock("../api/apiFetch", () => ({
  apiFetch: () => Promise.resolve(pages[fetchCount++]),
}));
vi.mock("expo-file-system/legacy", () => ({ deleteAsync: () => Promise.resolve() }));
vi.mock("./outbox", () => ({ loadOutboxRows: () => Promise.resolve([]), rowToEntry: (r: unknown) => r }));
vi.mock("./mirrorStore", () => ({
  notifyMirrorChanged: () => {},
  upsertCanyon: (_db: unknown, row: { id: string }) => {
    applied.canyons.push(row.id);
    return Promise.resolve();
  },
  upsertWaypoint: (_db: unknown, row: { id: string }) => {
    applied.waypoints.push(row.id);
    return Promise.resolve();
  },
  upsertTrip: () => Promise.resolve(),
  upsertRoute: () => Promise.resolve(),
  upsertMedia: () => Promise.resolve(),
  upsertShare: () => Promise.resolve(),
  upsertFriendship: () => Promise.resolve(),
  rebasePendingCanyonLinks: (_db: unknown, effective: unknown, dirtyNames: unknown) =>
    Promise.resolve({ effective, dirtyNames }),
  applyTombstone: (_db: unknown, t: { id: string }) => {
    applied.tombstones.push(t.id);
    return Promise.resolve([]);
  },
}));
vi.mock("./syncDb", () => ({
  APPLY_FAILED_KEY: "applyFailedAt",
  getSyncDb: () => Promise.resolve({ runAsync: () => Promise.resolve() }),
  getSyncStateValue: (key: string) => Promise.resolve(stateWrites[key] ?? ""),
  setSyncStateValue: (key: string, value: string) => {
    stateWrites[key] = value;
    return Promise.resolve();
  },
  wipeMirror: () => Promise.resolve(),
  // The real one runs the body in a transaction; a throw inside it would take
  // the cursor write with it, which is the failure this test exists to prevent.
  withSyncTransaction: (_db: unknown, body: () => Promise<void>) => body(),
}));

const { runDeltaPull } = await import("./deltaPull");

const goodCanyon = {
  id: "canyon-good",
  ownerId: "user-1",
  syncRole: "owner",
  name: "Somewhere",
  altNames: [],
  latitude: -33.5,
  longitude: 150.4,
  numAbseils: null,
  longestAbseil: null,
  vGrade: null,
  aGrade: null,
  commitment: null,
  quality: null,
  hours: null,
  notes: null,
  attributes: {},
  ropeWikiId: null,
  forkedFromId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function page(over: Record<string, unknown>) {
  return {
    protocol: 1,
    epoch: 1,
    serverTime: "2026-08-16T00:00:00.000Z",
    cursor: "cursor-next",
    hasMore: false,
    resetRequired: false,
    changes: {
      canyons: [],
      tripLogs: [],
      waypoints: [],
      routes: [],
      media: [],
      canyonShares: [],
      friendships: [],
    },
    tombstones: [],
    ...over,
  };
}

beforeEach(() => {
  applied.canyons = [];
  applied.waypoints = [];
  applied.tombstones = [];
  for (const key of Object.keys(stateWrites)) delete stateWrites[key];
  fetchCount = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a malformed delta row", () => {
  it("is dropped while the rest of the page still applies", async () => {
    pages = [
      page({
        changes: {
          // latitude as a string is the classic wire-shape slip.
          canyons: [goodCanyon, { ...goodCanyon, id: "canyon-bad", latitude: "-33.5" }],
          tripLogs: [],
          waypoints: [],
          routes: [],
          media: [],
          canyonShares: [],
          friendships: [],
        },
      }),
    ];

    const result = await runDeltaPull("user-1");

    expect(applied.canyons).toEqual(["canyon-good"]);
    expect(result.pages).toBe(1);
  });

  it("does not stall the cursor — the pull completes and is counted as an issue", async () => {
    pages = [page({ changes: { canyons: [{ id: "nope" }], tripLogs: [], waypoints: [], routes: [], media: [], canyonShares: [], friendships: [] } })];

    // The whole point: this resolves. Before validation existed a bad row threw
    // out of the transaction, and before *skipping* existed it would have
    // rejected here with the cursor unwritten.
    await expect(runDeltaPull("user-1")).resolves.toMatchObject({ pages: 1 });
    expect(stateWrites.applyFailedAt).toBeTruthy();
  });

  // An unknown entity type is a NEWER SERVER, not a malformed row: it reaches
  // the applier, which ignores it (see mirrorStore's own tombstone test — the
  // applier is mocked here). Treating it as corruption instead is what made a
  // 0.1.0 build warn "dropped 12 unreadable row(s)" the moment the server
  // learned an eighth entity, so this asserts NO issue is recorded.
  it("passes an unknown tombstone type through without calling it corrupt", async () => {
    pages = [
      page({
        tombstones: [
          { type: "canyon", id: "gone" },
          { type: "placeType", id: "from-a-newer-server" },
        ],
      }),
    ];

    await runDeltaPull("user-1");

    expect(applied.tombstones).toEqual(["gone", "from-a-newer-server"]);
    expect(stateWrites.applyFailedAt).toBeFalsy();
  });

  it("still drops a tombstone whose SHAPE is malformed", async () => {
    pages = [
      page({
        tombstones: [
          { type: "canyon", id: "gone" },
          { type: "canyon" },
          { type: 7, id: "hostile" },
        ],
      }),
    ];

    await runDeltaPull("user-1");

    expect(applied.tombstones).toEqual(["gone"]);
  });

  it("leaves a clean page untouched and records no issue", async () => {
    pages = [
      page({
        changes: {
          canyons: [goodCanyon],
          tripLogs: [],
          waypoints: [],
          routes: [],
          media: [],
          canyonShares: [],
          friendships: [],
        },
      }),
    ];

    await runDeltaPull("user-1");

    expect(applied.canyons).toEqual(["canyon-good"]);
    expect(stateWrites.applyFailedAt).toBeUndefined();
  });
});

describe("a change key this app version does not consume", () => {
  // The client applies a hand-listed set of `changes` keys. An eighth protocol
  // entity used to be fetched, never read, and acknowledged anyway by the
  // advancing cursor — permanently absent from every phone, with none of the
  // skipped-row marking an unreadable ROW gets. (The other direction, this
  // build's own list drifting from DELTA_ENTITY_ORDER, is a compile error:
  // `satisfies Record<DeltaEntityKey, unknown[]>` in deltaPull.ts.)
  it("is counted as a sync issue instead of dropped in silence", async () => {
    pages = [
      page({
        changes: {
          canyons: [],
          tripLogs: [],
          waypoints: [],
          routes: [],
          media: [],
          canyonShares: [],
          friendships: [],
          gearLists: [{ id: "gear-1" }],
        },
      }),
    ];

    await expect(runDeltaPull("user-1")).resolves.toMatchObject({ pages: 1 });
    expect(stateWrites.applyFailedAt).toBeTruthy();
  });

  it("stays silent when the unknown key carries no rows", async () => {
    pages = [
      page({
        changes: {
          canyons: [],
          tripLogs: [],
          waypoints: [],
          routes: [],
          media: [],
          canyonShares: [],
          friendships: [],
          gearLists: [],
        },
      }),
    ];

    await runDeltaPull("user-1");
    expect(stateWrites.applyFailedAt).toBeUndefined();
  });
});
