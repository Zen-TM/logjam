import { describe, it, expect } from "vitest";
import {
  collectDirtyFields,
  computeBackoffMs,
  filterSelfConflicts,
  planOutboxEnqueue,
  rebaseRow,
  selectFlushBatch,
  SYNC_BACKOFF_MAX_MS,
  SYNC_BACKOFF_MIN_MS,
  type OutboxEntry,
} from "./syncClient.js";
import { pushOpDependencies, type SyncPushOp } from "./sync.js";

const CANYON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CANYON_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TRIP_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WP_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

let opCounter = 0;
function op(partial: Partial<SyncPushOp> & Pick<SyncPushOp, "entity" | "op" | "id">): SyncPushOp {
  return { opId: `op-${++opCounter}`, ...partial };
}

function entry(
  seq: number,
  o: SyncPushOp,
  state: OutboxEntry["state"] = "queued",
  attempts = 0,
): OutboxEntry {
  return { seq, state, attempts, op: o };
}

describe("planOutboxEnqueue (§8.2 coalescing)", () => {
  it("update folds into a still-queued create for the same row", () => {
    const create = op({
      entity: "canyon",
      op: "create",
      id: CANYON_A,
      fields: { name: "X", latitude: -33.6, longitude: 150.2 },
    });
    const plan = planOutboxEnqueue(
      [entry(1, create)],
      op({ entity: "canyon", op: "update", id: CANYON_A, fields: { notes: "n" } }),
    );
    expect(plan).toEqual({
      dropSeqs: [],
      mergeIntoSeq: 1,
      mergedFields: { name: "X", latitude: -33.6, longitude: 150.2, notes: "n" },
    });
  });

  it("update merges into the queue-TAIL update on the same row, later fields win", () => {
    const entries = [
      entry(1, op({ entity: "canyon", op: "update", id: CANYON_A, fields: { notes: "old", quality: 3 } })),
    ];
    const plan = planOutboxEnqueue(
      entries,
      op({ entity: "canyon", op: "update", id: CANYON_A, fields: { notes: "new" } }),
    );
    expect(plan.mergeIntoSeq).toBe(1);
    expect(plan.mergedFields).toEqual({ notes: "new", quality: 3 });
  });

  it("update does NOT merge across an intervening op (would reorder)", () => {
    const entries = [
      entry(1, op({ entity: "canyon", op: "update", id: CANYON_A, fields: { notes: "a" } })),
      entry(2, op({ entity: "waypoint", op: "create", id: WP_A, fields: { name: "w" } })),
    ];
    const plan = planOutboxEnqueue(
      entries,
      op({ entity: "canyon", op: "update", id: CANYON_A, fields: { quality: 4 } }),
    );
    expect(plan.mergeIntoSeq).toBeUndefined();
    expect(plan.append).toBeDefined();
  });

  it("update never merges into an inflight or parked op", () => {
    for (const state of ["inflight", "blocked"] as const) {
      const entries = [
        entry(1, op({ entity: "canyon", op: "update", id: CANYON_A, fields: { notes: "a" } }), state),
      ];
      const plan = planOutboxEnqueue(
        entries,
        op({ entity: "canyon", op: "update", id: CANYON_A, fields: { notes: "b" } }),
      );
      expect(plan.mergeIntoSeq).toBeUndefined();
      expect(plan.append).toBeDefined();
    }
  });

  it("delete after queued create drops the whole lineage, enqueues nothing", () => {
    const entries = [
      entry(1, op({ entity: "canyon", op: "create", id: CANYON_A, fields: { name: "X" } })),
      entry(2, op({ entity: "canyon", op: "update", id: CANYON_A, fields: { notes: "n" } })),
    ];
    const plan = planOutboxEnqueue(
      entries,
      op({ entity: "canyon", op: "delete", id: CANYON_A }),
    );
    expect(plan.dropSeqs).toEqual([1, 2]);
    expect(plan.append).toBeUndefined();
  });

  it("delete after queued updates drops the updates, keeps the delete", () => {
    const entries = [
      entry(1, op({ entity: "canyon", op: "update", id: CANYON_A, fields: { notes: "n" } })),
    ];
    const del = op({ entity: "canyon", op: "delete", id: CANYON_A });
    const plan = planOutboxEnqueue(entries, del);
    expect(plan.dropSeqs).toEqual([1]);
    expect(plan.append).toBe(del);
  });

  it("delete does not cancel a create that has already been SENT", () => {
    // Back in the queue after a network failure or a process kill — the
    // server may hold the row regardless. Cancelling here let the create
    // stand server-side while the delete was thrown away.
    const entries = [
      entry(
        1,
        op({ entity: "canyon", op: "create", id: CANYON_A, fields: { name: "X" } }),
        "queued",
        1,
      ),
    ];
    const del = op({ entity: "canyon", op: "delete", id: CANYON_A });
    const plan = planOutboxEnqueue(entries, del);
    expect(plan.dropSeqs).toEqual([1]);
    expect(plan.append).toBe(del);
  });

  it("delete does not cancel an inflight create (server may have applied it)", () => {
    const entries = [
      entry(1, op({ entity: "canyon", op: "create", id: CANYON_A, fields: { name: "X" } }), "inflight"),
    ];
    const plan = planOutboxEnqueue(
      entries,
      op({ entity: "canyon", op: "delete", id: CANYON_A }),
    );
    expect(plan.dropSeqs).toEqual([]);
    expect(plan.append).toBeDefined();
  });

  it("duplicate notification markRead is dropped", () => {
    const first = op({ entity: "notification", op: "markRead", id: TRIP_A });
    const entries = [entry(1, first)];
    const plan = planOutboxEnqueue(
      entries,
      op({ entity: "notification", op: "markRead", id: TRIP_A }),
    );
    expect(plan).toEqual({ dropSeqs: [] });
  });

  it("markUnread supersedes a queued markRead for the same notification", () => {
    const first = op({ entity: "notification", op: "markRead", id: TRIP_A });
    const unread = op({ entity: "notification", op: "markUnread", id: TRIP_A });
    const plan = planOutboxEnqueue([entry(1, first)], unread);
    expect(plan.dropSeqs).toEqual([1]);
    expect(plan.append).toBe(unread);
  });

  it("a read/unread fiddle leaves exactly one queued op, the last one", () => {
    // Enqueue three flips in a row, applying each plan as the outbox would.
    let entries: OutboxEntry[] = [];
    let seq = 0;
    for (const kind of ["markRead", "markUnread", "markRead"] as const) {
      const incoming = op({ entity: "notification", op: kind, id: TRIP_A });
      const plan = planOutboxEnqueue(entries, incoming);
      entries = entries.filter((e) => !plan.dropSeqs.includes(e.seq));
      if (plan.append) entries = [...entries, entry((seq += 1), plan.append)];
    }
    expect(entries.map((e) => e.op.op)).toEqual(["markRead"]);
  });

  it("a notification delete cancels its queued read-state op", () => {
    const del = op({ entity: "notification", op: "delete", id: TRIP_A });
    const plan = planOutboxEnqueue(
      [entry(1, op({ entity: "notification", op: "markRead", id: TRIP_A }))],
      del,
    );
    expect(plan.dropSeqs).toEqual([1]);
    expect(plan.append).toBe(del);
  });
});

