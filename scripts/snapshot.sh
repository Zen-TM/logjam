#!/bin/bash
# Dump and sanitize the prod DB into snapshots/latest.sql.
# Requires DB_HOST_PROD, DB_NAME_PROD, DB_USER_PROD, DB_PASSWORD_PROD to be set
# in the environment (DB_PORT_PROD optional, defaults to 5432). pg_dump takes
# discrete connection flags, so no URL/encoding is needed.
set -e

if [ -z "$DB_HOST_PROD" ] || [ -z "$DB_NAME_PROD" ] || [ -z "$DB_USER_PROD" ] || [ -z "$DB_PASSWORD_PROD" ]; then
  echo "ERROR: DB_HOST_PROD, DB_NAME_PROD, DB_USER_PROD and DB_PASSWORD_PROD must all be set."
  exit 1
fi

DB_PORT_PROD="${DB_PORT_PROD:-5432}"
export PGPASSWORD="$DB_PASSWORD_PROD"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SNAPSHOTS_DIR="$REPO_ROOT/snapshots"
TEMP_DB="logjam_snapshot_sanitize"

mkdir -p "$SNAPSHOTS_DIR"

# INF-011: set -e means a failure between the dump and the final `rm` below
# (e.g. the sanitize psql block) previously left the raw, unsanitized prod
# dump (real emails, Cognito ids) sitting unencrypted on disk indefinitely.
# Trap covers every exit path, not just the happy one; -f makes it a no-op
# once the happy-path rm below already removed the file.
trap 'rm -f "$SNAPSHOTS_DIR/raw.sql"' EXIT

echo "Dumping prod DB..."
pg_dump --no-owner --no-acl -h "$DB_HOST_PROD" -p "$DB_PORT_PROD" -U "$DB_USER_PROD" "$DB_NAME_PROD" > "$SNAPSHOTS_DIR/raw.sql"

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
