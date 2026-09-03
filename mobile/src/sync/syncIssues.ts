// Parked-ops + conflict-shelf surface (stage8-sync.md §8.4/§8.5). The
// fail-loudly rule applied to sync: ops the server rejected (blocked) or that
// lost an edit↔delete race (deadRemote), plus shelved conflict values, are
// never silently dropped — they surface here with explicit user actions.
//
// PRIVACY: parked ops and shelf entries carry canyon field values (names,
// coords). Rendered only behind the app lock; never logged.
import * as FileSystem from "expo-file-system/legacy";

import {
  collectDirtyFields,
  type SyncPushEntity,
  type SyncPushOp,
} from "@logjam/shared";

import { getMirrorCanyon } from "./mirrorStore";
import {
  canKeepBothField,
  canRestoreField,
  createCanyonLocal,
  createWaypointLocal,
  revertDiscardedUpdate,
  updateEntityFieldLocal,
  type WaypointDraft,
} from "./outbox";
import { loadOutboxEntries } from "./deltaPull";
import { isOutboxEntity, outboxMirrorTable, type OutboxEntity } from "./outboxTables";
import {
  getSyncDb,
  getSyncStateValue,
  notifyMirrorChanged,
  wipeMirror,
  withSyncTransaction,
} from "./syncDb";
import { APPLY_FAILED_KEY, requestSync } from "./syncEngine";

export type ParkedOp = {
  seq: number;
  /** The OUTBOX's entity set, which includes `media` — see outboxTables.ts. */
  entity: OutboxEntity;
  op: SyncPushOp["op"];
  entityId: string;
  /** 'blocked' = server rejected (validation/quota); 'deadRemote' = the row
   * was deleted server-side under a pending edit (§6 delete-wins). */
  state: "blocked" | "deadRemote";
  fields: Record<string, unknown> | null;
  error: { code: number; message: string } | null;
  attempts: number;
  createdAt: string;
  /**
   * The name of the row this op is about, from the op's own fields or the
   * mirror — null when the entity has no name or has been deleted since.
   *
   * An UPDATE carries only the fields it DIRTIED, so an edit to notes or a
   * grade holds no name at all and every such row read "Couldn't save your
   * changes to a canyon". Which of the user's things it is happens to be the
   * first question the list has to answer, and the op alone cannot answer it.
   */
  entityName: string | null;
  /**
   * Whether the row this op edits still exists in the local mirror.
   *
   * The deciding fact for "Recreate": a canyon deleted on another device can be
   * rebuilt from the phone's own copy plus the pending edit, but only while
   * that copy is still here — the next delta pull applies the tombstone and
   * takes it. Resolved on the LIST so the verb is absent rather than failing
   * at the tap (§7).
   */
  hasLocalRow: boolean;
};

export type ShelfEntry = {
  id: number;
  entity: string;
  entityId: string;
  field: string;
  /** What the user wrote, and lost. */
  shelvedValue: unknown;
  /** What the account holds instead — null when the other device CLEARED it. */
  serverValue: unknown;
  at: string;
  /** Why "Restore" is unavailable, or null when it can be. */
  restoreBlock: RestoreBlock | null;
  /** True when the two values can be joined instead of one beating the other. */
  canKeepBoth: boolean;
  /** The row's own name, captured when the value was shelved (`entity_name`),
   *  so it survives the row being deleted afterwards. */
  entityName: string | null;
};

/**
 * Why a shelved value cannot be put back, or null when it can.
 *
 * Checked BEFORE the verb is offered, because every one of these ends the same
 * way if it isn't: the write parks as a fresh `blocked` op, and a row the user
 * tapped in Lost reappears in Stuck. A recovery action that manufactures a new
 * sync issue is worse than no recovery action.
 */
export type RestoreBlock = "gone" | "unsupported";

type ParkedRow = {
  seq: number;
  entity: string;
  op: string;
  entity_id: string;
  state: string;
  fields_json: string | null;
  /** Pre-edit values, for reverting the mirror when an update is discarded. */
  base_fields_json: string | null;
  error_json: string | null;
  attempts: number;
  created_at: string;
};

