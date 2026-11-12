// Every delta entity the protocol carries must actually reach the mirror, and
// a tombstone for it must take it out again.
//
// The `satisfies DeltaEntityKey` clause in `deltaPull.ts` pins the parse side,
// so a key cannot go missing from the `changes` object, but nothing in
// TypeScript checks the apply side: a loop with an empty body, or one that
// writes to the wrong table, compiles and the rows arrive and vanish. A
// missing apply loop for place types is also masked because
// `listMirrorPlaceTypes` falls back to the compiled-in `SYSTEM_PLACE_TYPES`
// when the table is empty.
//
// This runs the real `runDeltaPull` and the real mirror over node:sqlite, one
// delta page per entity, and reads the table back. The declaration is
// `DELTA_ENTITY_ORDER`; the cases below are looked up from it, so an entity
// added tomorrow fails here until someone writes its row.
//
// Mutation that turns it red: empty any apply loop in `deltaPull.ts`
// (`for (const row of changes.friendships) void row;`), apply it to the wrong
// table, drop an entity from the `changedRows` sum, or drop a tombstone `case`
// in `applyTombstone`.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  DELTA_ENTITY_ORDER,
  SYNC_PROTOCOL,
  type DeltaEntityKey,
  type SyncEntityType,
} from "@logjam/shared";

const sqlite = new DatabaseSync(":memory:");

/** The subset of expo-sqlite's surface the sync stack uses, over node:sqlite. */
const adapter = {
  execAsync: (sql: string) => {
    sqlite.exec(sql);
    return Promise.resolve();
  },
  runAsync: (sql: string, ...params: unknown[]) => {
    sqlite.prepare(sql).run(...(params as never[]));
    return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
  },
  getFirstAsync: (sql: string, ...params: unknown[]) =>
    Promise.resolve(sqlite.prepare(sql).get(...(params as never[])) ?? null),
  getAllAsync: (sql: string, ...params: unknown[]) =>
    Promise.resolve(sqlite.prepare(sql).all(...(params as never[]))),
  withTransactionAsync: async (task: () => Promise<void>) => {
    sqlite.exec("BEGIN");
    try {
      await task();
      sqlite.exec("COMMIT");
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }
  },
};
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: () => Promise.resolve(adapter),
}));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: () => Promise.resolve(),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));

let nextPage: Record<string, unknown> = {};
vi.mock("../api/apiFetch", () => ({
  apiFetch: () => Promise.resolve(nextPage),
}));

const { runDeltaPull } = await import("./deltaPull");

const AT = "2026-08-01T00:00:00.000Z";
const USER = { id: "user-2", username: "bob" };

type Case = {
  /** The mirror table the entity lives in. */
  table: string;
  /** The `type` its tombstone carries (`SYNC_ENTITY_TYPES`). */
  tombstone: SyncEntityType;
  row: Record<string, unknown>;
};

