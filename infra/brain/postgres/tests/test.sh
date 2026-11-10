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
#   brain-entrypoint.sh: dropping the dev certificate step (existing volume);
#   brain-entrypoint.sh: dropping the leading-dash normalisation (the server
#     the prod container starts with only -c flags);
#   brain-entrypoint.sh: dropping ${BRAIN_RESTORE_OPTS} (restore keeps archiving);
#   pg_ident.conf: dropping the brain_agent line;
#   Dockerfile: dropping ca-certificates (the S3 handshake).
set -uo pipefail
cd "$(dirname "$0")/.." || exit
IMAGE=${IMAGE:-brain-postgres:test}
[ -n "${IMAGE_PREBUILT:-}" ] || docker build -q --provenance=false --sbom=false -t "$IMAGE" . > /dev/null || exit 1

DATA=/var/lib/postgresql/data
fails=0
ok() { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fails=1; }
not() { ! "$@"; }
# For a command whose own output is noise: the check still reports.
quiet() { "$@" > /dev/null 2>&1; }
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

check "pgaudit is loaded in the server" [ "$(sql -c "select count(*) from pg_settings where name = 'pgaudit.log'")" = 1 ]
check "prod pg_hba.conf has no plain host line" not grep -Eq '^host[[:space:]]' pg_hba.prod.conf
check "the installed pg_hba.conf has no plain host line" not docker exec $C grep -Eq '^host[[:space:]]' $DATA/pg_hba.conf
err=$(conn "host=127.0.0.1 user=postgres dbname=postgres sslmode=disable" 2>&1); rc=$?
check "a connection without TLS is refused" [ "$rc" != 0 ]
check "...by pg_hba.conf, not by the password" grep -q 'no pg_hba.conf entry' <<<"$err"
check "verify-full pinning the generated certificate connects over TLS" \
  [ "$(conn "host=localhost user=postgres dbname=postgres sslmode=verify-full sslrootcert=$DATA/server.crt" 'select ssl from pg_stat_ssl where pid=pg_backend_pid()')" = t ]
check "verify-full refuses a name the certificate does not carry" \
  not quiet conn "host=127.0.0.1 user=postgres dbname=postgres sslmode=verify-full sslrootcert=$DATA/server.crt"
check "the server key is 0600 and owned by postgres" [ "$(docker exec $C stat -c '%a %U' $DATA/server.key)" = "600 postgres" ]

sql -c 'create role brain_agent login' -c 'create role third_role login' > /dev/null
check "OS user postgres connects as brain_agent under the prod HBA" \
  [ "$(docker exec -u postgres $C psql -U brain_agent -d postgres -tAXqc 'select current_user' 2>&1)" = brain_agent ]
check "...and as a third role is refused" not quiet docker exec -u postgres $C psql -U third_role -d postgres -tAXqc 'select 1'

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

# A command of only flags, as a Compose `command: ["-c", ...]` gives, on the data
# directory that now has a database: without the settings file the server
# would boot on upstream defaults.
docker rm -f $C > /dev/null
docker run -d --name $C -v brain-pg-test-prod:$DATA "${PROD_ENV[@]}" "$IMAGE" -c shared_buffers=64MB > /dev/null
if wait_up $C; then
  check "a -c flag on a command of only flags is applied" [ "$(sql -c 'show shared_buffers')" = 64MB ]
  check "a command of only -c flags still reads postgresql.conf (log_error_verbosity)" [ "$(sql -c 'show log_error_verbosity')" = terse ]
  check "...and loads pgaudit" [ "$(sql -c 'show shared_preload_libraries')" = pgaudit ]
else
  bad "the prod container starts with only flags"
fi
cleanup

# --- commands that are not the server ---------------------------------------
# The host runs `pgbackrest info` through this image to choose restore or bootstrap.
BUCKET_ENV=(-e BRAIN_BACKUP_BUCKET=conf-bucket -e AWS_REGION=ap-southeast-2)
check "pgbackrest runs on no data directory and no BRAIN_INIT" quiet docker run --rm "$IMAGE" pgbackrest version
check "bash runs on no data directory and no BRAIN_INIT" quiet docker run --rm "$IMAGE" bash -c true
check "psql --help runs" quiet docker run --rm "$IMAGE" psql --help
check "postgres --version runs without a data directory" quiet docker run --rm "$IMAGE" postgres --version
check "a non-server command with no bucket does not need one" quiet docker run --rm "$IMAGE" true
conf=$(docker run --rm "${BUCKET_ENV[@]}" "$IMAGE" cat /etc/pgbackrest/pgbackrest.conf 2>&1)
check "a non-server command renders pgbackrest.conf when the bucket is set" grep -q '^repo1-s3-bucket=conf-bucket$' <<<"$conf"
check "pgbackrest.conf has bundling and start-fast" bash -c 'grep -q "^repo1-bundle=y$" <<<"$1" && grep -q "^start-fast=y$" <<<"$1"' _ "$conf"
check "the archive queue defaults to 8GiB" grep -q '^archive-push-queue-max=8GiB$' <<<"$conf"
check "no pg1-user without BRAIN_BACKUP_PG_USER" not grep -q '^pg1-user' <<<"$conf"
conf=$(docker run --rm "${BUCKET_ENV[@]}" -e BRAIN_BACKUP_PG_USER=brain_agent -e BRAIN_ARCHIVE_QUEUE_MAX=1GiB -e AWS_ACCESS_KEY_ID=AKIAEXAMPLE -e AWS_SECRET_ACCESS_KEY=s -e AWS_SESSION_TOKEN=tok "$IMAGE" cat /etc/pgbackrest/pgbackrest.conf 2>&1)
check "BRAIN_BACKUP_PG_USER becomes pg1-user" grep -q '^pg1-user=brain_agent$' <<<"$conf"
check "AWS_SESSION_TOKEN becomes repo1-s3-token" grep -q '^repo1-s3-token=tok$' <<<"$conf"
check "BRAIN_ARCHIVE_QUEUE_MAX overrides the default" grep -q '^archive-push-queue-max=1GiB$' <<<"$conf"
check "TLS verification is on by default" not grep -q 'verify-tls' <<<"$conf"
check "BRAIN_BACKUP_VERIFY_TLS=n is refused without an endpoint" \
  not quiet docker run --rm "${BUCKET_ENV[@]}" -e BRAIN_BACKUP_VERIFY_TLS=n "$IMAGE" true