describe("selectFlushBatch (§8.3 dependency closure)", () => {
  it("takes queued ops in seq order up to max", () => {
    const entries = [
      entry(1, op({ entity: "canyon", op: "create", id: CANYON_A, fields: {} })),
      entry(2, op({ entity: "waypoint", op: "create", id: WP_A, fields: {} })),
      entry(3, op({ entity: "canyon", op: "update", id: CANYON_A, fields: {} })),
    ];
    const { ready, deferred } = selectFlushBatch(entries, 2);
    expect(ready.map((e) => e.seq)).toEqual([1, 2]);
    expect(deferred).toEqual([]);
  });

  it("defers ops depending on a parked op's entity, transitively", () => {
    const entries = [
      entry(1, op({ entity: "canyon", op: "create", id: CANYON_A, fields: {} }), "blocked"),
      entry(2, op({ entity: "tripLog", op: "create", id: TRIP_A, fields: { canyonIds: [CANYON_A] } })),
      entry(3, op({ entity: "tripLog", op: "update", id: TRIP_A, fields: { notes: "n" } })),
      entry(4, op({ entity: "waypoint", op: "create", id: WP_A, fields: { canyonId: CANYON_B } })),
    ];
    const { ready, deferred } = selectFlushBatch(entries, 50);
    expect(ready.map((e) => e.seq)).toEqual([4]);
    expect(deferred.map((e) => e.seq)).toEqual([2, 3]);
  });

  it("deadRemote parks block dependents too", () => {
    const entries = [
      entry(1, op({ entity: "canyon", op: "update", id: CANYON_A, fields: {} }), "deadRemote"),
      entry(2, op({ entity: "waypoint", op: "create", id: WP_A, fields: { canyonId: CANYON_A } })),
    ];
    const { ready, deferred } = selectFlushBatch(entries, 50);
    expect(ready).toEqual([]);
    expect(deferred.map((e) => e.seq)).toEqual([2]);
  });

  it("a delete of the blocked row itself stays ready (discard path)", () => {
    const entries = [
      entry(1, op({ entity: "canyon", op: "update", id: CANYON_A, fields: {} }), "blocked"),
      entry(2, op({ entity: "canyon", op: "delete", id: CANYON_A })),
    ];
    const { ready } = selectFlushBatch(entries, 50);
    expect(ready.map((e) => e.seq)).toEqual([2]);
  });
});

