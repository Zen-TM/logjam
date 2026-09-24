#!/usr/bin/env bash
# Migration UPGRADE test: apply this checkout's migrations over a database that
# already holds data at the BASE schema, then check the data came across and
# the result matches schema.prisma. The `migrations` CI job only proves the
# migrations apply to an EMPTY database, which is exactly the case where a
# backfill or a SET NOT NULL cannot fail.
#
#   scripts/migration-upgrade-test.sh seed [base-ref]
#       CI / local. Checks out base-ref (default origin/main — what prod runs)
#       in a temp worktree, migrates + seeds an EMPTY database with it, adds
#       edge-case fixtures, then upgrades. Refuses a database that has tables.
#
#   scripts/migration-upgrade-test.sh existing
#       Release rehearsal against a RESTORED COPY of prod (never prod itself —
#       this runs `migrate deploy` on the target). No seed, no fixtures.
#       Requires UPGRADE_TARGET_IS_A_COPY=yes.
#
# Both need DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD (the same vars
# prisma.config.ts reads), psql, and `npm ci` already run in this checkout's
# api/. Data checks: api/prisma/upgrade-check/{baseline,verify}.sql.
set -euo pipefail

MODE="${1:-}"
BASE_REF="${2:-origin/main}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKS="$ROOT/api/prisma/upgrade-check"

for var in DB_HOST DB_NAME DB_USER DB_PASSWORD; do
  if [ -z "${!var:-}" ]; then echo "ERROR: $var must be set." >&2; exit 1; fi
done
export PGHOST="$DB_HOST" PGPORT="${DB_PORT:-5432}" PGDATABASE="$DB_NAME" \
       PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD"
psql_run() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

case "$MODE" in
  seed)
    TABLES=$(psql_run -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
    if [ "$TABLES" != "0" ]; then
      echo "ERROR: $DB_NAME@$DB_HOST has $TABLES tables; seed mode needs an EMPTY database (the seed deletes rows)." >&2
      exit 1
    fi
    WORKTREE="$(mktemp -d)"
    trap 'git -C "$ROOT" worktree remove --force "$WORKTREE"' EXIT
    git -C "$ROOT" worktree add --detach "$WORKTREE" "$BASE_REF"
    echo "== base $BASE_REF ($(git -C "$WORKTREE" rev-parse --short HEAD)): migrate + seed"
    (cd "$WORKTREE/shared" && npm ci --no-audit --no-fund && npm run build)
    (cd "$WORKTREE/api" && npm ci --no-audit --no-fund && npx prisma generate \
       && npx prisma migrate deploy && npx prisma db seed)
    psql_run -v fixtures=1 -f "$CHECKS/baseline.sql"
    ;;
  existing)
    if [ "${UPGRADE_TARGET_IS_A_COPY:-}" != "yes" ]; then
      echo "ERROR: existing mode runs migrate deploy on $DB_NAME@$DB_HOST. Point it at a restored COPY and set UPGRADE_TARGET_IS_A_COPY=yes." >&2
      exit 1
    fi
    psql_run -f "$CHECKS/baseline.sql"
    ;;
  *)
    echo "usage: $0 seed [base-ref] | existing" >&2; exit 2 ;;
esac

echo "== head $(git -C "$ROOT" rev-parse --short HEAD): migrate deploy over existing data"
(cd "$ROOT/api" && npx prisma migrate deploy)
psql_run -f "$CHECKS/verify.sql"

# After upgrading, the database must be exactly what schema.prisma describes —
# catches drift that an empty-database run cannot (a migration that assumed a
# column prod never had, or one that only half-applied its intent).
echo "== schema drift check (upgraded DB vs schema.prisma)"
(cd "$ROOT/api" && npx prisma migrate diff --from-config-datasource \
   --to-schema prisma/schema.prisma --exit-code)
echo "migration upgrade test: PASS"
