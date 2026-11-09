#!/usr/bin/env bash
# Tests for the Postgres image. Builds it (unless IMAGE_PREBUILT=1) and starts
# containers named brain-pg-test-*, removed on exit.
#
#   infra/brain/postgres/tests/test.sh
#
# Mutations, each applied once and seen red:
#   postgresql.conf: log_parameter_max_length = -1, pgaudit.log_parameter = on,
#     log_error_verbosity = default (the settings and the log checks);
#   brain-entrypoint.sh: BRAIN_INIT defaulting to bootstrap (no accidental
#     database);
#   pg_hba.prod.conf: any plain `host` line (the HBA checks);
#   brain-entrypoint.sh: dropping the dev certificate step (existing volume).
set -uo pipefail
cd "$(dirname "$0")/.." || exit
IMAGE=${IMAGE:-brain-postgres:test}
[ -n "${IMAGE_PREBUILT:-}" ] || docker build -q -t "$IMAGE" . > /dev/null || exit 1

DATA=/var/lib/postgresql/data
fails=0
ok() { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fails=1; }
not() { ! "$@"; }
check() { if "${@:2}"; then ok "$1"; else bad "$1"; fi; }
cleanup() {
  docker ps -aq --filter name=brain-pg-test | xargs -r docker rm -f -v > /dev/null 2>&1
  docker volume ls -q --filter name=brain-pg-test | xargs -r docker volume rm > /dev/null 2>&1
  return 0
}
trap cleanup EXIT
cleanup

# Waits for the real server: the throwaway one the official entrypoint runs
# during bootstrap has no TCP listener.
wait_up() {
  for _ in $(seq 90); do
    docker exec "$1" pg_isready -q -h 127.0.0.1 && return 0
    [ "$(docker inspect -f '{{.State.Running}}' "$1")" = true ] || break
    sleep 1
  done
  docker logs "$1" 2>&1 | tail -20
  return 1
}
# psql as the postgres OS user over the socket (prod's `local ... peer`).
sql() { docker exec -u postgres "$C" psql -U postgres -d postgres -tAXq "$@"; }
# A connection string run from inside the container.
conn() { docker exec -u postgres -e PGPASSWORD="${PW:-pw}" "$C" psql "$1" -tAXq -c "${2:-select 1}"; }

PROD_ENV=(-e BRAIN_INIT=bootstrap -e POSTGRES_PASSWORD=pw -e BRAIN_BACKUP_BUCKET=test -e AWS_REGION=ap-southeast-2 -e BRAIN_BACKUP_ENDPOINT=localhost:9)

# --- no accidental database -------------------------------------------------
for init in "" bogus restore-typo; do
  C=brain-pg-test-empty
  docker volume create brain-pg-test-empty > /dev/null
  docker run -d --name $C -v brain-pg-test-empty:$DATA -e BRAIN_INIT="$init" -e POSTGRES_PASSWORD=pw -e BRAIN_BACKUP_BUCKET=test -e AWS_REGION=ap-southeast-2 "$IMAGE" > /dev/null
  # A database that was created would keep running: timing out is a failure.
  rc=$(timeout 60 docker wait $C || echo running)
  out=$(docker logs $C 2>&1)
  docker rm -f $C > /dev/null
  left=$(docker run --rm -v brain-pg-test-empty:$DATA --entrypoint sh "$IMAGE" -c "ls -A $DATA")
  check "BRAIN_INIT='$init' on an empty directory exits non-zero (got $rc)" grep -Eq '^[1-9]' <<<"$rc"
  check "BRAIN_INIT='$init' creates nothing in it" [ -z "$left" ]
  check "BRAIN_INIT='$init' says why" grep -q 'refusing to create' <<<"$out"
  docker volume rm brain-pg-test-empty > /dev/null
done

# --- prod mode: settings, HBA, TLS, audit -----------------------------------
C=brain-pg-test-prod
docker run -d --name $C -v brain-pg-test-prod:$DATA "${PROD_ENV[@]}" "$IMAGE" > /dev/null
if ! wait_up $C; then bad "prod container did not come up"; exit 1; fi

check "bootstrap enables data checksums" [ "$(sql -c 'show data_checksums')" = on ]

while IFS='|' read -r name want; do
  got=$(sql -c "show $name")
  check "SHOW $name = $want" [ "$got" = "$want" ]