// One made-up row per entity: every field the parser requires, nothing real.
const CASES = {
  placeTypes: {
    table: "place_types",
    tombstone: "placeType",
    row: {
      id: "placeType-1",
      ownerId: "user-1",
      name: "Made-up type",
      iconKey: "tent",
      color: "#336699",
      position: 1,
      createdAt: AT,
      updatedAt: AT,
    },
  },
  customFieldDefs: {
    table: "custom_field_defs",
    tombstone: "customFieldDef",
    row: {
      id: "customFieldDef-1",
      ownerId: "user-1",
      entity: "place",
      key: "madeUp",
      label: "Made-up field",
      type: "text",
      min: null,
      max: null,
      position: 1,
      placeTypeIds: [],
      tripTypes: [],
      appliesToAllTypes: true,
      createdAt: AT,
      updatedAt: AT,
    },
  },
  places: {
    table: "places",
    tombstone: "place",
    row: {
      id: "place-1",
      ownerId: "user-1",
      syncRole: "owner",
      name: "Made-up gully",
      altNames: [],
      latitude: -33.5,
      longitude: 150.4,
      placeTypeId: "placeType-1",
      notes: null,
      elevation: null,
      fieldValues: {},
      ropeWikiId: null,
      forkedFromId: null,
      createdAt: AT,
      updatedAt: AT,
    },
  },
  placeLinks: {
    table: "place_links",
    tombstone: "placeLink",
    row: {
      id: "placeLink-1",
      ownerId: "user-1",
      aPlaceId: "place-a",
      bPlaceId: "place-b",
      createdAt: AT,
      updatedAt: AT,
    },
  },
  tripLogs: {
    table: "trip_logs",
    tombstone: "tripLog",
    row: {
      id: "tripLog-1",
      userId: "user-1",
      date: "2026-08-01",
      displayName: null,
      types: [],
      notes: null,
      customFields: {},
      places: [],
      createdAt: AT,
      updatedAt: AT,
    },
  },
  routes: {
    table: "routes",
    tombstone: "route",
    row: {
      id: "route-1",
      ownerId: "user-1",
      syncRole: "owner",
      placeId: null,
      name: "Made-up route",
      color: "#336699",
      points: [
        [150.4, -33.5],
        [150.41, -33.51],
      ],
      anchors: null,
      createdAt: AT,
      updatedAt: AT,
    },
  },
  media: {
    table: "media",
    tombstone: "media",
    row: {
      id: "media-1",
      linkedType: "none",
      linkedId: null,
      mediaType: "photo",
      filename: "made-up.jpg",
      fileSizeBytes: "1024",
      color: null,
      origin: null,
      displayName: null,
      metadata: {},
      createdAt: AT,
      updatedAt: AT,
    },
  },
  placeShares: {
    table: "place_shares",
    tombstone: "placeShare",
    row: {
      id: "placeShare-1",
      placeId: "place-1",
      sharedById: "user-1",
      sharedWithId: USER.id,
      createdAt: AT,
      sharedBy: { id: "user-1", username: "alice" },
      sharedWith: USER,
    },
  },
  friendships: {
    table: "friendships",
    tombstone: "friendship",
    row: {
      id: "friendship-1",
      status: "accepted",
      createdAt: AT,
      updatedAt: AT,
      counterpart: { id: "user-1", username: "alice" },
      direction: "received",
    },
  },
} satisfies Record<DeltaEntityKey, Case>;

const emptyChanges = () =>
  Object.fromEntries(DELTA_ENTITY_ORDER.map((key) => [key, []]));

const page = (
  changes: Record<string, unknown[]>,
  tombstones: { type: string; id: string }[],
  cursor: string,
) => ({
  protocol: SYNC_PROTOCOL,
  epoch: 1,
  serverTime: AT,
  cursor,
  hasMore: false,
  resetRequired: false,
  changes: { ...emptyChanges(), ...changes },
  tombstones,
});

const count = (table: string, id: string): number =>
  (
    sqlite
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`)
      .get(id) as { n: number }
  ).n;

describe("delta apply coverage", () => {
  it("covers a plausible number of entities", () => {
    // The loop below is vacuous if the declaration were emptied.
    expect(DELTA_ENTITY_ORDER.length).toBeGreaterThanOrEqual(9);
  });

  it.each(DELTA_ENTITY_ORDER)(
    "writes a %s upsert to the mirror and a tombstone removes it",
    async (entity) => {
      const entry = (CASES as Record<string, Case | undefined>)[entity];
      if (!entry) {
        throw new Error(
          `DELTA_ENTITY_ORDER names "${entity}" but this test has no case for it: add one made-up row to CASES, with its mirror table and tombstone type`,
        );
      }
      const { table, tombstone, row } = entry;
      const id = row.id as string;

      nextPage = page({ [entity]: [row] }, [], `cursor-${entity}-1`);
      const applied = await runDeltaPull(USER.id);
      expect(
        count(table, id),
        `runDeltaPull parsed a ${entity} row but did not write it to ${table}: add the apply loop in deltaPull.ts, or the rows arrive and vanish`,
      ).toBe(1);
      expect(
        applied.changedRows,
        `deltaPull.ts does not add changes.${entity}.length to changedRows, so a page of only ${entity} looks empty`,
      ).toBe(1);

      nextPage = page({}, [{ type: tombstone, id }], `cursor-${entity}-2`);
      await runDeltaPull(USER.id);
      expect(
        count(table, id),
        `a "${tombstone}" tombstone left the row in ${table}: add its case to applyTombstone in mirrorStore.ts`,
      ).toBe(0);
    },
  );
});
