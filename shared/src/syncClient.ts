// Stage 8 client sync engine — the pure core (stage8-sync.md §8.2, §8.3,
// §8.5). Everything here is deterministic and storage-agnostic: the mobile
// flush engine maps SQLite outbox rows into these shapes, applies the
// returned plans, and owns all I/O. Web PWA adoption is a stated maybe
// (§13.4) — nothing in this file may assume React Native.
import {
  pushOpDependencies,
  type SyncConflictReceipt,
  type SyncPushOp,
} from "./sync.js";

/** Outbox op lifecycle (§9 outbox.state). `queued` is flushable; `inflight`
 * is mid-flush (crash recovery resets it to queued — replay is safe by
 * §8.1's idempotency); `blocked` is parked on a terminal rejection;
 * `deadRemote` is parked because the server row was deleted (§6 delete-wins).
 * Media macro-ops additionally persist three-phase progress (§7.1) in
 * `mediaPhase`, not in `state`. */
export type OutboxState = "queued" | "inflight" | "blocked" | "deadRemote";

export type OutboxEntry = {
  /** Local monotonic FIFO sequence — never reordered (§8.2). */
  seq: number;
  state: OutboxState;
  /** Push attempts made. Nonzero means the op HAS been sent, so the server
   * may hold its effect even though the op is back in the queue. */
  attempts: number;
  op: SyncPushOp;
};

// ── Enqueue coalescing (§8.2) ────────────────────────────────────────────────
//
// Coalescing must never reorder ops. The only allowed folds:
//  - update into a still-queued create for the same row (fold moves the
//    fields EARLIER, which is always safe: nothing between them can read the
//    row server-side before the create lands);
//  - update into the queue-tail update for the same row (adjacent merge);
//  - delete cancels the row's queued ops (create+delete → drop both and the
//    delete; update+delete → drop updates, keep delete);
//  - a notification read-state op (markRead / markUnread) supersedes a queued
//    one for the same row, and is dropped when the queue tail already says the
//    same thing. It used to be a plain duplicate-drop, which was only right
//    while the bit was monotonic; with mark-as-unread the LAST op wins, and a
//    read→unread→read run must not leave the first two on the queue.
// Ops not in `queued` state (inflight/parked) are never coalesced into — the
// server may already have seen them.

export type EnqueuePlan = {
  /** Seqs to delete from the outbox (delete-cancellation). */
  dropSeqs: number[];
  /** Merge `fields` into this existing op instead of appending. */
  mergeIntoSeq?: number;
  /** Field map to write on mergeIntoSeq (already merged). */
  mergedFields?: Record<string, unknown>;
  /** Append the incoming op as a new row (absent when folded/dropped). */
  append?: SyncPushOp;
};

/** The notification read bit, in either direction — one state, two ops. */
function isReadStateOp(op: SyncPushOp["op"]): boolean {
  return op === "markRead" || op === "markUnread";
}

export function planOutboxEnqueue(
  entries: OutboxEntry[],
  incoming: SyncPushOp,
): EnqueuePlan {
  const sameRowQueued = entries.filter(
    (entry) =>
      entry.state === "queued" &&
      entry.op.entity === incoming.entity &&
      entry.op.id === incoming.id,
  );

  if (isReadStateOp(incoming.op)) {
    const queuedReadOps = sameRowQueued.filter((entry) =>
      isReadStateOp(entry.op.op),
    );
    const last = queuedReadOps[queuedReadOps.length - 1];
    // The queue already ends in this state: nothing to add, nothing to drop.
    if (last?.op.op === incoming.op) return { dropSeqs: [] };
    // Otherwise the newest op is the whole truth — the superseded ones carry no
    // fields, so dropping them cannot lose anything, and one op per row keeps a
    // read/unread fiddle from filling the outbox.
    return { dropSeqs: queuedReadOps.map((entry) => entry.seq), append: incoming };
  }

  if (incoming.op === "delete") {
    // `queued` is NOT proof the create never left the device: a network
    // failure after the request was sent, or a process kill mid-flight, both
    // return an op to `queued`. Cancelling the pair in that case discarded a
    // delete for a row the server had actually committed — the canyon came
    // back on the next pull and the user's delete had silently done nothing.
    // `attempts === 0` is the real "never sent" test.
    const unsentCreate = sameRowQueued.find(
      (entry) => entry.op.op === "create" && entry.attempts === 0,
    );
    const dropSeqs = sameRowQueued.map((entry) => entry.seq);
    // Row never reached the server: cancel everything, enqueue nothing.
    if (unsentCreate) return { dropSeqs };
    // Row may exist server-side: pending updates are moot, the delete stands.
    return { dropSeqs, append: incoming };
  }

  if (incoming.op === "update") {
    const queuedCreate = sameRowQueued.find((entry) => entry.op.op === "create");
    if (queuedCreate) {
      return {
        dropSeqs: [],
        mergeIntoSeq: queuedCreate.seq,
        mergedFields: { ...queuedCreate.op.fields, ...incoming.fields },
      };
    }
    // Adjacent-merge only: the merge target must be the queue TAIL, else the
    // merged fields would jump over ops enqueued after it (reordering).
    const tail = entries[entries.length - 1];
    if (
      tail !== undefined &&
      tail.state === "queued" &&
      tail.op.op === "update" &&
      tail.op.entity === incoming.entity &&
      tail.op.id === incoming.id
    ) {
      return {
        dropSeqs: [],
        mergeIntoSeq: tail.seq,
        mergedFields: { ...tail.op.fields, ...incoming.fields },
      };
    }
  }

  return { dropSeqs: [], append: incoming };
}

