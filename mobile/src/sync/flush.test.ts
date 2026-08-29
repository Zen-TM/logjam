import { beforeEach, describe, expect, it, vi } from "vitest";

// Two head-of-line failures the flush engine used to have, both invisible to
// the rest of the suite because they only appear when an op FAILS:
//
//  - one unreadable photo aborted the whole media pass, every pass, so every
//    other upload on the device was blocked forever by an op that never parked
//    and so never appeared in Sync Issues either;
//  - one structurally-bad op made the server refuse the ENVELOPE (400), which
//    parked all fifty ops in the batch as fifty separate sync issues, telling
//    the user the server rejected forty-nine edits it never saw.
//
// The database is a recording stand-in (expo-sqlite has no native runtime
// here); what matters is which rows end in which state.

type Row = {
  seq: number;
  op_id: string;
  entity: string;
  op: string;
  entity_id: string;
  base_updated_at: string | null;
  fields_json: string | null;
  base_fields_json: string | null;
  state: string;
  media_phase: string | null;
  error_json: string | null;
  attempts: number;
};

let rows: Row[] = [];
/** Op ids the fake server refuses at the envelope level (one bad op → 400). */
let poison = new Set<string>();
let pushCalls: string[][] = [];
/** Miscount the fake server applies to its results array (+1 = one extra
 * result, -1 = one missing). MSD-005. */
let resultCountDelta = 0;
/** Media ops whose runner throws (a file the OS reclaimed). */
let deadMedia = new Set<number>();
let mediaRuns: number[] = [];

function mediaRow(seq: number, extra: Partial<Row> = {}): Row {
  return {
    seq,
    op_id: `op-${seq}`,
    entity: "media",
    op: "create",
    entity_id: `media-${seq}`,
    base_updated_at: null,
    fields_json: JSON.stringify({ linkedType: "canyon", linkedId: `c-${seq}` }),
    base_fields_json: null,
    state: "queued",
    media_phase: null,
    error_json: null,
    attempts: 0,
    ...extra,
  };
}

function pushRow(seq: number): Row {
  return {
    seq,
    op_id: `op-${seq}`,
    entity: "waypoint",
    op: "update",
    entity_id: `wp-${seq}`,
    base_updated_at: null,
    fields_json: JSON.stringify({ name: "n" }),
    base_fields_json: null,
    state: "queued",
    media_phase: null,
    error_json: null,
    attempts: 0,
  };
}

/** Minimal SQL interpreter over `rows` — only the statements flush.ts issues. */
function run(sql: string, args: unknown[]): void {
  const seqIn = sql.match(/seq IN \(([^)]*)\)/);
  const targets = seqIn
    ? args.slice(-((seqIn[1].match(/\?/g) ?? []).length))
    : sql.includes("WHERE seq = ?")
      ? [args[args.length - 1]]
      : rows.map((row) => row.seq);
  for (const row of rows) {
    if (!targets.includes(row.seq)) continue;
    // `WHERE … state = 'inflight'` (crash recovery, the requeue guard) must
    // not touch a row that has since parked.
    if (/WHERE[\s\S]*state = 'inflight'/.test(sql) && row.state !== "inflight") continue;
    if (sql.startsWith("DELETE FROM outbox")) {
      rows = rows.filter((candidate) => candidate.seq !== row.seq);
      continue;
    }
    const setState = sql.match(/SET state = '(\w+)'/);
    if (setState) row.state = setState[1];
    if (sql.includes("attempts = attempts + 1")) row.attempts += 1;
    if (sql.includes("error_json = ?")) row.error_json = String(args[0]);
  }
}

