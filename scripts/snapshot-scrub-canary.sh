#!/usr/bin/env bash
# Proves scripts/snapshot-scrub.sql removes what a user typed, by running it.
# Against a migrated and seeded DATABASE (never prod; this rewrites every row):
# plant a made-up marker in each scrubbed column (snapshot-scrub-canary.sql),
# check every marker landed in a dump, run the scrub, and fail if any
# marker is still in a dump or a shared system place type lost its name.
#
# Needs DB_HOST DB_NAME DB_USER DB_PASSWORD (DB_PORT optional), psql and pg_dump.
# CI: the `migration-upgrade` job, after the upgrade.
#
# Mutation that turns it red: delete any statement from snapshot-scrub.sql (a
# survivor), or its WHERE from the place_types UPDATE (a system type renamed).
set -euo pipefail

for var in DB_HOST DB_NAME DB_USER DB_PASSWORD; do
  if [ -z "${!var:-}" ]; then echo "ERROR: $var must be set." >&2; exit 1; fi
done
export PGHOST="$DB_HOST" PGPORT="${DB_PORT:-5432}" PGDATABASE="$DB_NAME" \
       PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
psql_run() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
dump() { pg_dump --no-owner --no-acl > "$1"; }
system_types() { psql_run -tAc "SELECT id || ' ' || name FROM place_types WHERE owner_id IS NULL ORDER BY id"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

psql_run -f "$HERE/snapshot-scrub-canary.sql"
MARKERS="$(grep -oE 'CANARY-[a-z_]+-[A-Za-z_]+' "$HERE/snapshot-scrub-canary.sql" | sort -u)"
[ "$(wc -l <<<"$MARKERS")" -ge 30 ] || { echo "FAIL: the canary names too few markers" >&2; exit 1; }
SYSTEM_BEFORE="$(system_types)"
[ -n "$SYSTEM_BEFORE" ] || { echo "FAIL: no system place types to check" >&2; exit 1; }

dump "$WORK/planted.sql"
while read -r marker; do
  grep -qF "$marker" "$WORK/planted.sql" \
    || { echo "FAIL: $marker is not in the planted data (the table has no row to plant in)" >&2; exit 1; }
done <<<"$MARKERS"

psql_run -f "$HERE/snapshot-scrub.sql"
dump "$WORK/scrubbed.sql"

status=0
while read -r marker; do
  if grep -qF "$marker" "$WORK/scrubbed.sql"; then
    echo "FAIL: $marker survives the scrub. Scrub that column in scripts/snapshot-scrub.sql." >&2
    status=1
  fi
done <<<"$MARKERS"
if [ "$(system_types)" != "$SYSTEM_BEFORE" ]; then
  echo "FAIL: the scrub renamed a system place type; they keep their names." >&2
  status=1
fi
[ "$status" = 0 ] && echo "snapshot scrub canary: PASS ($(wc -l <<<"$MARKERS") markers)"
exit "$status"
