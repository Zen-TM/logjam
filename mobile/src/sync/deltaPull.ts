// Delta pull loop (stage8-sync.md §4): page through GET /sync/delta from the
// persisted cursor, apply each page as one SQLite transaction (upserts +
// tombstone cascade + cursor advance — atomic, so a crash mid-page replays
// the whole page idempotently), loop until hasMore clears. resetRequired
// wipes the MIRROR (never the outbox) and restarts from the empty cursor.
//
// PRIVACY: nothing here logs row contents — errors surface to the sync
// engine as thrown exceptions and the Sentry scrubber owns redaction.
import {
  collectDirtyFields,
  SYNC_PROTOCOL,
  type OutboxEntry,
  type SyncDeltaResponse,
  type SyncPushOp,
} from "@logjam/shared";
import * as FileSystem from "expo-file-system";

import { apiFetch } from "../api/apiFetch";
import {
  applyTombstone,
  notifyMirrorChanged,
  upsertCanyon,
  upsertFriendship,
  upsertMedia,
  upsertShare,
  rebasePendingCanyonLinks,
  upsertTrip,
  upsertWaypoint,
  upsertRoute,
} from "./mirrorStore";
import {
  getSyncDb,
  getSyncStateValue,
  setSyncStateValue,
  wipeMirror,
} from "./syncDb";

type OutboxRow = {
  seq: number;
  entity: string;
  op: string;
  entity_id: string;
  fields_json: string | null;
  state: string;
  attempts: number;
};

export async function loadOutboxEntries(): Promise<OutboxEntry[]> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<OutboxRow>(
    `SELECT seq, entity, op, entity_id, fields_json, state, attempts
       FROM outbox ORDER BY seq ASC`,
  );
  return rows.map((row) => ({
    seq: row.seq,
    state: row.state as OutboxEntry["state"],
    attempts: row.attempts,
    op: {
      opId: String(row.seq),
      entity: row.entity,
      op: row.op,
      id: row.entity_id,
      ...(row.fields_json != null && {
        fields: JSON.parse(row.fields_json) as Record<string, unknown>,
      }),
    } as SyncPushOp,
  }));
}

/** Rebase-on-pull (§8.5): server row + pending dirty fields replayed over
 * it. Returns the effective row and which fields stayed locally dirty. */
function rebase<Row extends { id: string }>(
  row: Row,
  entity: SyncPushOp["entity"],
  outbox: OutboxEntry[],
): { effective: Row; dirtyNames: string[] } {
  const dirty = collectDirtyFields(outbox, entity, row.id);
  const dirtyNames = Object.keys(dirty);
  if (dirtyNames.length === 0) return { effective: row, dirtyNames };
  return { effective: { ...row, ...dirty }, dirtyNames };
}

export type DeltaPullResult = {
  pages: number;
  changedRows: number;
  reset: boolean;
};

/**
 * Run one full pull to drain (all pages). Concurrency is the caller's
 * problem — the sync engine serializes cycles.
 */
export async function runDeltaPull(currentUserId: string): Promise<DeltaPullResult> {
  let pages = 0;
  let changedRows = 0;
  let didReset = false;

  for (;;) {
    const cursor = (await getSyncStateValue("cursor")) ?? "";
    const response = await apiFetch<SyncDeltaResponse>(
      `/sync/delta?cursor=${encodeURIComponent(cursor)}`,
    );

    if (response.protocol !== SYNC_PROTOCOL) {
      throw new Error(`Unsupported sync protocol ${response.protocol}`);
    }

    if (response.resetRequired) {
      // One reset per pull: a second one means the server keeps refusing our
      // cursor — surface it rather than loop.
      if (didReset) throw new Error("Sync reset loop: server rejected the fresh cursor");
      didReset = true;
      await wipeMirror();
      continue;
    }

    const outbox = await loadOutboxEntries();
    const orphanedPaths: string[] = [];
    const db = await getSyncDb();
    await db.withTransactionAsync(async () => {
      const { changes, tombstones } = response;
      for (const row of changes.canyons) {
        const { effective, dirtyNames } = rebase(row, "canyon", outbox);
        await upsertCanyon(db, effective, dirtyNames);
      }
      for (const row of changes.tripLogs) {
        const rebased = rebase(row, "tripLog", outbox);
        const { effective, dirtyNames } = await rebasePendingCanyonLinks(
          db,
          rebased.effective,
          rebased.dirtyNames,
        );
        await upsertTrip(db, effective, dirtyNames);
      }
      for (const row of changes.waypoints) {
        const { effective, dirtyNames } = rebase(row, "waypoint", outbox);
        await upsertWaypoint(db, effective, dirtyNames);
      }
      for (const row of changes.routes) {
        const { effective, dirtyNames } = rebase(row, "route", outbox);
        await upsertRoute(db, effective, dirtyNames);
      }
      for (const row of changes.media) await upsertMedia(db, row);
      for (const row of changes.canyonShares) {
        await upsertShare(db, row, currentUserId);
      }
      for (const row of changes.friendships) await upsertFriendship(db, row);
      for (const tombstone of tombstones) {
        orphanedPaths.push(...(await applyTombstone(db, tombstone)));
      }

      changedRows +=
        changes.canyons.length +
        changes.tripLogs.length +
        changes.waypoints.length +
        changes.routes.length +
        changes.media.length +
        changes.canyonShares.length +
        changes.friendships.length +
        tombstones.length;

      // Cursor advances atomically with the page it acknowledges.
      await db.runAsync(
        "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('cursor', ?)",
        response.cursor,
      );
    });

    // Cached blobs of tombstoned media: best-effort cleanup outside the tx.
    for (const path of orphanedPaths) {
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    }

    pages += 1;
    if (!response.hasMore) break;
  }

  await setSyncStateValue("lastSyncAt", new Date().toISOString());
  if (changedRows > 0 || didReset) notifyMirrorChanged();
  return { pages, changedRows, reset: didReset };
}