export async function listParkedOps(): Promise<ParkedOp[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<ParkedRow>(
    `SELECT seq, entity, op, entity_id, state, fields_json, error_json,
            attempts, created_at
     FROM outbox WHERE state IN ('blocked', 'deadRemote') ORDER BY seq ASC`,
  );
  const ops: ParkedOp[] = [];
  for (const row of rows) {
    const entity = row.entity as OutboxEntity;
    const fields = row.fields_json
      ? (JSON.parse(row.fields_json) as Record<string, unknown>)
      : null;
    const named = fields?.name ?? fields?.filename;
    ops.push({
      seq: row.seq,
      entity,
      op: row.op as SyncPushOp["op"],
      entityId: row.entity_id,
      state: row.state as "blocked" | "deadRemote",
      fields,
      error: row.error_json
        ? (JSON.parse(row.error_json) as { code: number; message: string })
        : null,
      attempts: row.attempts,
      createdAt: row.created_at,
      entityName:
        typeof named === "string" && named.length > 0
          ? named
          : await mirrorRowName(db, entity, row.entity_id),
      hasLocalRow: await mirrorRowExists(db, entity, row.entity_id),
    });
  }
  return ops;
}

/**
 * A mirror row's display name, for saying WHICH thing an op is about.
 *
 * `SELECT *` because the column differs per table — a trip's is `display_name`
 * — and a table with neither simply yields nothing, which is also the honest
 * answer for a row that has been deleted since.
 */
async function mirrorRowName(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  entity: OutboxEntity,
  entityId: string,
): Promise<string | null> {
  const table = outboxMirrorTable(entity);
  if (!table) return null;
  const row = await db.getFirstAsync<{
    name?: string | null;
    display_name?: string | null;
  }>(`SELECT * FROM ${table} WHERE id = ?`, entityId);
  return row?.name ?? row?.display_name ?? null;
}

