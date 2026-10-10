// Outbox flush engine (stage8-sync.md §8.3): take the next ≤50 ready ops
// (shared dependency-closure selection), POST /sync/push, apply per-op
// results. Batch is not atomic server-side; every op class is idempotent, so
// a network drop mid-batch is safe to replay whole.
import {
  collectDirtyFields,
  filterSelfConflicts,
  isTransientSyncError,
  parseSyncDeltaPlaceRow,
  parseSyncDeltaTripRow,
  parseSyncDeltaPlaceLinkRow,
  selectFlushBatch,
  shouldGiveUpOnSyncOp,
  SYNC_PROTOCOL,
  SYNC_PUSH_MAX_OPS,
  tallySyncFailure,
  type OutboxEntry,
  type SyncPushOpResult,
  type SyncPushResponse,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { isNoResponse, isTransferCut } from "../api/noResponse";
import {
  loadOutboxRows,
  loadOutboxRowsFor,
  rowToEntry,
  type OutboxRow,
} from "./outbox";
import {
  runMediaCreateOp,
  runMediaDeleteOp,
  runMediaLinkOp,
  runMediaRenameOp,
  type MediaOpRow,
  type MediaOpOutcome,
} from "./mediaUpload";
import { upsertPlace, upsertPlaceLink, upsertTrip } from "./mirrorStore";
import { getSyncDb, notifyMirrorChanged } from "./syncDb";

/**
 * An op's last error record, which is also where its failure tally lives
 * (`tallySyncFailure`): the count and its starting instant ride in
 * `error_json` beside the code, so they last exactly as long as the op stays
 * unsent and a manual Retry, which clears the column, starts them again.
 *
 * NOT `attempts`. That column counts SENDS, including every one that timed
 * out, and capping on it parked whatever was queued after a minute of bad
 * signal: the retry ladder starts at one second.
 */
function lastError(row: { error_json: string | null }): unknown {
  try {
    return row.error_json ? JSON.parse(row.error_json) : null;
  } catch {
    return null;
  }
}

/** What one flush pass left behind, for the engine to act on. */
export type FlushSummary = {
  /** Ops the server refused for a reason that may not hold next time. They are
   *  NOT the user's problem yet, and the engine schedules another cycle. */
  retrying: number;
};

/** Flush to drain (or until only parked/deferred ops remain). Serialized by
 * the sync engine — never call concurrently. Push ops (place/trip/link/
 * notification) go through POST /sync/push in dependency-closure batches;
 * media ops run their own three-phase / REST flow (§7.1, §8.3 interleave). */
export async function flushOutbox(): Promise<FlushSummary> {
  const db = await getSyncDb();

  // Crash recovery: ops stranded inflight by a killed process are replay-
  // safe (§8.1 idempotency) — requeue them.
  //
  // `retrying` is requeued in the same statement, and this is the ONLY place it
  // happens: one attempt per flush pass. Requeuing inside the loop below would
  // spin the same op against the same server for as long as it keeps failing.
  await db.runAsync(
    "UPDATE outbox SET state = 'queued' WHERE state IN ('inflight', 'retrying')",
  );

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
      return { retrying: await countRetrying(db) };
    }

    await sendBatch(db, ready, byOpId);
  }
}

/**
 * Post one batch and apply its per-op results.
 *
 * An envelope-level 400/413 is the whole REQUEST refused, which the server
 * does for a single structurally-bad op (`parsePushOp` throws before the
 * per-op loop even begins). Parking the batch turned one malformed op into up
 * to fifty separate Sync Issues, forty-nine of them telling the user the
 * server rejected an edit it never saw. Bisect instead: halve until the batch
 * is one op, and park exactly that op. Costs O(log n) extra requests on a
 * fault that should never happen, and nothing at all when it doesn't.
 */
