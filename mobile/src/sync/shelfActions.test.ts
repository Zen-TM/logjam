import { beforeEach, describe, expect, it, vi } from "vitest";

// The two ways out of a lost value that WRITE something, plus the list that
// decides which of them is offered.
//
// Both used to be one function that marked the shelf row instead of deleting
// it, so a value the user had already dealt with stayed on the screen asking to
// be dealt with again. The delete is the behaviour under test — a leftover row
// is the bug, not a detail.
//
// getSyncDb reaches for expo-sqlite, which throws outside a native runtime, so
// the DB is a recording stand-in and the assertions are on the SQL.

type Row = Record<string, unknown>;

const shelfRows: Row[] = [];
const outboxRows: Row[] = [];
const runCalls: { sql: string; args: unknown[] }[] = [];
const writes: { entity: string; id: string; field: string; value: unknown }[] = [];

const db = {
  runAsync: (sql: string, ...args: unknown[]) => {
    runCalls.push({ sql, args });
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  },
  getAllAsync: (sql: string) =>
    Promise.resolve(sql.includes("conflict_shelf") ? shelfRows : []),
  // Mirror lookups answer "the row is still there", so nothing is blocked as
  // `gone` unless a test says so; an outbox lookup answers with the parked row
  // the test pushed.
  getFirstAsync: (sql: string, ...args: unknown[]) =>
    Promise.resolve(
      sql.includes("FROM outbox")
        ? (outboxRows.find((row) => row.seq === args[0]) ?? null)
        : { id: "c1" },
    ),
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
  getSyncStateValue: () => Promise.resolve(null),
  wipeMirror: () => Promise.resolve(),
  withSyncTransaction: async (_db: unknown, task: () => Promise<void>) => task(),
}));
// deltaPull pulls in config.ts, which fails loudly on a missing API URL — this
// suite never syncs, so stub the one function syncIssues borrows from it.
vi.mock("./deltaPull", () => ({ loadOutboxEntries: () => Promise.resolve([]) }));
vi.mock("./syncEngine", () => ({ APPLY_FAILED_KEY: "applyFailed", requestSync: () => {} }));
// scheduleMutationSync lives in mediaSyncBridge, which reaches into
// react-native (Flow syntax vitest can't parse) — stub the module, not the
// engine behind it.
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
vi.mock("expo-file-system/legacy", () => ({ deleteAsync: () => Promise.resolve() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
vi.mock("./outbox", async () => {
  const actual = await vi.importActual<typeof import("./outbox")>("./outbox");
  return {
    ...actual,
    updateEntityFieldLocal: (entity: string, id: string, field: string, value: unknown) => {
      writes.push({ entity, id, field, value });
      return Promise.resolve();
    },
  };
});

const { canKeepBothField, canRestoreField, mergeableTextFields } = await import("./outbox");
const { keepBothShelfValue, listShelfEntries, restoreShelfValue, retryWithoutFields } =
  await import("./syncIssues");

function shelfRow(overrides: Row = {}): Row {
  return {
    id: 1,
    entity: "canyon",
    entity_id: "c1",
    field: "notes",
    shelved_json: JSON.stringify("Exit track overgrown past the second crossing."),
    server_json: JSON.stringify("Classic. Do it in summer."),
    at: "2026-08-30T00:00:00.000Z",
    entity_name: "Claustral",
    ...overrides,
  };
}

beforeEach(() => {
  shelfRows.length = 0;
  outboxRows.length = 0;
  runCalls.length = 0;
  writes.length = 0;
});

describe("the mergeable-field list", () => {
  it("only names fields a local update can actually write", () => {
    // Keep both writes through `updateEntityFieldLocal`, so a field only this
    // list knew about would throw from inside the transaction the user's tap
    // opened. The two lists must agree (root CLAUDE.md).
    for (const field of mergeableTextFields()) {
      const writable = ["canyon", "tripLog", "waypoint", "route"].some((entity) =>
        canRestoreField(entity, field),
      );
      expect(writable, `${field} is mergeable but not writable`).toBe(true);
    }
  });

  it("refuses the fields where joining two values makes nonsense", () => {
    expect(canKeepBothField("canyon", "notes")).toBe(true);
    // A two-line canyon name is a broken canyon name; a grade is a number.
    expect(canKeepBothField("canyon", "name")).toBe(false);
    expect(canKeepBothField("canyon", "vGrade")).toBe(false);
  });
});

describe("listShelfEntries", () => {
  it("offers Keep both only when there are two real, different texts", async () => {
    shelfRows.push(shelfRow());
    expect((await listShelfEntries())[0].canKeepBoth).toBe(true);

    shelfRows.length = 0;
    // The other device CLEARED the field: there is no second value to keep.
    shelfRows.push(shelfRow({ server_json: JSON.stringify(null) }));
    expect((await listShelfEntries())[0].canKeepBoth).toBe(false);

    shelfRows.length = 0;
    shelfRows.push(shelfRow({ field: "vGrade", shelved_json: "4", server_json: "3" }));
    expect((await listShelfEntries())[0].canKeepBoth).toBe(false);
  });

  it("prefers the stored name over the mirror, so a deleted row keeps its label", async () => {
    shelfRows.push(shelfRow());
    expect((await listShelfEntries())[0].entityName).toBe("Claustral");
  });
});

describe("restoreShelfValue", () => {
  it("writes the value back and DELETES the row", async () => {
    shelfRows.push(shelfRow());
    await restoreShelfValue(1);
    expect(writes).toEqual([
      {
        entity: "canyon",
        id: "c1",
        field: "notes",
        value: "Exit track overgrown past the second crossing.",
      },
    ]);
    // The issue is dealt with. A row that stayed behind — which is what the
    // `restored_at` marker did — asked the user to decide it a second time.
    expect(runCalls.some((call) => call.sql.startsWith("DELETE FROM conflict_shelf"))).toBe(
      true,
    );
  });
});

describe("keepBothShelfValue", () => {
  it("joins them with the KEPT value first, separated by a blank line", async () => {
    shelfRows.push(shelfRow());
    await keepBothShelfValue(1);
    // Kept first because the sentence describing it has to be unambiguous —
    // "your text is added below what's there now". Chronology can't supply an
    // order: an offline edit can be typed after the value that beat it.
    expect(writes[0].value).toBe(
      "Classic. Do it in summer.\n\nExit track overgrown past the second crossing.",
    );
    expect(runCalls.some((call) => call.sql.startsWith("DELETE FROM conflict_shelf"))).toBe(
      true,
    );
  });

  it("refuses rather than writing 'null' into the field", async () => {
    shelfRows.push(shelfRow({ server_json: JSON.stringify(null) }));
    await expect(keepBothShelfValue(1)).rejects.toThrow(/Cannot keep both/);
    expect(writes).toEqual([]);
  });
});

// ── the good half of a rejected edit ─────────────────────────────────────────
//
// An outbox op carries every field one edit dirtied and the API validates the
// whole payload, so one bad number takes a paragraph of notes down with it.
// `retryWithoutFields` re-queues the rest.

describe("retryWithoutFields", () => {
  const parkedRow = {
    seq: 9,
    entity: "canyon",
    op: "update",
    entity_id: "c1",
    state: "blocked",
    fields_json: JSON.stringify({ notes: "rebolted", vGrade: 9 }),
    base_fields_json: null,
    error_json: JSON.stringify({ code: 400, message: "V grade must be between 1 and 7" }),
    attempts: 1,
    created_at: "2026-09-01T00:00:00.000Z",
  };

  it("re-queues the op without the refused field", async () => {
    outboxRows.push(parkedRow);
    await retryWithoutFields(9, ["vGrade"]);
    const update = runCalls.find((call) => call.sql.startsWith("UPDATE outbox SET fields_json"));
    expect(update).toBeDefined();
    // The good field survives; the refused one is gone, not shelved — a value
    // the SERVER refuses is not one we could offer to put back later.
    expect(JSON.parse(String(update?.args[0]))).toEqual({ notes: "rebolted" });
    expect(update?.sql).toContain("state = 'queued'");
    expect(update?.sql).toContain("error_json = NULL");
  });

  it("discards instead of queueing an op with no fields left", async () => {
    outboxRows.push({ ...parkedRow, fields_json: JSON.stringify({ vGrade: 9 }) });
    await retryWithoutFields(9, ["vGrade"]);
    // Going through the discard path is what takes the optimistic mirror row
    // and the op lineage with it; an empty UPDATE would leave both behind.
    expect(runCalls.some((call) => call.sql.startsWith("UPDATE outbox SET fields_json"))).toBe(
      false,
    );
    expect(runCalls.some((call) => call.sql.includes("DELETE FROM outbox WHERE seq"))).toBe(
      true,
    );
  });
});