/** Whether the mirror still holds the row an op is about. */
async function mirrorRowExists(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  entity: OutboxEntity,
  entityId: string,
): Promise<boolean> {
  const table = outboxMirrorTable(entity);
  if (!table) return false;
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = ?`,
    entityId,
  );
  return row != null;
}

export async function listShelfEntries(): Promise<ShelfEntry[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<{
    id: number;
    entity: string;
    entity_id: string;
    field: string;
    shelved_json: string | null;
    server_json: string | null;
    at: string;
    entity_name: string | null;
  }>("SELECT * FROM conflict_shelf ORDER BY at DESC");
  const entries: ShelfEntry[] = [];
  for (const row of rows) {
    const entity = row.entity;
    const field = row.field;
    // Resolved on the LIST, not at the tap: a verb that cannot act has to be
    // ABSENT (§7), and the bulk bar's "N restore" tally has to be true before
    // anyone presses anything. Shelf tables are tens of rows, not thousands.
    const target = await shelfTarget(entity, row.entity_id, field);
    const shelvedValue = row.shelved_json ? JSON.parse(row.shelved_json) : null;
    const serverValue = row.server_json ? JSON.parse(row.server_json) : null;
    entries.push({
      id: row.id,
      entity,
      entityId: row.entity_id,
      field,
      shelvedValue,
      serverValue,
      at: row.at,
      restoreBlock: target.block,
      canKeepBoth:
        target.block === null && canKeepBothField(entity, field) && isMergeablePair(shelvedValue, serverValue),
      // The stored name first: it was captured while the row still existed, and
      // the mirror lookup is only the fallback for entries shelved before the
      // column did (`ensureLocalColumns` backfills nothing).
      entityName:
        row.entity_name ??
        (isOutboxEntity(entity)
          ? await mirrorRowName(db, entity, row.entity_id)
          : null),
    });
  }
  return entries;
}

/** Two values worth joining: both real text, and not already the same text. */
function isMergeablePair(shelved: unknown, server: unknown): boolean {
  return (
    typeof shelved === "string" &&
    typeof server === "string" &&
    shelved.trim().length > 0 &&
    server.trim().length > 0 &&
    shelved.trim() !== server.trim()
  );
}

/**
 * Whether one shelved value can be written back, and why not when it cannot.
 *
 * `unsupported` covers a field no local update op can carry (a trip's canyon
 * links, whose column is built from resolved link names); `gone`, a row deleted
 * since — there is nothing left to restore it into.
 *
 * There is deliberately no `readOnly`: a shelf entry only exists because a push
 * was APPLIED (flush.ts), and `sync.ts` 404s an update to a canyon you do not
 * own. So a conflict receipt can only ever be about a row of the user's own,
 * and a block for "someone shared this with you" was unreachable code that only
 * hand-seeded rows could produce.
 */
async function shelfTarget(
  entity: string,
  entityId: string,
  field: string,
): Promise<{ block: RestoreBlock | null }> {
  if (!canRestoreField(entity, field)) return { block: "unsupported" };
  const table = isOutboxEntity(entity) ? outboxMirrorTable(entity) : null;
  if (!table) return { block: "unsupported" };
  const db = await getSyncDb();
  const row = await db.getFirstAsync<{ id?: string }>(
    `SELECT id FROM ${table} WHERE id = ?`,
    entityId,
  );
  return { block: row ? null : "gone" };
}

/**
 * Put a shelved value back: write it locally, queue the update, and DELETE the
 * shelf row — the issue has been dealt with, and a row that stayed behind in a
 * "restored" state asked the user to decide the same thing twice.
 *
 * This is a clobber, not a merge: the value it displaces is the other device's,
 * and after this write nothing records what that was. The confirm dialog is
 * where that is said, and it quotes the value being replaced, because this
 * function is the point of no return for it. `keepBothShelfValue` is the way
 * out that costs nothing.
 *
 * The write wins on arrival because it is a NEW edit with a current timestamp,
 * not a replay of the one that lost. It loses only to an edit made after it,
 * which is ordinary LWW and correct.
 */
export async function restoreShelfValue(id: number): Promise<void> {
  await writeShelfValue(id, (entry) => entry.shelvedValue);
}

/**
 * Keep both: write `{kept}\n\n{recovered}` and delete the shelf row.
 *
 * The kept value goes FIRST because the sentence describing it has to be
 * unambiguous — "your text is added below what's there now" — and chronology
 * cannot supply an order here: an offline edit can be typed after the value
 * that beat it to the server.
 */
export async function keepBothShelfValue(id: number): Promise<void> {
  await writeShelfValue(id, (entry) => {
    if (!entry.canKeepBoth) {
      throw new Error(`Cannot keep both for shelf entry ${id}`);
    }
    return `${String(entry.serverValue).trim()}\n\n${String(entry.shelvedValue).trim()}`;
  });
}

async function writeShelfValue(
  id: number,
  pick: (entry: ShelfEntry) => unknown,
): Promise<void> {
  const entry = (await listShelfEntries()).find((candidate) => candidate.id === id);
  if (!entry) return;
  if (entry.restoreBlock) {
    throw new Error(`Cannot write shelf entry ${id}: ${entry.restoreBlock}`);
  }
  await updateEntityFieldLocal(entry.entity, entry.entityId, entry.field, pick(entry));
  const db = await getSyncDb();
  await db.runAsync("DELETE FROM conflict_shelf WHERE id = ?", id);
  notifyMirrorChanged();
}

/**
 * Badge count for the More hub's row: parked ops + an unapplicable delta page.
 *
 * The second is why this isn't one COUNT: a page this app version can't apply
 * stops the mirror dead, and the only thing that used to say so was a line
 * claiming the account was unreachable and that it would keep retrying. A
 * permanent failure belongs on the screen for permanent failures.
 *
 * Conflict receipts ARE counted, and that reverses what this comment used to
 * say. The old argument was that a shelved value "needs nothing" because it
 * already lost — but what it is, is a change the user made and the account does
 * not have, which is the same sentence as a parked op and the same thing the
 * badge exists to say. It is also the only warning they will ever get: the
 * value was dropped in favour of another device's, silently, and if nobody
 * looks it stays dropped. That is exactly the fail-loudly case.
 */
export async function countSyncIssues(): Promise<number> {
  const db = await getSyncDb();
  const parked = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox WHERE state IN ('blocked', 'deadRemote')",
  );
  const shelf = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM conflict_shelf",
  );
  const applyFailed = await getApplyFailureAt();
  return (parked?.n ?? 0) + (shelf?.n ?? 0) + (applyFailed ? 1 : 0);
}

/** When the last delta page failed to apply locally, or null. */
export async function getApplyFailureAt(): Promise<string | null> {
  return getSyncStateValue(APPLY_FAILED_KEY);
}

/**
 * The recovery for an unapplicable page: throw the mirror away and pull it
 * again from cursor zero. The mirror is a cache of the server, so this costs
 * bandwidth and nothing else — the outbox, which holds work the server has
 * never seen, is deliberately untouched.
 */
export async function resyncFromScratch(): Promise<void> {
  await wipeMirror();
  await requestSync();
}

/** Retry a parked op: requeue it and kick a sync. A blocker that was fixed
 * server-side (quota freed) now succeeds; a still-invalid op re-parks. */
export async function retryParkedOp(seq: number): Promise<void> {
  const db = await getSyncDb();
  await db.runAsync(
    "UPDATE outbox SET state = 'queued', error_json = NULL WHERE seq = ?",
    seq,
  );
  void requestSync();
}

/**
 * Discard a parked op: its field data is moved to the conflict shelf (never
 * silently lost — §8.4) and the op is deleted. The optimistic mirror row it
 * created (a never-synced create) is also removed.
 */
export async function discardParkedOp(seq: number): Promise<void> {
  const db = await getSyncDb();
  // Cache files whose owning row this discard removes; unlinked after the commit.
  const orphanedFiles: string[] = [];
  await withSyncTransaction(db, async () => {
    const row = await db.getFirstAsync<ParkedRow>(
      "SELECT * FROM outbox WHERE seq = ?",
      seq,
    );
    if (!row) return;
    const entity = row.entity as OutboxEntity;
    // Discarding does NOT shelve what the user typed, and that is deliberate
    // (changed 2026-09-02). It used to, and the row it left behind asked the
    // user to decide the same thing a second time — they had already read the
    // change, read what it would cost, and pressed a destructive confirm. The
    // confirm is where the cost is stated; see `discardExplanation`.
    // A create that never synced leaves an orphan optimistic mirror row — the
    // pendingUpload tile in a media strip, the ghost canyon in a list. Guard on
    // null: an entity with no id-keyed mirror row must SKIP this, not build
    // `DELETE FROM null` and roll the whole transaction back (which is how
    // "Discard" came to do nothing at all for a media op).
    if (row.op === "create") {
      const table = outboxMirrorTable(entity);
      if (table) {
        // Read the media row's cache paths BEFORE deleting it — dropping the row
        // is what makes the files unreachable, so this is the only chance to
        // learn where they are. (Same shape as the blocked-media path in
        // mediaUpload.ts.)
        if (entity === "media") {
          const media = await db.getFirstAsync<{
            local_display_path: string | null;
            local_thumb_path: string | null;
          }>(
            "SELECT local_display_path, local_thumb_path FROM media WHERE id = ?",
            row.entity_id,
          );
          if (media?.local_display_path) orphanedFiles.push(media.local_display_path);
          if (media?.local_thumb_path) orphanedFiles.push(media.local_thumb_path);
        }
        await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, row.entity_id);
      }
    }

    if (row.op === "update") {
      // Undo the optimistic write this op made. Fields a LATER pending op
      // owns are left alone — that op's value is what the column holds now.
      const base = row.base_fields_json
        ? (JSON.parse(row.base_fields_json) as Record<string, unknown>)
        : {};
      const others = (await loadOutboxEntries()).filter(
        (candidate) => candidate.seq !== seq,
      );
      const remainingDirty = new Set(
        Object.keys(
          collectDirtyFields(others, entity as SyncPushEntity, row.entity_id),
        ),
      );
      await revertDiscardedUpdate(
        db,
        entity as SyncPushEntity,
        row.entity_id,
        base,
        remainingDirty,
      );
    }

    if (row.op === "create") {
      // Discarding a create discards its lineage. The row will never exist
      // server-side, so a queued update or delete still pointing at it is no
      // longer merely deferred (nothing is `blocked` any more) — it flushes,
      // 404s, and parks as a FRESH sync issue. One discard became a cascade.
      await db.runAsync(
        "DELETE FROM outbox WHERE entity_id = ? AND seq != ?",
        row.entity_id,
        seq,
      );
    }
    await db.runAsync("DELETE FROM outbox WHERE seq = ?", seq);
  });
  // File IO is not transactional, so it happens after the commit: a failed
  // unlink must not resurrect the op the user just discarded.
  for (const path of orphanedFiles) {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
  notifyMirrorChanged();
}

/**
 * Send the rest of a rejected edit, without the field the server objected to.
 *
 * An outbox op carries every field one edit dirtied, and the API validates the
 * whole payload — so one bad number takes a paragraph of notes down with it,
 * and the screen then showed a rejection about a grade above a change the user
 * had mostly got right. The good fields are re-queued as an ordinary edit; the
 * dropped ones are gone, which the confirm says, because the user is reading
 * them in the sheet as they decide.
 *
 * Not a shelve: a value the SERVER refuses is not a value we can offer to put
 * back later (see `shelfTarget`), so keeping a receipt for it would be a row
 * whose only verb manufactures this same rejection again.
 */
export async function retryWithoutFields(seq: number, drop: string[]): Promise<void> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<ParkedRow>(
    "SELECT * FROM outbox WHERE seq = ?",
    seq,
  );
  if (!row?.fields_json) return;
  const fields = JSON.parse(row.fields_json) as Record<string, unknown>;
  for (const field of drop) delete fields[field];
  // Nothing left to send: this is a discard, and going through that path takes
  // the optimistic mirror row and the op lineage with it.
  if (Object.keys(fields).length === 0) {
    await discardParkedOp(seq);
    return;
  }
  await db.runAsync(
    "UPDATE outbox SET fields_json = ?, state = 'queued', error_json = NULL WHERE seq = ?",
    JSON.stringify(fields),
    seq,
  );
  notifyMirrorChanged();
  void requestSync();
}

/**
 * Recreate from a deadRemote op (§6): the server deleted the row, but the
 * user's edits are still here — one tap re-creates the entity with a FRESH id
 * and then discards the dead op.
 *
 * TWO SOURCES, and the second is why canyons work at all. A waypoint's op
 * carries its whole payload, so the op alone rebuilds it. A canyon UPDATE
 * carries only what it dirtied — never coordinates, and a canyon without those
 * is not a canyon — so the rebuild reads the phone's own mirror row and lays
 * the pending edit over it. That copy is only here until the next delta pull
 * applies the tombstone, which is exactly what `hasLocalRow` reports and what
 * the screen gates the verb on.
 */
export async function recreateFromDeadRemote(seq: number): Promise<string | null> {
  const parked = await listParkedOps();
  const op = parked.find((entry) => entry.seq === seq);
  const fields = op?.fields ?? {};
  if (!op) return null;

  if (op.entity === "waypoint") {
    // `Number(undefined)` used to put NaN in a NOT NULL REAL column: the insert
    // threw, the op stayed parked, and Recreate was permanently broken for it
    // until Discard. A rename-only edit has no position, so it falls through.
    if (typeof fields.latitude === "number" && typeof fields.longitude === "number") {
      const draft: WaypointDraft = {
        name: typeof fields.name === "string" ? fields.name : "Recovered waypoint",
        latitude: fields.latitude,
        longitude: fields.longitude,
        elevation: typeof fields.elevation === "number" ? fields.elevation : null,
        symbol: typeof fields.symbol === "string" ? fields.symbol : null,
        notes: typeof fields.notes === "string" ? fields.notes : null,
        tags: Array.isArray(fields.tags)
          ? fields.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        // Links are deliberately NOT carried over: the parked op names canyons
        // that may since have been deleted or unshared, and a recreate that
        // silently re-published a coordinate would be the worst possible time
        // to guess. The user re-links from the sheet, seeing what they link to.
        canyonIds: [],
      };
      const newId = await createWaypointLocal(draft);
      await dropOp(seq);
      return newId;
    }
  }

  if (op.entity === "canyon") {
    const existing = await getMirrorCanyon(op.entityId);
    if (existing) {
      const merged = { ...existing, ...fields } as Record<string, unknown>;
      const pick = <T,>(key: string): T | null => (merged[key] ?? null) as T | null;
      const newId = await createCanyonLocal({
        name: typeof merged.name === "string" ? merged.name : "Recovered canyon",
        latitude: Number(merged.latitude),
        longitude: Number(merged.longitude),
        altNames: Array.isArray(merged.altNames)
          ? merged.altNames.filter((alt): alt is string => typeof alt === "string")
          : [],
        numAbseils: pick<number>("numAbseils"),
        longestAbseil: pick<number>("longestAbseil"),
        vGrade: pick<number>("vGrade"),
        aGrade: pick<number>("aGrade"),
        commitment: pick<number>("commitment"),
        quality: pick<number>("quality"),
        hours: pick<number>("hours"),
        notes: pick<string>("notes"),
        attributes:
          merged.attributes && typeof merged.attributes === "object"
            ? (merged.attributes as Record<string, unknown>)
            : {},
      });
      await dropOp(seq);
      return newId;
    }
  }

  // Nothing to rebuild from. The screen does not offer Recreate in this case
  // (`hasLocalRow`), so reaching here means the row went between the list and
  // the tap — discard rather than pretend.
  await discardParkedOp(seq);
  return null;
}

/** Remove a parked op once its work has been carried somewhere else. */
async function dropOp(seq: number): Promise<void> {
  const db = await getSyncDb();
  await db.runAsync("DELETE FROM outbox WHERE seq = ?", seq);
  notifyMirrorChanged();
}

/**
 * Throw a lost value away. The only copy — nothing expires it any more (the
 * 30-day purge went with the tabs: a countdown to silent deletion is what this
 * screen exists to prevent), so the table shrinks only when the user says so.
 */
export async function dismissShelfEntry(id: number): Promise<void> {
  const db = await getSyncDb();
  await db.runAsync("DELETE FROM conflict_shelf WHERE id = ?", id);
}


