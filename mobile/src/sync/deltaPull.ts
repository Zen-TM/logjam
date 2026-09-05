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
  parseSyncDeltaCanyonRow,
  parseSyncDeltaCustomFieldDefRow,
  parseSyncDeltaFriendshipRow,
  parseSyncDeltaMediaRow,
  parseSyncDeltaRouteRow,
  parseSyncDeltaShareRow,
  parseSyncDeltaTombstone,
  parseSyncDeltaTripRow,
  parseSyncDeltaWaypointRow,
  DELTA_ENTITY_ORDER,
  SYNC_PROTOCOL,
  SyncRowError,
  type OutboxEntry,
  type DeltaEntityKey,
  type SyncDeltaResponse,
  type SyncPushOp,
} from "@logjam/shared";
import * as FileSystem from "expo-file-system/legacy";

import { apiFetch } from "../api/apiFetch";
import { loadOutboxRows, rowToEntry } from "./outbox";
import {
  applyTombstone,
  notifyMirrorChanged,
  upsertCanyon,
  upsertCustomFieldDef,
  upsertFriendship,
  upsertMedia,
  upsertShare,
  rebasePendingCanyonLinks,
  upsertTrip,
  upsertWaypoint,
  upsertRoute,
} from "./mirrorStore";
import {
  APPLY_FAILED_KEY,
  getSyncDb,
  getSyncStateValue,
  setSyncStateValue,
  wipeMirror,
  withSyncTransaction,
} from "./syncDb";

/** Every pending op, in the shape the shared rebase helpers take. One mapper
 * for the whole app (`rowToEntry`): the near-duplicate that used to live here
 * synthesised `opId` from the seq instead of reading `op_id`. */
export async function loadOutboxEntries(): Promise<OutboxEntry[]> {
  return (await loadOutboxRows()).map(rowToEntry);
}

/**
 * Validate every row the server sends before it reaches the mirror — and SKIP
 * the ones that fail rather than throwing.
 *
 * The push path (`flush.ts`) can afford to throw: it has already deleted the
 * outbox row, so the local value stands and the next pull corrects it. The pull
 * path cannot. A throw here aborts `applyPage`, which rolls back the cursor
 * write with it, so every later pull re-fetches the same bad page forever —
 * byte for byte the MSYNC-001 failure that started the audit, just triggered by
 * the server instead of by our own schema.
 *
 * So a bad row is dropped, named (fields only — never values; these rows carry
 * canyon names and coordinates), and the rest of the page applies. The cursor
 * advances past it, which means a dropped row is not retried: that is the
 * deliberate trade. A row the client cannot read is a server-side defect, and
 * one unreadable canyon is a far better outcome than a device that never syncs
 * again.
 */
function parsedRows<Row>(
  rows: unknown[],
  parse: (value: unknown) => Row,
  skipped: string[],
): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    try {
      out.push(parse(row));
    } catch (err) {
      if (!(err instanceof SyncRowError)) throw err;
      skipped.push(err.message);
    }
  }
  return out;
}

/**
 * The server answered, and applying what it sent to the local mirror threw.
 *
 * A distinct failure MODE, not a distinct failure: retrying re-fetches the
 * same page and fails the same way, forever, while the health line blames the
 * network and promises a retry that cannot work. That is exactly what a
 * cascade writing a dropped column did — 200 from the server, rollback on the
 * phone, cursor frozen, "Can't reach your account" on screen.
 */
export class SyncApplyError extends Error {
  constructor(cause: unknown) {
    super("The app could not apply the update the server sent");
    this.name = "SyncApplyError";
    this.cause = cause;
  }
}

/** One delta page as one transaction, with local-apply failures marked as
 * such. The cursor write is inside it, so nothing here half-applies. */
async function applyPage(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  task: () => Promise<void>,
): Promise<void> {
  try {
    await withSyncTransaction(db, task);
  } catch (err) {
    throw new SyncApplyError(err);
  }
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
    const skipped: string[] = [];
    const raw = response.changes as unknown as Record<string, unknown[]>;
    const changes = {
      customFieldDefs: parsedRows(
        raw.customFieldDefs ?? [],
        parseSyncDeltaCustomFieldDefRow,
        skipped,
      ),
      canyons: parsedRows(raw.canyons ?? [], parseSyncDeltaCanyonRow, skipped),
      tripLogs: parsedRows(raw.tripLogs ?? [], parseSyncDeltaTripRow, skipped),
      waypoints: parsedRows(
        raw.waypoints ?? [],
        parseSyncDeltaWaypointRow,
        skipped,
      ),
      routes: parsedRows(raw.routes ?? [], parseSyncDeltaRouteRow, skipped),
      media: parsedRows(raw.media ?? [], parseSyncDeltaMediaRow, skipped),
      canyonShares: parsedRows(
        raw.canyonShares ?? [],
        parseSyncDeltaShareRow,
        skipped,
      ),
      friendships: parsedRows(
        raw.friendships ?? [],
        parseSyncDeltaFriendshipRow,
        skipped,
      ),
      // `satisfies` is the derivation: DELTA_ENTITY_ORDER is the declared set
      // of change keys, and this object must cover it exactly. An eighth
      // protocol entity now fails to compile here instead of being fetched,
      // never read, and acknowledged by the advancing cursor — permanently
      // absent from every phone with nothing to show for it.
    } satisfies Record<DeltaEntityKey, unknown[]>;

    // The other direction: a SERVER newer than this app version sends a key
    // this build has never heard of. Count its rows as skipped so the user
    // gets a sync issue (and a reason to update) rather than silence.
    for (const [key, rows] of Object.entries(raw)) {
      if ((DELTA_ENTITY_ORDER as readonly string[]).includes(key)) continue;
      if (Array.isArray(rows) && rows.length > 0) {
        skipped.push(`${key}: ${rows.length} row(s) this app version cannot apply`);
      }
    }
    const tombstones = parsedRows(
      (response.tombstones ?? []) as unknown[],
      parseSyncDeltaTombstone,
      skipped,
    );
    const db = await getSyncDb();
    await applyPage(db, async () => {
      // Definitions first, matching the server's budget order: the canyon and
      // trip rows below carry values keyed by them, so a page never leaves a
      // value on screen with no label to render it under.
      for (const row of changes.customFieldDefs) {
        const { effective, dirtyNames } = rebase(row, "customFieldDef", outbox);
        await upsertCustomFieldDef(db, effective, dirtyNames);
      }
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
        changes.customFieldDefs.length +
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

    if (skipped.length > 0) {
      // Field-name detail only — these rows carry canyon names and coordinates.
      console.error(
        `sync: dropped ${skipped.length} unreadable row(s) from a delta page`,
        skipped,
      );
      // Counted as a sync issue so the user sees a number rather than nothing.
      // It reuses the apply-failure marker deliberately: "this phone couldn't
      // apply an update" is exactly what happened, just to part of a page
      // instead of all of it. A resync re-fetches and re-drops the same row,
      // which is honest — a row this client cannot read is a server defect,
      // not something the user can clear.
      await setSyncStateValue(APPLY_FAILED_KEY, new Date().toISOString()).catch(
        () => {},
      );
    }

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