// ── Flush batch selection (§8.3 dependency closure) ─────────────────────────
//
// A batch is the next ≤ max queued ops, in seq order, skipping any op that
// depends (pushOpDependencies) on an entity id owned by a parked op OR by an
// op skipped earlier in this pass — the closure propagates so a media/trip
// op never flies into a guaranteed 404 behind its parked canyon create.

export type BatchSelection = {
  ready: OutboxEntry[];
  /** Queued ops held back by the closure this pass (left queued). */
  deferred: OutboxEntry[];
};

export function selectFlushBatch(
  entries: OutboxEntry[],
  max: number,
): BatchSelection {
  const blockedIds = new Set<string>();
  for (const entry of entries) {
    if (entry.state === "blocked" || entry.state === "deadRemote") {
      blockedIds.add(entry.op.id);
    }
  }

  const ready: OutboxEntry[] = [];
  const deferred: OutboxEntry[] = [];
  for (const entry of entries) {
    if (entry.state !== "queued") continue;
    if (ready.length >= max) break;
    // A dependency on a blocked id defers the op — except a delete of the
    // blocked row itself, which is how the user discards a parked lineage.
    const dependsOnBlocked = pushOpDependencies(entry.op).some(
      (dep) => blockedIds.has(dep) && !(entry.op.op === "delete" && dep === entry.op.id),
    );
    if (dependsOnBlocked) {
      deferred.push(entry);
      // Anything downstream of this op's row is transitively stuck.
      blockedIds.add(entry.op.id);
      continue;
    }
    ready.push(entry);
  }
  return { ready, deferred };
}

// ── Conflict receipts — client-side self-conflict filter (§6, §8.5) ─────────
//
// CONTRACT (mirrors conflictReceipts in api/src/routes/sync.ts): the server
// has no per-field history, so it over-reports — a receipt means "this is
// the value your write replaced while your base was stale". The client holds
// the base row, so a receipt whose serverValue equals the client's own base
// value is a self-conflict (nobody else touched the field) and is dropped
// before shelving.

export function filterSelfConflicts(
  receipts: SyncConflictReceipt[],
  baseRow: Record<string, unknown>,
): SyncConflictReceipt[] {
  return receipts.filter(
    (receipt) =>
      JSON.stringify(receipt.serverValue ?? null) !==
      JSON.stringify(baseRow[receipt.field] ?? null),
  );
}

// ── Rebase-on-pull (§8.5) ────────────────────────────────────────────────────
//
// Mirror rows hold server-confirmed state; dirty local edits live as outbox
// ops. The effective row the UI renders = server row + pending dirty fields
// replayed over it. On delta upsert the mobile side calls collectDirtyFields
// for the row and re-applies them on top of the fresh server state, so
// fields NOT locally dirty always track the server.

/** Merged dirty-field map from a row's pending (queued or parked-but-not-
 * dead) ops, in seq order — later ops win a field. Creates contribute their
 * full payload (the whole row is local until the create lands). */
export function collectDirtyFields(
  entries: OutboxEntry[],
  entity: SyncPushOp["entity"],
  entityId: string,
): Record<string, unknown> {
  const dirty: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.state === "deadRemote") continue;
    if (entry.op.entity !== entity || entry.op.id !== entityId) continue;
    if (entry.op.op === "delete" || isReadStateOp(entry.op.op)) continue;
    Object.assign(dirty, entry.op.fields);
  }
  return dirty;
}

export function rebaseRow(
  serverRow: Record<string, unknown>,
  dirtyFields: Record<string, unknown>,
): Record<string, unknown> {
  return { ...serverRow, ...dirtyFields };
}

// ── Retry backoff (§8.3) ─────────────────────────────────────────────────────

export const SYNC_BACKOFF_MIN_MS = 1_000;
export const SYNC_BACKOFF_MAX_MS = 300_000;

/**
 * Exponential backoff with full jitter in the upper half: attempt 0 → ~1 s,
 * doubling to the 5 min cap. `random` is injectable for tests (defaults to
 * Math.random).
 */
export function computeBackoffMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(
    SYNC_BACKOFF_MIN_MS * 2 ** Math.max(0, attempt),
    SYNC_BACKOFF_MAX_MS,
  );
  return Math.round(base / 2 + random() * (base / 2));
}
