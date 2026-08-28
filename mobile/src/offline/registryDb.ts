// Downloads registry (map-sources.md §4.2 + stage4a §5.1): one SQLite DB is
// the single source of truth for "what offline map data is on disk". The
// downloads manager writes it; the map resolver only reads it.
//
// PRIVACY: rows carry region bboxes — canyon-area coordinates. The DB lives
// in app-private storage (expo-sqlite's default dir, under the app sandbox,
// covered by allowBackup=false), is surfaced only behind the Stage 4 app
// lock, and its contents must never reach logs, telemetry, or crash reports.
import * as SQLite from "expo-sqlite";

import type { MapArtifact } from "../map/sourceResolver";
import { ADDED_COLUMNS, SCHEMA_SQL } from "./schema";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// Registry mutations notify listeners so map state (resolver ctx.artifacts)
// and the downloads UI refresh without polling.
type Listener = () => void;
const listeners = new Set<Listener>();
export function onRegistryChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notifyChanged(): void {
  for (const listener of listeners) listener();
}

// Exported for the account-transition wipe (offline/wipeLocalData.ts), which
// clears every table here in one transaction rather than through the per-row
// helpers that would each notify.
export { notifyChanged as notifyRegistryChanged };

// Shared with importsDb (vector_import lives in the same app-private store,
// behind the same app lock). Not for use outside the offline/imports modules.
export async function getOfflineDb(): Promise<SQLite.SQLiteDatabase> {
  return getDb();
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("logjam-offline.db");
      await db.execAsync(SCHEMA_SQL);
      await addMissingColumns(db);
      return db;
    })();
  }
  return dbPromise;
}



async function addMissingColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(${table})`,
    );
    if (columns.some((existing) => existing.name === column)) continue;
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

type ArtifactRow = {
  id: string;
  kind: string;
  logicalKey: string;
  format: string;
  sourceType: string;
  path: string;
  west: number | null;
  south: number | null;
  east: number | null;
  north: number | null;
  minzoom: number | null;
  maxzoom: number | null;
  sizeBytes: number;
  downloadedAt: string;
  label: string | null;
  groupId: string | null;
  groupLabel: string | null;
};

function rowToArtifact(row: ArtifactRow): MapArtifact {
  return {
    id: row.id,
    kind: row.kind as MapArtifact["kind"],
    logicalKey: row.logicalKey,
    format: row.format as MapArtifact["format"],
    sourceType: row.sourceType as MapArtifact["sourceType"],
    path: row.path,
    bbox:
      row.west != null && row.south != null && row.east != null && row.north != null
        ? [row.west, row.south, row.east, row.north]
        : null,
    minzoom: row.minzoom,
    maxzoom: row.maxzoom,
    sizeBytes: row.sizeBytes,
    downloadedAt: row.downloadedAt,
    label: row.label,
    groupId: row.groupId,
    groupLabel: row.groupLabel,
  };
}

export async function listArtifacts(): Promise<MapArtifact[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ArtifactRow>(
    "SELECT * FROM map_artifact ORDER BY downloadedAt DESC",
  );
  return rows.map(rowToArtifact);
}

export async function insertArtifact(artifact: MapArtifact): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO map_artifact
       (id, kind, logicalKey, format, sourceType, path,
        west, south, east, north, minzoom, maxzoom,
        sizeBytes, downloadedAt, label, groupId, groupLabel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    artifact.id,
    artifact.kind,
    artifact.logicalKey,
    artifact.format,
    artifact.sourceType,
    artifact.path,
    artifact.bbox?.[0] ?? null,
    artifact.bbox?.[1] ?? null,
    artifact.bbox?.[2] ?? null,
    artifact.bbox?.[3] ?? null,
    artifact.minzoom,
    artifact.maxzoom,
    artifact.sizeBytes,
    artifact.downloadedAt,
    artifact.label ?? null,
    artifact.groupId ?? null,
    artifact.groupLabel ?? null,
  );
  notifyChanged();
}

/**
 * Correct a row's size once the file it describes has settled.
 *
 * Exists for the tile-pyramid path: the registry row is written BEFORE the
 * MBTiles is finalized (deliberately — see runRegionDownload), and until the
 * journal flips out of WAL the tiles are in the `-wal` sidecar rather than the
 * file that gets stat'd. Every saved region reported ~4 KB.
 */
export async function setArtifactSize(id: string, sizeBytes: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE map_artifact SET sizeBytes = ? WHERE id = ?",
    sizeBytes,
    id,
  );
  notifyChanged();
}

/** Rename a downloaded region/overlay for display in Saved. */
export async function renameArtifact(id: string, label: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE map_artifact SET label = ? WHERE id = ?", label, id);
  notifyChanged();
}

/**
 * Rename every artifact from one download run (Saved shows them as one card,
 * so the rename has to reach all of them). Also the write behind the "name
 * this region" prompt, which runs WHILE the download is in flight — rows that
 * land afterwards carry the label through their own spec.
 */
export async function renameArtifactGroup(
  groupId: string,
  groupLabel: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE map_artifact SET groupLabel = ? WHERE groupId = ?",
    groupLabel,
    groupId,
  );
  notifyChanged();
}

// Persisted topo-overlay visibility set. Survives cold launch so a downloaded
// overlay renders offline without the online completed-overlays list (which has
// no persistence). Keys are "<jobId>/<layer>" — opaque id + generic layer name,
// same app-private, backup-excluded, app-lock-gated store; never logged.
export async function listEnabledOverlayKeys(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ overlayKey: string }>(
    "SELECT overlayKey FROM overlay_enabled",
  );
  return rows.map((row) => row.overlayKey);
}

export async function setOverlayEnabled(
  overlayKey: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDb();
  if (enabled) {
    await db.runAsync(
      "INSERT OR IGNORE INTO overlay_enabled (overlayKey) VALUES (?)",
      overlayKey,
    );
  } else {
    await db.runAsync(
      "DELETE FROM overlay_enabled WHERE overlayKey = ?",
      overlayKey,
    );
  }
}

export async function deleteArtifact(id: string): Promise<MapArtifact | null> {
  const db = await getDb();
  const rows = await db.getAllAsync<ArtifactRow>(
    "SELECT * FROM map_artifact WHERE id = ?",
    id,
  );
  if (rows.length === 0) return null;
  await db.runAsync("DELETE FROM map_artifact WHERE id = ?", id);
  notifyChanged();
  return rowToArtifact(rows[0]);
}
