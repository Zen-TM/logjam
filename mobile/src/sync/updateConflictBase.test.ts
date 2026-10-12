import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterSelfConflicts } from "@logjam/shared";

// Two queued edits to the same field of the same row, with another row's op
// between them so they cannot merge, is ordinary offline use: change a place's
// notes, log a trip, change the notes again. The server applies the first,
// which moves the row's `updatedAt`, then answers the second with a receipt
// naming the FIRST edit's value as the one it replaced. The second op's base
// snapshot is what lets the phone see that value as its own.
//
// getSyncDb reaches for expo-sqlite, which throws outside a native runtime, so
// the DB is a stand-in that holds one mirror table and the outbox.

type Mirror = Record<string, Record<string, unknown>>;
type Queued = {
  seq: number;
  op_id: string;
  entity: string;
  op: string;
  entity_id: string;
  base_updated_at: string | null;
  fields_json: string | null;
  base_fields_json: string | null;
  state: string;
  error_json: null;
  attempts: number;
};

let mirror: Mirror = {};
let outbox: Queued[] = [];

const db = {
  getFirstAsync: (sql: string, id: string) => {
    if (!sql.includes("FROM custom_field_defs WHERE id")) {
      throw new Error(`unhandled read: ${sql}`);
    }
    return Promise.resolve(mirror[id] ?? null);
  },
  getAllAsync: (_sql: string, entity: string, id: string) =>
    Promise.resolve(
      outbox.filter(
        (row, index) =>
          (row.entity === entity && row.entity_id === id) ||
          index === outbox.length - 1,
      ),
    ),
  runAsync: (sql: string, ...args: unknown[]) => {
    if (sql.startsWith("UPDATE custom_field_defs SET")) {
      const columns = [...sql.matchAll(/(\w+) = \?/g)].map((match) => match[1]);
      const id = args[args.length - 1] as string;
      // The last `= ?` is the WHERE.
      columns.slice(0, -1).forEach((column, index) => {
        mirror[id][column] = args[index];
      });
    } else if (sql.includes("INSERT INTO outbox")) {
      const [op_id, entity, op, entity_id, base_updated_at, fields, base] =
        args as (string | null)[];
      outbox.push({
        seq: outbox.length + 1,
        op_id: op_id!,
        entity: entity!,
        op: op!,
        entity_id: entity_id!,
        base_updated_at,
        fields_json: fields,
        base_fields_json: base,
        state: "queued",
        error_json: null,
        attempts: 0,
      });
    } else if (sql.startsWith("UPDATE outbox SET fields_json")) {
      const target = outbox.find((row) => row.seq === args[2])!;
      target.fields_json = args[0] as string;
      target.base_fields_json = args[1] as string | null;
    } else {
      throw new Error(`unhandled write: ${sql}`);
    }
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  },
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
  withSyncTransaction: (_db: unknown, task: () => Promise<void>) => task(),
}));
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: () => Promise.resolve(),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));

const { updateCustomFieldDefLocal } = await import("./outbox");

const T0 = "2026-10-08T01:00:00.000Z";

function seed(id: string, position: number): void {
  mirror[id] = {
    id,
    label: id,
    position,
    updated_at: T0,
    dirty_fields_json: null,
  };
}

/**
 * The server's half, as `conflictReceipts` in api/src/routes/sync.ts decides
 * it: a base older than the row, and a stored value that differs from the one
 * written, owes a receipt naming the stored value.
 */
function push(): { field: string; serverValue: unknown }[][] {
  const server: Record<
    string,
    { updatedAt: string } & Record<string, unknown>
  > = {};
  let clock = 0;
  return outbox.map((row) => {
    const fields = JSON.parse(row.fields_json!) as Record<string, unknown>;
    const stored = (server[row.entity_id] ??= {
      updatedAt: T0,
      position: 5,
      label: "e",
    });
    const receipts =
      row.base_updated_at === stored.updatedAt
        ? []
        : Object.entries(fields)
            .filter(([field, value]) => stored[field] !== value)
            .map(([field]) => ({ field, serverValue: stored[field] }));
    Object.assign(stored, fields, { updatedAt: `after-${++clock}` });
    return filterSelfConflicts(
      receipts,
      row.base_fields_json
        ? (JSON.parse(row.base_fields_json) as Record<string, unknown>)
        : {},
    );
  });
}

beforeEach(() => {
  mirror = {};
  outbox = [];
  seed("e", 5);
  seed("other", 0);
});

describe("a second queued edit to a field this phone already changed", () => {
  // Mutation: snapshot the base only for a field that is not already dirty.
  it("shelves nothing when its own earlier edit is what the server held", async () => {
    await updateCustomFieldDefLocal("e", { position: 4 });
    await updateCustomFieldDefLocal("other", { label: "renamed" });
    await updateCustomFieldDefLocal("e", { position: 3 });

    expect(outbox).toHaveLength(3);
    expect(push()).toEqual([[], [], []]);
  });

  it("keeps the first edit's base when the two merge", async () => {
    await updateCustomFieldDefLocal("e", { position: 4 });
    await updateCustomFieldDefLocal("e", { position: 3 });

    expect(outbox).toHaveLength(1);
    expect(JSON.parse(outbox[0].base_fields_json!)).toEqual({ position: 5 });
  });

  it("still shelves a value another device wrote in between", async () => {
    await updateCustomFieldDefLocal("e", { position: 4 });
    await updateCustomFieldDefLocal("other", { label: "renamed" });
    await updateCustomFieldDefLocal("e", { position: 3 });

    const base = JSON.parse(outbox[2].base_fields_json!) as Record<
      string,
      unknown
    >;
    expect(
      filterSelfConflicts([{ field: "position", serverValue: 9 }], base),
    ).toEqual([{ field: "position", serverValue: 9 }]);
  });
});