async function sendBatch(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  batch: OutboxEntry[],
  byOpId: Map<string, OutboxRow>,
): Promise<void> {
  const seqs = batch.map((entry) => entry.seq);
  const placeholders = seqs.map(() => "?").join(",");
  await db.runAsync(
    `UPDATE outbox SET state = 'inflight', attempts = attempts + 1
     WHERE seq IN (${placeholders})`,
    ...seqs,
  );

  let response: SyncPushResponse;
  try {
    response = await apiFetch<SyncPushResponse>("/sync/push", {
      method: "POST",
      body: { protocol: SYNC_PROTOCOL, ops: batch.map((entry) => entry.op) },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    // 401/403 (token) and 429 (rate limit) and 5xx and network are transient —
    // requeue the batch and let the engine back off.
    if (status !== 400 && status !== 413) {
      await db.runAsync(
        `UPDATE outbox SET state = 'queued' WHERE seq IN (${placeholders})`,
        ...seqs,
      );
      throw err;
    }
    if (status === 413) {
      // The client caps at SYNC_PUSH_MAX_OPS, so an oversized batch is OUR
      // bug, not the user's. Say so where a developer will see it; the op
      // still parks below so nothing is lost.
      console.error(`sync push rejected as too large (${batch.length} ops)`);
    }
    if (batch.length === 1) {
      // The envelope 400 says nothing the UI can show, and the op's Sync Issue
      // deliberately stays generic — but a developer needs the server's actual
      // reason without pulling the outbox DB off the device.
      console.error(
        `sync push refused op ${batch[0].op.entity}/${batch[0].op.op}:`,
        (err as { serverMessage?: string }).serverMessage ?? status,
      );
      await db.runAsync(
        "UPDATE outbox SET state = 'blocked', error_json = ? WHERE seq = ?",
        JSON.stringify({
          code: status,
          message: "The server rejected this change. Retry or discard it.",
        }),
        seqs[0],
      );
      notifyMirrorChanged();
      return;
    }
    await db.runAsync(
      `UPDATE outbox SET state = 'queued' WHERE seq IN (${placeholders})`,
      ...seqs,
    );
    const mid = Math.ceil(batch.length / 2);
    await sendBatch(db, batch.slice(0, mid), byOpId);
    await sendBatch(db, batch.slice(mid), byOpId);
    return;
  }

  if (response.results.length !== batch.length) {
    // Results are positional per the contract, one per op. A SHORT reply left
    // the trailing ops inflight with attempts already bumped (recovered only
    // by the next cycle's blanket inflight→queued reset); a LONG one indexed
    // past the batch and crashed with an opaque TypeError. Neither is a
    // per-op verdict, so refuse the whole reply and let the retry re-send it.
    throw new Error("push result correlation mismatch");
  }

  let mirrorTouched = false;
  for (const [index, result] of response.results.entries()) {
    const entry = batch[index];
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
        // Server over-reports by contract (DESIGN.md §4) — drop receipts whose
        // serverValue matches the base this edit was made against.
        const base = row.base_fields_json
          ? (JSON.parse(row.base_fields_json) as Record<string, unknown>)
          : {};
        // `shelved_json` is what the USER wrote and `server_json` is what won
        // — the Sync Issues screen renders them as "Discarded" and "Kept".
        // Both columns used to be filled from serverValue, so the user was
        // shown the other device's value labelled as their own, and their own
        // was never recorded anywhere.
        const ownFields = row.fields_json
          ? (JSON.parse(row.fields_json) as Record<string, unknown>)
          : {};
        // A value one of this row's still-queued edits writes is this phone's
        // too: when a batch holding two edits to one field is replayed after
        // a lost reply, the first is told it replaced the second
        // (flush.test.ts). That edit is about to write the value again.
        const later = (await loadOutboxRowsFor(row.entity, row.entity_id)).map(
          (queued) =>
            queued.fields_json
              ? (JSON.parse(queued.fields_json) as Record<string, unknown>)
              : {},
        );
        const real = later.reduce(
          (kept, fields) => filterSelfConflicts(kept, base, fields),
          filterSelfConflicts(result.conflicts, base, ownFields),
        );
        const at = new Date().toISOString();
        // The server's own confirmed row is the name's source, and this is the
        // only moment it is guaranteed to be in hand: the mirror row can be
        // deleted later, taking with it the only answer to "which place was
        // this?" for a shelf entry the user may read weeks from now.
        const confirmed = result.row as
          | { name?: string | null; displayName?: string | null }
          | undefined;
        const entityName = confirmed?.name ?? confirmed?.displayName ?? null;
        for (const receipt of real) {
          await db.runAsync(
            `INSERT INTO conflict_shelf
               (entity, entity_id, field, shelved_json, server_json, at, entity_name)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            row.entity,
            row.entity_id,
            receipt.field,
            JSON.stringify(ownFields[receipt.field] ?? null),
            JSON.stringify(receipt.serverValue ?? null),
            at,
            entityName,
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
      const error = result.error ?? { code: 400, message: "rejected" };
      const isGone = error.code === 404 && entry.op.op !== "create";
      // A rejection the server may answer differently next time is OURS to
      // retry, not the user's. Parking every rejection put "Try again" in
      // front of someone for a 503 — asking them to press a button the app
      // could have pressed itself, and teaching them that the screen is full
      // of things that fix themselves. What reaches the user is what a retry
      // cannot fix: a refusal about the request (400/409/…), a row deleted
      // under the edit, or an op the server has kept refusing for a day
      // (`shouldGiveUpOnSyncOp`), however temporary each refusal claimed to be.
      const now = new Date();
      const tally =
        !isGone && isTransientSyncError(error.code)
          ? tallySyncFailure(lastError(row), now)
          : null;
      const retryable =
        tally !== null && !shouldGiveUpOnSyncOp(tally, true, now);
      await db.runAsync(
        "UPDATE outbox SET state = ?, error_json = ? WHERE seq = ?",
        // Edit-on-deleted (§6 delete-wins): park as deadRemote so the UI
        // offers "recreate"; other terminal rejections park blocked.
        isGone ? "deadRemote" : retryable ? "retrying" : "blocked",
        JSON.stringify(retryable ? { ...error, ...tally } : error),
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
  // Only this row's ops matter to the rebase, and this runs once per applied
  // op — reading the whole outbox here was fifty full-table scans per batch.
  const remaining = (await loadOutboxRowsFor(entry.op.entity, entry.op.id)).map(
    rowToEntry,
  );
  const rebased = <Row extends object>(base: Row) => {
    const dirty = collectDirtyFields(remaining, entry.op.entity, entry.op.id);
    return {
      effective: { ...base, ...dirty } as Row,
      dirtyNames: Object.keys(dirty),
    };
  };

  switch (entry.op.entity) {
    case "place": {
      // Push results return the raw row (no syncRole); only own rows are
      // pushable, so the caller is the owner.
      const base = parseSyncDeltaPlaceRow(
        typeof serverRow === "object" && serverRow !== null
          ? { syncRole: "owner", ...serverRow }
          : serverRow,
      );
      const { effective, dirtyNames } = rebased(base);
      await upsertPlace(db, effective, dirtyNames);
      break;
    }
    case "tripLog": {
      const base = parseSyncDeltaTripRow(serverRow);
      const { effective, dirtyNames } = rebased(base);
      await upsertTrip(db, effective, dirtyNames);
      break;
    }
    case "placeLink": {
      // No rebase: a link has no updatable field, so there is never a pending
      // local edit to lay over the server's row.
      await upsertPlaceLink(db, parseSyncDeltaPlaceLinkRow(serverRow), []);
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
// dependency): a still-queued or blocked place/trip create for the same
// linkedId would send the upload into a guaranteed 404.

async function countRetrying(
  db: Awaited<ReturnType<typeof getSyncDb>>,
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox WHERE state = 'retrying'",
  );
  return row?.n ?? 0;
}

async function flushMediaOps(): Promise<boolean> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<
    MediaOpRow & { op: string; error_json: string | null }
  >(
    `SELECT seq, entity_id, op, fields_json, media_phase, attempts, error_json
     FROM outbox
     WHERE entity = 'media' AND state = 'queued' ORDER BY seq ASC`,
  );
  let progressed = false;
  let mirrorTouched = false;
  let firstError: unknown = null;

  for (const row of rows) {
    if (row.op === "create" && (await isLinkPending(db, row))) continue;

    await db.runAsync(
      "UPDATE outbox SET state = 'inflight', attempts = attempts + 1 WHERE seq = ?",
      row.seq,
    );
    try {
      const outcome = await runMediaOp(row);
      if (outcome === "done") {
        progressed = true;
        mirrorTouched = true;
      }
      // 'blocked' already set its own state inside the op runner.
    } catch (err) {
      // Per-op, NOT per-pass. Aborting the loop here let one unreadable photo
      // head-of-line-block every other upload on the device permanently: the
      // next pass hit the same op first and threw again, and because the op
      // never parked it never appeared in Sync Issues either.
      firstError ??= err;
      // No answer at all (a timeout, a reset connection) is the link's
      // failure, not this op's: it goes back in the queue uncounted, however
      // often it happens. Guard: "never parks an upload over …" in
      // flush.test.ts.
      if (isNoResponse(err)) {
        await db.runAsync(
          "UPDATE outbox SET state = 'queued' WHERE seq = ? AND state = 'inflight'",
          row.seq,
        );
        // An unanswered API call is the link being down for every op behind
        // this one too, and each would spend its own timeout before the cycle
        // reached the delta pull. Only a transfer that died partway goes on:
        // that is about one file, and stopping for it would let a large video
        // block every photo queued after it. Guard: "stops the pass when the
        // API gives no answer" in flush.test.ts.
        if (!isTransferCut(err)) break;
        continue;
      }
      // Everything else is counted, because not every permanent failure
      // carries a status a runner could park on — a filesystem error has none
      // at all — and an op that fails forever must reach the user eventually.
      // A status the server may answer differently next time (a 503 mid-
      // deploy) additionally has to have lasted a day.
      const status = (err as { status?: unknown }).status;
      const transient =
        typeof status === "number" && isTransientSyncError(status);
      const now = new Date();
      const tally = tallySyncFailure(lastError(row), now);
      if (shouldGiveUpOnSyncOp(tally, transient, now)) {
        await db.runAsync(
          "UPDATE outbox SET state = 'blocked', error_json = ? WHERE seq = ?",
          JSON.stringify({
            code: transient ? status : 0,
            message:
              "This upload keeps failing on this phone. Retry or discard it.",
          }),
          row.seq,
        );
        mirrorTouched = true;
      } else {
        await db.runAsync(
          "UPDATE outbox SET state = 'queued', error_json = ? WHERE seq = ? AND state = 'inflight'",
          JSON.stringify({ code: transient ? status : 0, ...tally }),
          row.seq,
        );
      }
    }
  }

  if (mirrorTouched) notifyMirrorChanged();
  // The cycle still failed — the engine's backoff is what retries a genuinely
  // transient outage — but every op got its turn first, unless the link is
  // down.
  if (firstError) throw firstError;
  return progressed;
}

/**
 * Dispatch one media op. Media is not a push entity (§8.1) — creation is the
 * three-phase presign flow — but a standalone file can also be renamed and
 * re-parented, and those are plain REST calls on the same row.
 */
function runMediaOp(row: MediaOpRow & { op: string }): Promise<MediaOpOutcome> {
  switch (row.op) {
    case "delete":
      return runMediaDeleteOp(row);
    case "rename":
      return runMediaRenameOp(row);
    case "link":
      return runMediaLinkOp(row);
    default:
      return runMediaCreateOp(row);
  }
}

/** A media create must wait for its linked entity's create to fully flush:
 * an outbox row still targeting linkedId means the row may not exist
 * server-side yet. PARKED ops don't count — a parked link is never going to
 * flush on its own, and counting it left the photos of a blocked place
 * create sitting queued forever: never uploaded, never parked, and so never
 * shown in Sync Issues either. */
async function isLinkPending(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  row: MediaOpRow,
): Promise<boolean> {
  const fields = JSON.parse(row.fields_json ?? "{}") as { linkedId?: string };
  if (!fields.linkedId) return false;
  const pending = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM outbox
      WHERE entity_id = ? AND entity != 'media'
        AND state IN ('queued', 'inflight')`,
    fields.linkedId,
  );
  return (pending?.n ?? 0) > 0;
}
