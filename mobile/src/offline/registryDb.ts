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

// Shared with importsDb (vector_import lives in the same app-private store,
// behind the same app lock). Not for use outside the offline/imports modules.
export async function getOfflineDb(): Promise<SQLite.SQLiteDatabase> {
  return getDb();
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("logjam-offline.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS map_artifact (
          id           TEXT PRIMARY KEY,
          kind         TEXT NOT NULL,
          logicalKey   TEXT NOT NULL,
          format       TEXT NOT NULL,
          sourceType   TEXT NOT NULL,
          path         TEXT NOT NULL,
          west REAL, south REAL, east REAL, north REAL,
          minzoom INTEGER, maxzoom INTEGER,
          sizeBytes    INTEGER NOT NULL,
          downloadedAt TEXT NOT NULL,
          verifiedAt   TEXT,
          label        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_map_artifact_lookup
          ON map_artifact(kind, logicalKey);
        CREATE TABLE IF NOT EXISTS vector_import (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          color         TEXT NOT NULL,
          visible       INTEGER NOT NULL DEFAULT 1,
          path          TEXT NOT NULL,
          west REAL NOT NULL, south REAL NOT NULL,
          east REAL NOT NULL, north REAL NOT NULL,
          featureCount  INTEGER NOT NULL,
          positionCount INTEGER NOT NULL,
          sizeBytes     INTEGER NOT NULL,
          createdAt     TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS geo_pdf_import (
          id              TEXT PRIMARY KEY,
          label           TEXT NOT NULL,
          sha256          TEXT NOT NULL UNIQUE,
          pageIndex       INTEGER NOT NULL,
          viewportIndex   INTEGER NOT NULL,
          state           TEXT NOT NULL,
          errorCode       TEXT,
          west REAL, south REAL, east REAL, north REAL,
          minzoom INTEGER, maxzoom INTEGER,
          residualFraction REAL,
          opacity         REAL NOT NULL DEFAULT 0.8,
          visible         INTEGER NOT NULL DEFAULT 1,
          dirPath         TEXT NOT NULL,
          sourceSizeBytes INTEGER NOT NULL DEFAULT 0,
          quirks          TEXT,
          createdAt       TEXT NOT NULL,
          updatedAt       TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS track (
          id             TEXT PRIMARY KEY,
          name           TEXT NOT NULL,
          state          TEXT NOT NULL,
          color          TEXT NOT NULL,
          visible        INTEGER NOT NULL DEFAULT 1,
          currentSegment INTEGER NOT NULL DEFAULT 0,
          distanceM      REAL NOT NULL DEFAULT 0,
          durationMs     INTEGER NOT NULL DEFAULT 0,
          elevationGainM REAL NOT NULL DEFAULT 0,
          elevationLossM REAL NOT NULL DEFAULT 0,
          pointCount     INTEGER NOT NULL DEFAULT 0,
          startedAt      TEXT NOT NULL,
          endedAt        TEXT,
          updatedAt      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS track_point (
          trackId     TEXT NOT NULL,
          seq         INTEGER NOT NULL,
          segment     INTEGER NOT NULL,
          lon REAL NOT NULL, lat REAL NOT NULL,
          altitudeM REAL, accuracyM REAL,
          timestampMs INTEGER NOT NULL,
          PRIMARY KEY (trackId, seq)
        );
        CREATE TABLE IF NOT EXISTS waypoint (
          id        TEXT PRIMARY KEY,
          name      TEXT NOT NULL,
          lon REAL NOT NULL, lat REAL NOT NULL,
          createdAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS overlay_enabled (
          overlayKey TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS region_download (
          id            TEXT PRIMARY KEY,
          taskKind      TEXT NOT NULL,
          basemapId     TEXT NOT NULL,
          west REAL NOT NULL, south REAL NOT NULL,
          east REAL NOT NULL, north REAL NOT NULL,
          minzoom INTEGER NOT NULL, maxzoom INTEGER NOT NULL,
          state         TEXT NOT NULL,
          pausedReason  TEXT,
          tilesPlanned  INTEGER, tilesDone INTEGER, tilesGap INTEGER,
          bytesDone     INTEGER,
          allowCellular INTEGER NOT NULL DEFAULT 0,
          errorCode     TEXT,
          filePath      TEXT NOT NULL,
          createdAt     TEXT NOT NULL,
          updatedAt     TEXT NOT NULL
        );
      `);
      await addMissingColumns(db);
      return db;
    })();
  }
  return dbPromise;
}

// Columns added to a table that already exists on installed devices. The
// CREATE TABLE statements above only run on a fresh DB, so each addition needs
// an idempotent ALTER here, guarded by an actual column check rather than a
// swallowed error (a genuinely broken ALTER must still throw).
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  // User-facing rename of a downloaded region/overlay (Saved tab). Display
  // only — resolution still keys off `logicalKey`.
  { table: "map_artifact", column: "label", definition: "TEXT" },
];

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
        sizeBytes, downloadedAt, verifiedAt, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    new Date().toISOString(),
    artifact.label ?? null,
  );
  notifyChanged();
}

/** Rename a downloaded region/overlay for display in Saved. */
export async function renameArtifact(id: string, label: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE map_artifact SET label = ? WHERE id = ?", label, id);
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
