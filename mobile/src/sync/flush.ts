// Outbox flush engine (stage8-sync.md §8.3): take the next ≤50 ready ops
// (shared dependency-closure selection), POST /sync/push, apply per-op
// results. Batch is not atomic server-side; every op class is idempotent, so
// a network drop mid-batch is safe to replay whole.
import {
  collectDirtyFields,
  filterSelfConflicts,
  selectFlushBatch,
  SYNC_PROTOCOL,
  SYNC_PUSH_MAX_OPS,
  type OutboxEntry,
  type SyncDeltaCanyonRow,
  type SyncDeltaTripRow,
  type SyncDeltaWaypointRow,
  type SyncPushOpResult,
  type SyncPushResponse,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { loadOutboxRows, rowToEntry, type OutboxRow } from "./outbox";
import {
  runMediaCreateOp,
  runMediaDeleteOp,
  type MediaOpRow,
} from "./mediaUpload";
import { upsertCanyon, upsertTrip, upsertWaypoint } from "./mirrorStore";
import { getSyncDb, notifyMirrorChanged } from "./syncDb";

/** Flush to drain (or until only parked/deferred ops remain). Serialized by
 * the sync engine — never call concurrently. Push ops (canyon/trip/waypoint/
 * notification) go through POST /sync/push in dependency-closure batches;
 * media ops run their own three-phase / REST flow (§7.1, §8.3 interleave). */
export async function flushOutbox(): Promise<void> {
  const db = await getSyncDb();

  // Crash recovery: ops stranded inflight by a killed process are replay-
  // safe (§8.1 idempotency) — requeue them.
  await db.runAsync("UPDATE outbox SET state = 'queued' WHERE state = 'inflight'");

  for (;;) {
    const rows = await loadOutboxRows();
    const byOpId = new Map(rows.map((row) => [row.op_id, row]));
    // Media ops are NOT push ops (push refuses media, §8.1) — exclude them
    // from the push batch and run them separately below.
    const pushEntries = rows
      .filter((row) => row.entity !== "media")
      .map(rowToEntry);
    const { ready } = selectFlushBatch(pushEntries, SYNC_PUSH_MAX_OPS);
    if (ready.length === 0) {
      // No push work left: run pending media ops. If they make progress, loop
      // (a media confirm may unblock nothing here, but keeps the drain simple);
      // otherwise the outbox is drained-or-parked and we're done.
      const progressed = await flushMediaOps();
      if (progressed) continue;
      return;
    }

    const seqs = ready.map((entry) => entry.seq);
    await db.runAsync(
      `UPDATE outbox SET state = 'inflight', attempts = attempts + 1
       WHERE seq IN (${seqs.map(() => "?").join(",")})`,
      ...seqs,
    );

    let response: SyncPushResponse;
    try {
      response = await apiFetch<SyncPushResponse>("/sync/push", {
        method: "POST",
        body: { protocol: SYNC_PROTOCOL, ops: ready.map((entry) => entry.op) },
      });
    } catch (err) {
      // Network / 5xx / 429: requeue the batch; the engine owns backoff.
      await db.runAsync(
        "UPDATE outbox SET state = 'queued' WHERE state = 'inflight'",
      );
      throw err;
    }

    let mirrorTouched = false;
    for (const [index, result] of response.results.entries()) {
      const entry = ready[index];
      if (entry.op.opId !== result.opId) {
        // Results are positional per the contract; a mismatch means the
        // server and client disagree about the batch — stop, resync later.
        throw new Error("push result correlation mismatch");
      }
      const row = byOpId.get(result.opId);
      if (!row) continue;
      mirrorTouched =
        (await applyOpResult(db, row, entry, result)) || mirrorTouched;
    }
    if (mirrorTouched) notifyMirrorChanged();
  }
}

async function applyOpResult(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  row: OutboxRow,
  entry: OutboxEntry,
  result: SyncPushOpResult,
): Promise<boolean> {
  switch (result.status) {
    case "applied":
    case "alreadyApplied":
    case "appliedWithConflict": {
      await db.runAsync("DELETE FROM outbox WHERE seq = ?", row.seq);

      if (result.status === "appliedWithConflict" && result.conflicts?.length) {
        // Server over-reports by contract (§6) — drop receipts whose
        // serverValue matches the base this edit was made against.
        const base = row.base_fields_json
          ? (JSON.parse(row.base_fields_json) as Record<string, unknown>)
          : {};
        const real = filterSelfConflicts(result.conflicts, base);
        const at = new Date().toISOString();
        for (const receipt of real) {
          await db.runAsync(
            `INSERT INTO conflict_shelf
               (entity, entity_id, field, shelved_json, server_json, at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            row.entity,
            row.entity_id,
            receipt.field,
            JSON.stringify(receipt.serverValue ?? null),
            JSON.stringify(receipt.serverValue ?? null),
            at,
          );
        }
      }

      // Server-confirmed row → mirror, rebased over whatever ops remain.
      if (result.row && entry.op.op !== "delete") {
        await applyConfirmedRow(db, entry, result.row);
      }
      return true;
    }
    case "rejected": {
      const isGone = result.error?.code === 404 && entry.op.op !== "create";
      await db.runAsync(
        "UPDATE outbox SET state = ?, error_json = ? WHERE seq = ?",
        // Edit-on-deleted (§6 delete-wins): park as deadRemote so the UI
        // offers "recreate"; other rejections park blocked.
        isGone ? "deadRemote" : "blocked",
        JSON.stringify(result.error ?? { code: 400, message: "rejected" }),
        row.seq,
      );
      return false;
    }
    case "dependencyFailed": {
      // Leave queued; re-evaluated when the blocker resolves.
      await db.runAsync(
        "UPDATE outbox SET state = 'queued' WHERE seq = ?",
        row.seq,
      );
      return false;
    }
  }
}

async function applyConfirmedRow(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  entry: OutboxEntry,
  serverRow: unknown,
): Promise<void> {
  const remaining = (await loadOutboxRows()).map(rowToEntry);
  const rebased = (base: Record<string, unknown>) => {
    const dirty = collectDirtyFields(remaining, entry.op.entity, entry.op.id);
    return {
      effective: { ...base, ...dirty },
      dirtyNames: Object.keys(dirty),
    };
  };

  switch (entry.op.entity) {
    case "canyon": {
      // Push results return the raw row (no syncRole); only own rows are
      // pushable, so the caller is the owner.
      const base = {
        syncRole: "owner",
        ...(serverRow as object),
      } as SyncDeltaCanyonRow;
      const { effective, dirtyNames } = rebased(
        base as unknown as Record<string, unknown>,
      );
      await upsertCanyon(db, effective as unknown as SyncDeltaCanyonRow, dirtyNames);
      break;
    }
    case "tripLog": {
      const { effective, dirtyNames } = rebased(
        serverRow as Record<string, unknown>,
      );
      await upsertTrip(db, effective as unknown as SyncDeltaTripRow, dirtyNames);
      break;
    }
    case "waypoint": {
      const { effective, dirtyNames } = rebased(
        serverRow as Record<string, unknown>,
      );
      await upsertWaypoint(
        db,
        effective as unknown as SyncDeltaWaypointRow,
        dirtyNames,
      );
      break;
    }
    case "notification":
      break;
  }
}

// ── media ops (§7.1, §7.2) ───────────────────────────────────────────────────
//
// Media creates run the three-phase presign→PUT→confirm flow; deletes hit
// REST DELETE. Sequential (the spec allows concurrency 2 — a modest field
// photo count doesn't need it, and sequential keeps ordering trivial). A
// media create waits until its linked entity has no pending outbox op (§7.2
// dependency): a still-queued or blocked canyon/trip create for the same
// linkedId would send the upload into a guaranteed 404.

async function flushMediaOps(): Promise<boolean> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<MediaOpRow & { op: string }>(
    `SELECT seq, entity_id, op, fields_json, media_phase FROM outbox
     WHERE entity = 'media' AND state = 'queued' ORDER BY seq ASC`,
  );
  let progressed = false;
  let mirrorTouched = false;

  for (const row of rows) {
    if (row.op === "create" && (await isLinkPending(db, row))) continue;

    await db.runAsync("UPDATE outbox SET state = 'inflight' WHERE seq = ?", row.seq);
    try {
      const outcome =
        row.op === "delete"
          ? await runMediaDeleteOp(row)
          : await runMediaCreateOp(row);
      if (outcome === "done") {
        progressed = true;
        mirrorTouched = true;
      }
      // 'blocked' already set its own state inside the op runner.
    } catch (err) {
      // Network / 5xx: requeue and defer to the engine's backoff.
      await db.runAsync(
        "UPDATE outbox SET state = 'queued' WHERE seq = ? AND state = 'inflight'",
        row.seq,
      );
      if (mirrorTouched) notifyMirrorChanged();
      throw err;
    }
  }

  if (mirrorTouched) notifyMirrorChanged();
  return progressed;
}

/** A media create must wait for its linked entity's create to fully flush:
 * any outbox row still targeting linkedId (queued create, or a parked one)
 * means the row may not exist server-side yet. */
async function isLinkPending(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  row: MediaOpRow,
): Promise<boolean> {
  const fields = JSON.parse(row.fields_json ?? "{}") as { linkedId?: string };
  if (!fields.linkedId) return false;
  const pending = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox WHERE entity_id = ? AND entity != 'media'",
    fields.linkedId,
  );
  return (pending?.n ?? 0) > 0;
}