done <<'WANT'
shared_preload_libraries|pgaudit
pgaudit.log|read, write, ddl, role
pgaudit.log_parameter|off
pgaudit.log_catalog|off
log_connections|on
log_error_verbosity|terse
log_parameter_max_length|0
log_parameter_max_length_on_error|0
log_statement|none
log_min_error_statement|panic
log_min_duration_statement|-1
log_line_prefix|%t:%r:%u@%d:[%p]:
log_destination|stderr
ssl|on
wal_level|replica
archive_mode|on
archive_timeout|1min
archive_command|pgbackrest --stanza=logjam archive-push %p
max_connections|50
WANT
check "auto_explain is not configured" [ "$(sql -c "select count(*) from pg_settings where name like 'auto_explain.%'")" = 0 ]
check "pgaudit extension exists in the first database" [ "$(sql -c "select count(*) from pg_extension where extname='pgaudit'")" = 1 ]

check "prod pg_hba.conf has no plain host line" not grep -Eq '^host[[:space:]]' pg_hba.prod.conf
check "the installed pg_hba.conf has no plain host line" not docker exec $C grep -Eq '^host[[:space:]]' $DATA/pg_hba.conf
err=$(conn "host=127.0.0.1 user=postgres dbname=postgres sslmode=disable" 2>&1); rc=$?
check "a connection without TLS is refused" [ "$rc" != 0 ]
check "...by pg_hba.conf, not by the password" grep -q 'no pg_hba.conf entry' <<<"$err"
check "verify-full pinning the generated certificate connects over TLS" \
  [ "$(conn "host=localhost user=postgres dbname=postgres sslmode=verify-full sslrootcert=$DATA/server.crt" 'select ssl from pg_stat_ssl where pid=pg_backend_pid()')" = t ]
check "verify-full refuses a name the certificate does not carry" \
  not conn "host=127.0.0.1 user=postgres dbname=postgres sslmode=verify-full sslrootcert=$DATA/server.crt" > /dev/null 2>&1
check "the server key is 0600 and owned by postgres" [ "$(docker exec $C stat -c '%a %U' $DATA/server.key)" = "600 postgres" ]

secret=SECRET_LITERAL_9f3a1c
# \bind sends the value as a parameter, as Prisma does.
printf '%s\n' \
  'create table audit_t (v text unique);' \
  "insert into audit_t (v) values (\$1) \\bind '$secret' \\g" \
  "insert into audit_t (v) values (\$1) \\bind '$secret' \\g" \
  | docker exec -i -u postgres $C psql -U postgres -d postgres -q > /dev/null 2>&1
logs=$(docker logs $C 2>&1)
check "pgaudit logs the write" grep -Eq 'AUDIT: SESSION,[0-9]+,[0-9]+,WRITE,INSERT,.*insert into audit_t' <<<"$logs"
check "the parameter value is in no log line" not grep -q "$secret" <<<"$logs"
check "the duplicate-key error was logged, without its row" \
  bash -c 'grep -q "violates unique constraint" <<<"$1" && ! grep -q "Key (v)" <<<"$1"' _ "$logs"
cleanup

# --- dev mode on a volume the stock image made -------------------------------
C=brain-pg-test-dev
DEV=(-e POSTGRES_DB=logjam -e POSTGRES_USER=logjam -e POSTGRES_PASSWORD=logjam)
docker run -d --name brain-pg-test-stock -v brain-pg-test-dev:$DATA "${DEV[@]}" postgres:16 > /dev/null
for _ in $(seq 60); do docker exec brain-pg-test-stock pg_isready -q -h 127.0.0.1 -U logjam && break; sleep 1; done
docker stop brain-pg-test-stock > /dev/null && docker rm brain-pg-test-stock > /dev/null
docker run -d --name $C -v brain-pg-test-dev:$DATA -e BRAIN_DEV=1 -e BRAIN_INIT=bootstrap "${DEV[@]}" "$IMAGE" postgres -c archive_mode=off > /dev/null
if wait_up $C; then
  ok "an existing stock volume starts"
  PW=logjam
  check "plain TCP with the dev password works" [ "$(conn 'host=127.0.0.1 user=logjam dbname=logjam sslmode=disable' 2>/dev/null)" = 1 ]
  check "the passwordless local socket works (make dev-snapshot)" docker exec $C psql -U logjam logjam -tAqc 'select 1' > /dev/null 2>&1
  check "the -c archive_mode=off from Compose wins" [ "$(docker exec $C psql -U logjam logjam -tAXqc 'show archive_mode' 2>/dev/null)" = off ]
  check "the settings file still applies" [ "$(docker exec $C psql -U logjam logjam -tAXqc 'show log_error_verbosity' 2>/dev/null)" = terse ]
else
  bad "an existing stock volume starts"
fi

exit $fails
