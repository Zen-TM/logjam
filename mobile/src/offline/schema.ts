// The offline DB's schema, as two lists that must agree.
//
// Kept out of registryDb.ts so it can be read without expo-sqlite: the
// CREATE TABLEs below only ever run on a FRESH database, so every column
// added after a release needs an ALTER in `ADDED_COLUMNS` too, and a column
// that joins one list and not the other is invisible until a real device
// installs one way round and not the other. `schema.test.ts` is the check —
// root CLAUDE.md records the last time this pair drifted (ADDED_COLUMNS vs
// CREATE TABLE, which killed delta sync on every fresh install).
//
// PRIVACY: DDL only. No rows, no coordinates.

/** Run once per open, on a fresh or an existing database. */
export const SCHEMA_SQL = `
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
          label        TEXT,
          groupId      TEXT,
          groupLabel   TEXT
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
          pausedMs       INTEGER NOT NULL DEFAULT 0,
          pausedAt       TEXT,
          updatedAt      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS track_point (
          trackId     TEXT NOT NULL,
          seq         INTEGER NOT NULL,
          segment     INTEGER NOT NULL,
          lon REAL NOT NULL, lat REAL NOT NULL,
          altitudeM REAL, accuracyM REAL,
          timestampMs INTEGER NOT NULL,
          suppressedCount INTEGER,
          stationaryMs    INTEGER,
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
        -- The route being drawn right now, so an OS kill mid-draw doesn't
        -- lose it. At most one row (id = 1). Lives HERE rather than in
        -- logjam-prefs.db because it holds coordinates: this database is
        -- cleared by wipeLocalData on an account transition, and prefs
        -- deliberately are not.
        CREATE TABLE IF NOT EXISTS route_draft (
          id             INTEGER PRIMARY KEY CHECK (id = 1),
          pointsJson     TEXT NOT NULL,
          anchorsJson    TEXT NOT NULL,
          editingRouteId TEXT,
          savedAt        TEXT NOT NULL
        );
        -- (There was a region_download progress table here, from the original
        -- plan. Nothing ever wrote to it: the file IS the checkpoint, and
        -- unfinished downloads are discovered by reading the region directory.
        -- Dropped rather than left as schema nobody can explain.)
        DROP TABLE IF EXISTS region_download;
      `;

// Columns added to a table that already exists on installed devices. The
// CREATE TABLE statements above only run on a fresh DB, so each addition needs
// an idempotent ALTER here, guarded by an actual column check rather than a
// swallowed error (a genuinely broken ALTER must still throw).
export const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  // User-facing rename of a downloaded region/overlay (Saved tab). Display
  // only — resolution still keys off `logicalKey`.
  { table: "map_artifact", column: "label", definition: "TEXT" },
  // One "Save maps offline" run picks several basemaps for ONE area and used
  // to land as one unrelated card per basemap. The group is that run: every
  // artifact from it shares a groupId, and `groupLabel` is the name the user
  // gave the area (Saved shows one card per group). Legacy rows have neither
  // and group by their own id, which is exactly the old one-card-each shape.
  { table: "map_artifact", column: "groupId", definition: "TEXT" },
  { table: "map_artifact", column: "groupLabel", definition: "TEXT" },
  // Wall-clock recording time. The elapsed clock used to be derived from the
  // stored fix series, which stops at the last accepted fix — so the time
  // between the last fix and the Finish tap vanished from the saved track.
  // Pauses are now accumulated explicitly at the pause/resume taps.
  { table: "track", column: "pausedMs", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "track", column: "pausedAt", definition: "TEXT" },
  // What the recorder REFUSED after this point: fixes too close to it to be
  // progress, and how long they kept arriving. Positive evidence of standing
  // still — the only thing that separates a stop from slow travel once the
  // gap between accepted points is long (shared/trackStats.ts,
  // `demonstratedStoppedMs`). NULL on rows written before this landed, which
  // readers must treat as "not measured", never as "nothing was suppressed" —
  // so no DEFAULT 0 here.
  { table: "track_point", column: "suppressedCount", definition: "INTEGER" },
  { table: "track_point", column: "stationaryMs", definition: "INTEGER" },
];