describe("filterSelfConflicts (§6 over-report contract)", () => {
  it("drops receipts whose serverValue equals the client base value", () => {
    const receipts = [
      { field: "notes", serverValue: "web edit" },
      { field: "quality", serverValue: null },
    ];
    const base = { notes: "original", quality: null };
    expect(filterSelfConflicts(receipts, base)).toEqual([
      { field: "notes", serverValue: "web edit" },
    ]);
  });

  it("treats undefined base and null serverValue as equal", () => {
    expect(
      filterSelfConflicts([{ field: "symbol", serverValue: null }], {}),
    ).toEqual([]);
  });

  it("compares arrays structurally", () => {
    const base = { canyonIds: ["a", "b"] };
    expect(
      filterSelfConflicts([{ field: "canyonIds", serverValue: ["a", "b"] }], base),
    ).toEqual([]);
    expect(
      filterSelfConflicts([{ field: "canyonIds", serverValue: ["b", "a"] }], base),
    ).toEqual([{ field: "canyonIds", serverValue: ["b", "a"] }]);
  });
});

describe("collectDirtyFields + rebaseRow (§8.5)", () => {
  it("merges pending op fields in seq order; server fields not dirty track the server", () => {
    const entries = [
      entry(1, op({ entity: "canyon", op: "update", id: CANYON_A, fields: { notes: "first", quality: 3 } })),
      entry(2, op({ entity: "canyon", op: "update", id: CANYON_A, fields: { notes: "second" } })),
      entry(3, op({ entity: "canyon", op: "update", id: CANYON_B, fields: { notes: "other row" } })),
    ];
    const dirty = collectDirtyFields(entries, "canyon", CANYON_A);
    expect(dirty).toEqual({ notes: "second", quality: 3 });

    const server = { id: CANYON_A, name: "Server name", notes: "server", quality: 5 };
    expect(rebaseRow(server, dirty)).toEqual({
      id: CANYON_A,
      name: "Server name",
      notes: "second",
      quality: 3,
    });
  });

  it("skips deadRemote ops and deletes; creates contribute their payload", () => {
    const entries = [
      entry(1, op({ entity: "waypoint", op: "create", id: WP_A, fields: { name: "w", latitude: -33.6 } })),
      entry(2, op({ entity: "waypoint", op: "update", id: WP_A, fields: { name: "w2" } }), "deadRemote"),
      entry(3, op({ entity: "waypoint", op: "delete", id: WP_A })),
    ];
    expect(collectDirtyFields(entries, "waypoint", WP_A)).toEqual({
      name: "w",
      latitude: -33.6,
    });
  });
});

describe("computeBackoffMs", () => {
  it("stays within [min/2·2^n, cap] and is deterministic under injected random", () => {
    expect(computeBackoffMs(0, () => 0)).toBe(SYNC_BACKOFF_MIN_MS / 2);
    expect(computeBackoffMs(0, () => 1)).toBe(SYNC_BACKOFF_MIN_MS);
    expect(computeBackoffMs(3, () => 1)).toBe(8_000);
    expect(computeBackoffMs(20, () => 1)).toBe(SYNC_BACKOFF_MAX_MS);
    expect(computeBackoffMs(20, () => 0)).toBe(SYNC_BACKOFF_MAX_MS / 2);
  });
});

describe("pushOpDependencies (shared single source)", () => {
  it("update/delete depend on own row; canyon refs extracted from fields", () => {
    expect(
      pushOpDependencies(op({ entity: "tripLog", op: "update", id: TRIP_A, fields: { canyonIds: [CANYON_A] } })),
    ).toEqual([TRIP_A, CANYON_A]);
    expect(
      pushOpDependencies(op({ entity: "waypoint", op: "create", id: WP_A, fields: { canyonId: CANYON_B } })),
    ).toEqual([CANYON_B]);
  });
});