const db = {
  runAsync: (sql: string, ...args: unknown[]) => {
    run(sql, args);
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  },
  getFirstAsync: () => Promise.resolve({ n: 0 }),
  getAllAsync: (sql: string) =>
    Promise.resolve(
      sql.includes("entity = 'media'")
        ? rows.filter((row) => row.entity === "media" && row.state === "queued")
        : rows,
    ),
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
  withSyncTransaction: async (_db: unknown, task: () => Promise<void>) => task(),
}));
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: () => Promise.resolve(),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000000" }));
vi.mock("./mirrorStore", () => ({
  upsertCanyon: () => Promise.resolve(),
  upsertTrip: () => Promise.resolve(),
  upsertWaypoint: () => Promise.resolve(),
}));
vi.mock("./mediaUpload", () => ({
  runMediaCreateOp: (row: { seq: number }) => {
    mediaRuns.push(row.seq);
    if (deadMedia.has(row.seq)) return Promise.reject(new Error("file gone"));
    rows = rows.filter((candidate) => candidate.seq !== row.seq);
    return Promise.resolve("done");
  },
  runMediaDeleteOp: () => Promise.resolve("done"),
}));
vi.mock("../api/apiFetch", () => ({
  apiFetch: (_path: string, init: { body: { ops: { opId: string }[] } }) => {
    const opIds = init.body.ops.map((op) => op.opId);
    pushCalls.push(opIds);
    if (opIds.some((opId) => poison.has(opId))) {
      return Promise.reject(Object.assign(new Error("bad op"), { status: 400 }));
    }
    const results = opIds.map((opId) => ({ opId, status: "applied" }));
    if (resultCountDelta > 0) {
      results.push({ opId: "op-ghost", status: "applied" });
    } else if (resultCountDelta < 0) {
      results.pop();
    }
    return Promise.resolve({ results });
  },
}));

const { flushOutbox } = await import("./flush");

beforeEach(() => {
  rows = [];
  poison = new Set();
  pushCalls = [];
  deadMedia = new Set();
  mediaRuns = [];
  resultCountDelta = 0;
});

describe("push result correlation", () => {
  // Positional results, one per op. A count mismatch is not a per-op verdict
  // either way: an EXTRA result used to index past the batch and crash with an
  // opaque TypeError ("Couldn't sync"), and a SHORT one left the trailing ops
  // inflight with attempts already bumped, recovered only by the next cycle's
  // blanket reset.
  it("refuses a reply with more results than ops", async () => {
    rows = [pushRow(1), pushRow(2)];
    resultCountDelta = 1;
    await expect(flushOutbox()).rejects.toThrow("correlation mismatch");
  });

  it("refuses a reply with fewer results than ops", async () => {
    rows = [pushRow(1), pushRow(2)];
    resultCountDelta = -1;
    await expect(flushOutbox()).rejects.toThrow("correlation mismatch");
    // Nothing was treated as applied on the strength of a partial reply.
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
  });
});

describe("media pass", () => {
  it("keeps going past a dead op instead of aborting the pass", async () => {
    rows = [mediaRow(1), mediaRow(2), mediaRow(3)];
    deadMedia.add(1);

    await expect(flushOutbox()).rejects.toThrow();

    // Every op got its turn; only the dead one is left.
    expect(mediaRuns).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.seq)).toEqual([1]);
  });

  it("parks an op that keeps failing, so it reaches Sync Issues", async () => {
    // Statusless failures (a reclaimed cache file) can never be classified as
    // permanent, so the attempt count is the backstop.
    rows = [mediaRow(1, { attempts: 4 })];
    deadMedia.add(1);

    await expect(flushOutbox()).rejects.toThrow();

    expect(rows[0].state).toBe("blocked");
    expect(String(rows[0].error_json)).toContain("keeps failing");
  });

  it("requeues a failure that still has attempts left", async () => {
    rows = [mediaRow(1)];
    deadMedia.add(1);

    await expect(flushOutbox()).rejects.toThrow();

    expect(rows[0].state).toBe("queued");
    expect(rows[0].attempts).toBe(1);
  });
});

describe("envelope-level rejection", () => {
  it("parks only the offending op, not the whole batch", async () => {
    rows = [pushRow(1), pushRow(2), pushRow(3), pushRow(4)];
    poison.add("op-3");

    await flushOutbox();

    // 1, 2 and 4 applied and are gone; 3 is parked with a rejection to act on.
    expect(rows.map((row) => row.seq)).toEqual([3]);
    expect(rows[0].state).toBe("blocked");
  });

  it("bisects rather than re-sending one op at a time", async () => {
    rows = Array.from({ length: 8 }, (_, index) => pushRow(index + 1));
    poison.add("op-6");

    await flushOutbox();

    // 8 → [1-4] ok → [5-8] → [5,6] → [5] ok → [6] parked → [7,8] ok: seven
    // requests, and the last of them carries the poison op alone.
    expect(pushCalls).toHaveLength(7);
    expect(pushCalls).toContainEqual(["op-6"]);
    expect(rows.map((row) => row.seq)).toEqual([6]);
  });

  it("drains a clean batch in one request", async () => {
    rows = [pushRow(1), pushRow(2)];

    await flushOutbox();

    expect(pushCalls).toEqual([["op-1", "op-2"]]);
    expect(rows).toEqual([]);
  });
});