conf=$(docker run --rm "${BUCKET_ENV[@]}" -e BRAIN_BACKUP_VERIFY_TLS=n -e BRAIN_BACKUP_ENDPOINT=stand-in:9000 "$IMAGE" cat /etc/pgbackrest/pgbackrest.conf 2>&1)
check "...and turns verification off with one" grep -q '^repo1-storage-verify-tls=n$' <<<"$conf"
check "a non-root user can render the config" quiet docker run --rm --user postgres "${BUCKET_ENV[@]}" "$IMAGE" pgbackrest version
check "the image verifies the regional S3 certificate (ca-certificates)" \
  docker run --rm --entrypoint sh "$IMAGE" -c "echo | openssl s_client -connect s3.ap-southeast-2.amazonaws.com:443 -servername s3.ap-southeast-2.amazonaws.com -verify_return_error 2>&1 | grep -q 'Verify return code: 0'"
# The daily restore drill's command; tests/e2e.sh runs it. Mutation: dropping its COPY from the Dockerfile.
check "the restore drill script is in the image and executable" quiet docker run --rm --entrypoint test "$IMAGE" -x /usr/local/lib/brain/drill.sh

# --- backup and restore (a posix repository stands in for S3) ----------------
# BRAIN_RESTORE_OPTS=--archive-mode=off is what a restore drill passes.
R=(-e POSTGRES_PASSWORD=pw "${BUCKET_ENV[@]}" -e PGBACKREST_REPO1_TYPE=posix -e PGBACKREST_REPO1_PATH=/repo -v brain-pg-test-repo:/repo)
docker volume create brain-pg-test-repo > /dev/null
docker run --rm -v brain-pg-test-repo:/repo --entrypoint chmod "$IMAGE" 777 /repo
C=brain-pg-test-src
docker run -d --name $C -v brain-pg-test-src:$DATA -e BRAIN_INIT=bootstrap "${R[@]}" "$IMAGE" > /dev/null
if wait_up $C; then
  as_pg() { docker exec -u postgres $C "$@"; }
  quiet as_pg pgbackrest --stanza=logjam stanza-create
  quiet as_pg psql -U postgres -qAtc "create table t(v text); insert into t values ('before')"
  quiet as_pg pgbackrest --stanza=logjam --type=full backup
  quiet as_pg psql -U postgres -qAtc "insert into t values ('after'); select pg_switch_wal()"
  sleep 3
  docker stop $C > /dev/null
  C=brain-pg-test-restored
  docker run -d --name $C -v brain-pg-test-restored:$DATA -e BRAIN_INIT=restore -e BRAIN_RESTORE_OPTS=--archive-mode=off "${R[@]}" "$IMAGE" > /dev/null
  if wait_up $C; then
    check "BRAIN_INIT=restore brings back the backup and the archived WAL" \
      [ "$(sql -c "select string_agg(v, ',' order by v) from t")" = after,before ]
    check "BRAIN_RESTORE_OPTS reaches the restore (archive_mode off)" [ "$(sql -c 'show archive_mode')" = off ]
    check "the restored server uses postgresql.conf" [ "$(sql -c 'show log_error_verbosity')" = terse ]
  else
    bad "a restore starts"
  fi
else
  bad "the backup source starts"
fi
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
  check "the passwordless local socket works (make dev-snapshot)" quiet docker exec $C psql -U logjam logjam -tAqc 'select 1'
  check "the -c archive_mode=off from Compose wins" [ "$(docker exec $C psql -U logjam logjam -tAXqc 'show archive_mode' 2>/dev/null)" = off ]
  check "a volume made by stock postgres:16 gives no collation warning" \
    not grep -q 'collation version' <<<"$(docker exec $C psql -U logjam logjam -tAqc 'select 1' 2>&1)"
  check "the settings file still applies" [ "$(docker exec $C psql -U logjam logjam -tAXqc 'show log_error_verbosity' 2>/dev/null)" = terse ]
else
  bad "an existing stock volume starts"
fi

exit $fails
