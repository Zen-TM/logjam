#!/bin/bash
# Dump and sanitize the prod DB into snapshots/latest.sql.
# Requires DATABASE_URL_PROD to be set in the environment.
set -e

if [ -z "$DATABASE_URL_PROD" ]; then
  echo "ERROR: DATABASE_URL_PROD is not set."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SNAPSHOTS_DIR="$REPO_ROOT/snapshots"
TEMP_DB="logjam_snapshot_sanitize"

mkdir -p "$SNAPSHOTS_DIR"

echo "Dumping prod DB..."
pg_dump --no-owner --no-acl "$DATABASE_URL_PROD" > "$SNAPSHOTS_DIR/raw.sql"

echo "Creating temp DB for sanitization..."
createdb "$TEMP_DB" 2>/dev/null || true
psql "$TEMP_DB" < "$SNAPSHOTS_DIR/raw.sql" > /dev/null

echo "Sanitizing PII..."
psql "$TEMP_DB" <<'SQL'
  -- Anonymise user data — replace real emails and Cognito IDs with safe locals
  UPDATE users
  SET
    email      = 'user-' || id || '@local',
    cognito_id = 'sanitized-' || id,
    username   = 'user-' || substring(id::text, 1, 8);

  -- Clear free-text notes that may contain location-sensitive content
  UPDATE canyons SET notes = NULL WHERE notes IS NOT NULL;
  UPDATE trip_logs SET notes = NULL WHERE notes IS NOT NULL;
SQL

echo "Exporting sanitized snapshot..."
pg_dump --no-owner --no-acl "$TEMP_DB" > "$SNAPSHOTS_DIR/latest.sql"

echo "Cleaning up temp DB..."
dropdb "$TEMP_DB"
rm "$SNAPSHOTS_DIR/raw.sql"

echo "Snapshot saved to snapshots/latest.sql"
echo "Verify no real emails: grep -i '@' snapshots/latest.sql | grep -v '@local'"
