// The offline DB's schema, as two lists that must agree.
//
// Kept out of registryDb.ts so it can be read without expo-sqlite: the
// CREATE TABLEs below only ever run on a FRESH database, so every column
// added after a release needs an ALTER in `ADDED_COLUMNS` too, and a column
// that joins one list and not the other is invisible until a real device
// installs one way round and not the other. `schema.test.ts` is the check —
// root AGENTS.md records the last time this pair drifted (ADDED_COLUMNS vs
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
          -- (verifiedAt is omitted from fresh DDL; earlier installs retain the
          -- unused nullable column.)
          label        TEXT,
          groupId      TEXT,
          groupLabel   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_map_artifact_lookup
          ON map_artifact(kind, logicalKey);
        -- DROP TABLE IF EXISTS cleans up legacy vector_import: imports are
        -- standalone media rows in the sync mirror rather than device-only
        -- records. The statement is a no-op after the first open.
        DROP TABLE IF EXISTS vector_import;
        -- What is true about an import ON THIS PHONE, and only here: whether it
        -- is currently drawn, and where its bytes are.
        --
        -- Deliberately NOT synced. Visibility is a property of the map you are
        -- looking at, not of the file — toggling a layer off on the phone must
        -- not blank it on the laptop — and the paths are meaningless anywhere
        -- else. Keyed by the media id, so the row and its device state cannot
        -- drift apart.
        --
        -- Both paths are NULLABLE: a file imported on another device arrives as
        -- a row long before its bytes do. Null means "not on this phone yet",
        -- which is a normal state, not a broken one.
        CREATE TABLE IF NOT EXISTS import_view_state (
          mediaId       TEXT PRIMARY KEY,
          visible       INTEGER NOT NULL DEFAULT 1,
          path          TEXT,
          sourcePath    TEXT,
          sentBy        TEXT
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
          elevationSource TEXT,
          elevationCheckedFor TEXT,
          pointCount     INTEGER NOT NULL DEFAULT 0,
          startedAt      TEXT NOT NULL,
          endedAt        TEXT,
          pausedMs       INTEGER NOT NULL DEFAULT 0,
          pausedAt       TEXT,
          mediaId        TEXT,
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
          speedMps           REAL,
          headingDeg         REAL,
          altitudeAccuracyM  REAL,
          PRIMARY KEY (trackId, seq)
        );
        -- Fixes rejectTrackFix REFUSED, kept instead of dropped.
        --
        -- A SEPARATE TABLE on purpose, not a flag on track_point. Four queries
        -- treat that table as "the track": listTrackPoints draws it,
        -- lastTrackPoint hands the acceptance filter its reference, the seq
        -- allocator counts it, and track.pointCount sums it. A flag would mean
        -- each of those needing a predicate, and the one that matters --
        -- lastTrackPoint -- fails SILENTLY if it ever forgets: the filter would
        -- start measuring against a fix it had itself refused. Nothing reads
        -- this table, so it cannot break recording.
        --
        -- Its seq is its own counter, unrelated to track_point.seq. Order
        -- against accepted points by timestampMs.
        --
        -- Why keep them at all: diagnosing bad fixes requires the subsequent
        -- fixes; storing rejected fixes allows testing candidate filters
        -- against the raw fixes they judge.
        CREATE TABLE IF NOT EXISTS track_point_rejected (
          trackId     TEXT NOT NULL,
          seq         INTEGER NOT NULL,
          reason      TEXT NOT NULL,
          segment     INTEGER NOT NULL,
          lon REAL NOT NULL, lat REAL NOT NULL,
          altitudeM REAL, accuracyM REAL,
          timestampMs INTEGER NOT NULL,
          speedMps           REAL,
          headingDeg         REAL,
          altitudeAccuracyM  REAL,
          PRIMARY KEY (trackId, seq)
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
        -- DROP TABLE IF EXISTS cleans up legacy region_download: unfinished
        -- downloads are discovered by reading the region directory directly,
        -- so the file is the checkpoint.
        DROP TABLE IF EXISTS region_download;
        -- Likewise overlay_enabled: which topo overlay cells were switched on.
        -- The one overlay left is the Terrain tab's vegetation switch.
        DROP TABLE IF EXISTS overlay_enabled;
        -- Legacy waypoint table cleanup is handled by migrateLegacyWaypoints,
        -- which drains surviving rows into the sync mirror and drops the table
        -- itself. Do not DROP TABLE here: this SQL runs on every open ahead of
        -- migration, so dropping it here would delete unmigrated waypoints.
      `;

// Columns added to a table that already exists on installed devices. The
// CREATE TABLE statements above only run on a fresh DB, so each addition needs
// an idempotent ALTER here, guarded by an actual column check rather than a
// swallowed error (a genuinely broken ALTER must still throw).
export const ADDED_COLUMNS: {
  table: string;
  column: string;
  definition: string;
}[] = [
  // User-facing rename of a downloaded region/overlay (Saved tab). Display
  // only — resolution still keys off `logicalKey`.
  { table: "map_artifact", column: "label", definition: "TEXT" },
  // A "Save maps offline" run picks several basemaps for one area. Every
  // artifact from the run shares a groupId, and `groupLabel` is the name the
  // user gave the area (Saved shows one card per group). Legacy rows lack
  // groupId/groupLabel and group by their own id (one card each).
  { table: "map_artifact", column: "groupId", definition: "TEXT" },
  { table: "map_artifact", column: "groupLabel", definition: "TEXT" },
  // Wall-clock recording time. Deriving elapsed time from the fix series alone
  // would omit time between the last accepted fix and the Finish tap. Pauses
  // are accumulated explicitly at pause/resume taps.
  {
    table: "track",
    column: "pausedMs",
    definition: "INTEGER NOT NULL DEFAULT 0",
  },
  { table: "track", column: "pausedAt", definition: "TEXT" },
  // The standalone media row this finished recording was serialised into
  // (`sync/mediaUpload.createStandaloneMediaLocal`, origin "track"). NULL means
  // "not backed up yet" — a live recording, an empty one, or a finish whose
  // GPX write or registration failed and is waiting to be retried.
  //
  // The `track` + `track_point` tables stay the recorder's own store: the
  // points here are what the stats and the map line are computed from, and the
  // media row is a copy that syncs. This column is what stops the two being
  // shown as two recordings.
  { table: "track", column: "mediaId", definition: "TEXT" },
  // Where the row's climb and descent were read from (`CLIMB_SOURCES` in
  // shared/src/demSources.ts). NULL is GPS heights: every row written before
  // this, a live recording, and a finish no DEM could answer the whole of.
  { table: "track", column: "elevationSource", definition: "TEXT" },
  // The DEM source list the network was last asked for a finer climb under,
  // and had none: the upgrade pass asks again only when the list changes
  // (`tracks/trackClimb.ts`).
  { table: "track", column: "elevationCheckedFor", definition: "TEXT" },
  // What the recorder REFUSED after this point: fixes too close to it to be
  // progress, and how long they kept arriving. Positive evidence of standing
  // still — the only thing that separates a stop from slow travel once the
  // gap between accepted points is long (shared/trackStats.ts,
  // `demonstratedStoppedMs`). NULL on rows written before this landed, which
  // readers must treat as "not measured", never as "nothing was suppressed" —
  // so no DEFAULT 0 here.
  { table: "track_point", column: "suppressedCount", definition: "INTEGER" },
  { table: "track_point", column: "stationaryMs", definition: "INTEGER" },
  // The platform's velocity and vertical-quality channels, collected without
  // being acted on — see `CandidateFix` in shared/src/trackStats.ts. They are
  // here now rather than when a filter wants them because a fix that was never
  // recorded cannot be recovered, and they cost nothing to take: the platform
  // already computes them for every fix we receive.
  { table: "track_point", column: "speedMps", definition: "REAL" },
  { table: "track_point", column: "headingDeg", definition: "REAL" },
  { table: "track_point", column: "altitudeAccuracyM", definition: "REAL" },
];
