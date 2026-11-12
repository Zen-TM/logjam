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
#   brain-entrypoint.sh: dropping --target-timeline=current (the restore follows the archive's newest timeline);
#   pg_ident.conf: dropping the brain_agent line;
#   Dockerfile: dropping ca-certificates (the S3 handshake);
#   Dockerfile: dropping the docker-compose COPY (the host's Compose plugin);
#   Dockerfile: dropping task-lib.sh or drill.sh from the task scripts' COPY;
#   Dockerfile: dropping `ENV PGDATA` (the cluster is made outside the mount, as #932 showed);
#   the test layer (below): dropping postgresql-16 from it (no 16 database can be made and the upgrade cannot read one);
#   brain-entrypoint.sh: dropping the major-version guard, or moving it above the init/restore
#     block (a 16 directory crashes the 18 server; a restored 16 backup does too);
#   major-upgrade.sh: `--copy` -> `--link` (the old cluster is no longer a rollback);
#   major-upgrade.sh: dropping `-c archive_mode=off` from the old server's start or from
#     --old-options (an old cluster archives into the repository);
#   major-upgrade.sh: dropping the server.crt/server.key copy (a new certificate);
#   major-upgrade.sh: the checksum setting fixed to `--data-checksums` (an old cluster without them);
#   major-upgrade.sh: the refusals for a newer cluster, missing binaries (the real image, which has no 16 ones, is
#     given 16 data), too little space, an
#     existing postgres-<N> and a foreign postgres.new (one with a PG_VERSION of another major, one with
#     files and none), each deleted in turn;
#   major-upgrade.sh: dropping the finish-the-rename branch (the rerun after a crash does nothing);
#   major-upgrade.sh: pg_upgrade's output sent to stdout; dropping the ALTER SYSTEM carry-over, or
#     carrying a restore's recovery settings too.
# Not testable here: that the swap is one atomic rename (`mv -T --exchange`); the state after a crash is.
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
# 18's own PGDATA is /var/lib/postgresql/18/docker, outside the mount every compose file makes.
check "PGDATA is the mounted path" [ "$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" | sed -n 's/^PGDATA=//p')" = "$DATA" ]
check "the cluster is in the mount" [ "$(sql -c 'show data_directory')" = "$DATA" ]
check "the image runs the Postgres major the Dockerfile pins" \
  [ "$(sql -c 'show server_version_num' | cut -c1-2)" = "$(sed -n 's/^FROM postgres:\([0-9]*\)\..*/\1/p' Dockerfile)" ]

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
check "the host's Compose plugin is in the image and prints its version" docker run --rm --entrypoint /usr/local/lib/brain/docker-compose "$IMAGE" version
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
# The library the drill sources. Mutation: dropping it from the Dockerfile's COPY.
check "the task library is in the image" quiet docker run --rm --entrypoint test "$IMAGE" -f /usr/local/lib/brain/task-lib.sh

# --- backup and restore (a posix repository stands in for S3) ----------------
# BRAIN_RESTORE_OPTS=--archive-mode=off: a restore that never archives (the drill passes the same option itself).
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
    check "the restore follows its backup's timeline, not the archive's newest" [ "$(sql -c 'show recovery_target_timeline')" = current ]
    check "the restored server uses postgresql.conf" [ "$(sql -c 'show log_error_verbosity')" = terse ]
  else
    bad "a restore starts"
  fi
else
  bad "the backup source starts"
fi
cleanup

# --- the major-version guard, and upgrading a 16 database ----------------------------
# The test layer: this image plus the previous major's packages, which prod's image does not carry (a major
# upgrade adds them for its transition: docs/operations/brain.md). UPIMG is that and nothing else: it runs
# major-upgrade.sh and the 16 tools. IMG16 is the previous image as far as these tests need it: the same with the
# 16 server first on PATH and PG_MAJOR=16, so the real entrypoints make a real 16 database the way prod's was made.
# The next major's upgrade changes the 16 here (and the 18 in the Dockerfile). The 16 is pinned to the minor prod's
# data was made by: 16.16's server writes a column option, pg_attver, that 18.6's pg_upgrade cannot restore.
UPIMG=$IMAGE-with-16
IMG16=$IMAGE-as-16
printf 'FROM %s\nRUN apt-get update && apt-get install -y --no-install-recommends postgresql-16=16.15-1.pgdg13+2 postgresql-client-16=16.15-1.pgdg13+2 postgresql-16-pgaudit=16.1-2.pgdg13+1 && rm -rf /var/lib/apt/lists/*\n' "$IMAGE" |
  docker build -q -t "$UPIMG" - > /dev/null || { bad "the test layer with the 16 packages builds"; exit 1; }
printf 'FROM %s\nENV PG_MAJOR=16\nENV PATH=/usr/lib/postgresql/16/bin:%s\n' "$UPIMG" "$(docker run --rm --entrypoint printenv "$IMAGE" PATH)" |
  docker build -q -t "$IMG16" - > /dev/null || { bad "the 16 image builds"; exit 1; }
SUB() { echo "type=volume,src=$1,dst=$DATA,volume-subpath=postgres"; } # the host mounts /data/postgres at $DATA
vol_sh() { local v=$1; shift; docker run --rm -v "$v":/data --entrypoint bash "$UPIMG" -c "$@"; } # root, on a whole volume
sqlj() { docker exec -u postgres "$C" psql -U postgres -d logjam -tAXq "$@"; }
# make16 <volume> <stop|kill>: a 16 cluster as prod made it, with a row, a role with a password and the
# certificate; its own config archives (starting it without archive_mode=off shows, the command runs in the
# data directory), and a segment waits for the archiver.
make16() {
  docker volume create "$1" > /dev/null
  vol_sh "$1" 'mkdir -p /data/postgres'
  C=brain-pg-test-16
  docker run -d --name $C --mount "$(SUB "$1")" -e BRAIN_INIT=bootstrap -e POSTGRES_DB=logjam -e POSTGRES_HOST_AUTH_METHOD=trust \
    -e BRAIN_TLS_SANS=brain.test,localhost "${BUCKET_ENV[@]}" -e BRAIN_BACKUP_ENDPOINT=localhost:9 "$IMG16" > /dev/null
  wait_up $C && [ "$(sql -c 'show server_version_num' | cut -c1-2)" = 16 ] || return 1
  sqlj -c "create table t (v text); insert into t values ('row16'); create role logjam_app login password 'secret-pw'; grant connect on database logjam to logjam_app" > /dev/null &&
    sqlj -c "alter system set work_mem = '7MB'" > /dev/null &&
    docker exec $C bash -c "printf \"archive_mode = on\narchive_command = 'touch archive-attempted'\n\" >> $DATA/postgresql.conf; printf \"restore_command = 'false'\nrecovery_target_timeline = 'current'\n\" >> $DATA/postgresql.auto.conf" &&
    sqlj -c "select pg_switch_wal()" > /dev/null || return 1
  if [ "$2" = kill ]; then docker kill $C > /dev/null; else docker stop $C > /dev/null; fi
  docker rm -f -v $C > /dev/null
}
# upgrade <volume> [docker args]: stdout to $WORK/out, stderr to $WORK/err, the exit status in $rc. UPG_IMAGE is the image
# it runs in: the test layer, unless a test gives it prod's.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"; cleanup' EXIT
UPG_IMAGE=$UPIMG
upgrade() { local v=$1; shift; docker run --rm -v "$v":/data "$@" "$UPG_IMAGE" /usr/local/lib/brain/major-upgrade.sh > "$WORK/out" 2> "$WORK/err"; rc=$?; }
silent() { bash -c '[ ! -s "$1" ] && [ ! -s "$2" ]' _ "$WORK/out" "$WORK/err"; }
untouched() { [ "$(vol_sh "$1" 'cat /data/postgres/PG_VERSION; ls /data | tr "\n" " "')" = "$(printf '16\npostgres ')" ]; }

make16 brain-pg-test-up stop || bad "a 16 database is made (clean shutdown)"
make16 brain-pg-test-up-kill kill || bad "a 16 database is made (killed)"
make16 brain-pg-test-up-refuse stop || bad "a 16 database is made (for the refusals)"

# The guard: a server start on another major's directory says so and starts nothing.
C=brain-pg-test-guard
docker run -d --name $C --mount "$(SUB brain-pg-test-up-refuse)" "${PROD_ENV[@]}" -e BRAIN_INIT=none "$IMAGE" > /dev/null
rc=$(timeout 60 docker wait $C || echo running)
out=$(docker logs $C 2>&1)
docker rm -f $C > /dev/null
check "an 18 server on a 16 directory exits non-zero (got $rc)" grep -Eq '^[1-9]' <<<"$rc"
check "...naming both versions" bash -c 'grep -q "holds a PostgreSQL 16 database" <<<"$1" && grep -q "this image runs PostgreSQL 18" <<<"$1"' _ "$out"
check "...and what to do (the host upgrades prod; make reset in dev)" bash -c 'grep -q "boot upgrades it" <<<"$1" && grep -q "make reset" <<<"$1"' _ "$out"
check "...and it started nothing: the directory is as it was" untouched brain-pg-test-up-refuse
check "...while a command that is not the server runs there" quiet docker run --rm --mount "$(SUB brain-pg-test-up-refuse)" "$IMAGE" postgres --version

# After a restore as well: a backup of the old major comes back as an old-major directory.
R16=(-e POSTGRES_PASSWORD=pw "${BUCKET_ENV[@]}" -e PGBACKREST_REPO1_TYPE=posix -e PGBACKREST_REPO1_PATH=/repo -v brain-pg-test-repo16:/repo)
docker volume create brain-pg-test-repo16 > /dev/null
docker run --rm -v brain-pg-test-repo16:/repo --entrypoint chmod "$IMAGE" 777 /repo
C=brain-pg-test-src16
docker run -d --name $C -v brain-pg-test-src16:$DATA -e BRAIN_INIT=bootstrap "${R16[@]}" "$IMG16" > /dev/null
if wait_up $C; then
  quiet docker exec -u postgres $C pgbackrest --stanza=logjam stanza-create
  quiet docker exec -u postgres $C pgbackrest --stanza=logjam --type=full backup
  docker stop $C > /dev/null
  C=brain-pg-test-restore16
  docker run -d --name $C -v brain-pg-test-restore16:$DATA -e BRAIN_INIT=restore "${R16[@]}" "$IMAGE" > /dev/null
  rc=$(timeout 90 docker wait $C || echo running)
  out=$(docker logs $C 2>&1)
  check "restoring a 16 backup under the 18 image stops (got $rc)" grep -Eq '^[1-9]' <<<"$rc"
  check "...with the version message, not a crash" grep -q 'holds a PostgreSQL 16 database' <<<"$out"
else
  bad "a 16 database with a backup is made"
fi
docker ps -aq --filter name=brain-pg-test | xargs -r docker rm -f -v > /dev/null 2>&1

# Refusals: each leaves the old cluster where it was and prints nothing on stdout.
refuses() { # <what> <message fragment>
  check "$1: exit non-zero (got $rc)" [ "$rc" != 0 ]
  check "...saying why" grep -q -- "$2" "$WORK/err"
  check "...and nothing on stdout" [ ! -s "$WORK/out" ]
}
V=brain-pg-test-up-refuse
UPG_IMAGE=$IMAGE upgrade $V; refuses "the real image, which carries no 16 binaries, given a 16 cluster" "no PostgreSQL 16 binaries"
check "...and the cluster is untouched" untouched $V
upgrade $V -e BRAIN_UPGRADE_MARGIN=1125899906842624; refuses "too little free space" "not upgrading"
check "...and nothing was made" untouched $V
vol_sh $V 'mkdir /data/postgres-16'
upgrade $V; refuses "an existing postgres-16" "exists already"
vol_sh $V 'rmdir /data/postgres-16'
vol_sh $V 'mkdir /data/postgres.new && echo 15 > /data/postgres.new/PG_VERSION && echo keep > /data/postgres.new/mine'
upgrade $V; refuses "a postgres.new holding a 15 cluster" "not deleting it"
check "...which is still there" [ "$(vol_sh $V 'cat /data/postgres.new/mine')" = keep ]
vol_sh $V 'rm -rf /data/postgres.new'
vol_sh $V 'mkdir /data/postgres.new && echo keep > /data/postgres.new/mine'
upgrade $V; refuses "a postgres.new with files and no PG_VERSION" "not deleting it"
check "...which is still there" [ "$(vol_sh $V 'cat /data/postgres.new/mine')" = keep ]
vol_sh $V 'rm -rf /data/postgres.new'
vol_sh brain-pg-test-up-newer 'mkdir -p /data/postgres && echo 19 > /data/postgres/PG_VERSION'
upgrade brain-pg-test-up-newer; refuses "a cluster newer than the image" "this image runs 18"
check "...and it is untouched" [ "$(vol_sh brain-pg-test-up-newer 'cat /data/postgres/PG_VERSION; ls /data')" = "$(printf '19\npostgres')" ]

# What an unfinished run left (a new cluster, here a marker file) is removed, and the upgrade goes ahead.
vol_sh $V 'mkdir /data/postgres.new && echo 18 > /data/postgres.new/PG_VERSION && touch /data/postgres.new/junk'
upgrade $V
check "an unfinished postgres.new of its own is replaced, and the upgrade succeeds (exit $rc)" [ "$rc" = 0 ]
check "...stdout is the one line" [ "$(cat "$WORK/out")" = "upgraded 16 -> 18" ]
check "...and the junk is gone" quiet vol_sh $V 'test ! -e /data/postgres/junk && test ! -e /data/postgres-16/junk'

# A full upgrade, from a clean shutdown.
V=brain-pg-test-up
upgrade $V
[ "$rc" = 0 ] || tail -20 "$WORK/err"
check "the upgrade exits 0 (got $rc)" [ "$rc" = 0 ]
check "stdout is one line: upgraded 16 -> 18" [ "$(cat "$WORK/out")" = "upgraded 16 -> 18" ]
check "pg_upgrade's output went to stderr" grep -q 'Upgrade Complete' "$WORK/err"
check "the new cluster is at /data/postgres, and the old one is kept as /data/postgres-16" \
  [ "$(vol_sh $V 'cat /data/postgres/PG_VERSION /data/postgres-16/PG_VERSION; ls /data | tr "\n" " "')" = "$(printf '18\n16\npostgres postgres-16 ')" ]
check "the old cluster was copied, not linked (no data file has a second link)" [ "$(vol_sh $V 'find /data/postgres-16/base -type f -links +1 | wc -l')" = 0 ]
check "the same certificate and key, with the same mode and owner" \
  [ "$(vol_sh $V 'cd /data && for d in postgres postgres-16; do stat -c "%a %U" $d/server.key; sha256sum < $d/server.crt; sha256sum < $d/server.key; done | sort -u | wc -l')" = 3 ]
check "the old server config's archive_command never ran (clean shutdown, pending segment)" quiet vol_sh $V 'test ! -e /data/postgres-16/archive-attempted && test ! -e /data/postgres/archive-attempted'

C=brain-pg-test-upgraded
docker run -d --name $C --mount "$(SUB $V)" "${PROD_ENV[@]}" -e BRAIN_INIT=none "$IMAGE" > /dev/null
if wait_up $C; then
  check "the 18 server starts on the upgraded cluster" [ "$(sql -c 'show server_version_num' | cut -c1-2)" = 18 ]
  check "the row is there" [ "$(sqlj -c 'select v from t')" = row16 ]
  PW=secret-pw
  check "the role connects over TLS with its password, pinning the same certificate" \
    [ "$(conn "host=localhost user=logjam_app dbname=logjam sslmode=verify-full sslrootcert=$DATA/server.crt" 'select current_user')" = logjam_app ]
  check "data checksums are still on" [ "$(sql -c 'show data_checksums')" = on ]
  check "encoding, collation and provider are the old cluster's" \
    [ "$(sql -c "select pg_encoding_to_char(encoding) || '/' || datcollate || '/' || datctype || '/' || datlocprovider::text from pg_database where datname = 'logjam'")" = UTF8/en_US.utf8/en_US.utf8/c ]
  check "an ALTER SYSTEM setting survived" [ "$(sql -c 'show work_mem')" = 7MB ]
  check "...and a restore's recovery settings were not carried" not docker exec $C grep -Eq '^(restore_command|recovery_)' $DATA/postgresql.auto.conf
  check "the prod HBA is installed again (no plain host line)" not docker exec $C grep -Eq '^host[[:space:]]' $DATA/pg_hba.conf
  check "the pgaudit extension came across" [ "$(sqlj -c "select count(*) from pg_extension where extname = 'pgaudit'")" = 1 ]
  sqlj -c "insert into t values ('audited')" > /dev/null
  check "pgaudit logs a write on the upgraded cluster" bash -c 'docker logs "$1" 2>&1 | grep -Eq "AUDIT: SESSION,[0-9]+,[0-9]+,WRITE,INSERT,.*insert into t"' _ $C
  check "the image's settings apply (log_error_verbosity)" [ "$(sql -c 'show log_error_verbosity')" = terse ]
else
  bad "the 18 server starts on the upgraded cluster"
fi
docker rm -f -v $C > /dev/null

# The old cluster is the rollback: the 16 server still starts on it and finds its row, and not the new one.
check "the 16 server starts on the kept old cluster and finds its row" \
  [ "$(docker run --rm -v $V:/data --entrypoint bash "$UPIMG" -c '
    B=/usr/lib/postgresql/16/bin
    gosu postgres $B/pg_ctl -D /data/postgres-16 -w -o "-c listen_addresses= -c unix_socket_directories=/tmp" -l /tmp/log start > /dev/null &&
    gosu postgres $B/psql -h /tmp -U postgres -d logjam -tAXqc "select min(v) from t"
    gosu postgres $B/pg_ctl -D /data/postgres-16 -m fast -w stop > /dev/null' 2>&1)" = row16 ]

# A rerun on a finished upgrade does nothing and says nothing.
upgrade $V
check "a rerun on an upgraded cluster exits 0 (got $rc)" [ "$rc" = 0 ]
check "...and prints nothing at all" silent

# A crash between the exchange and the last rename: the new cluster is in place, the old one has the temporary name.
inode=$(vol_sh $V 'stat -c %i /data/postgres')
vol_sh $V 'mv /data/postgres-16 /data/postgres.new'
upgrade $V
check "after a crash between the swap and the rename the rerun exits 0 (got $rc)" [ "$rc" = 0 ]
check "...finishes the rename and says so" [ "$(cat "$WORK/out")" = "upgraded 16 -> 18" ]
check "...so the old cluster is /data/postgres-16 again and no postgres.new is left" \
  [ "$(vol_sh $V 'cat /data/postgres-16/PG_VERSION; ls /data | tr "\n" " "')" = "$(printf '16\npostgres postgres-16 ')" ]
check "...and the new cluster was not touched (same directory)" [ "$(vol_sh $V 'stat -c %i /data/postgres')" = "$inode" ]
upgrade $V
check "...and a rerun after that does nothing" silent

# A cluster made without data checksums comes out without them (the setting is read, not assumed).
V=brain-pg-test-up-nosum
# 16's initdb has no --no-data-checksums, and the entrypoint always asks for them: initdb by hand, the superuser postgres as prod's.
docker volume create $V > /dev/null
vol_sh $V 'mkdir -p /data/postgres && chown postgres:postgres /data/postgres && chmod 0700 /data/postgres && gosu postgres /usr/lib/postgresql/16/bin/initdb -D /data/postgres --username=postgres > /dev/null'
check "the old cluster has no checksums" [ "$(vol_sh $V 'gosu postgres /usr/lib/postgresql/16/bin/pg_controldata /data/postgres | sed -n "s/^Data page checksum version: *//p"')" = 0 ]
upgrade $V
check "a cluster without checksums upgrades (exit $rc)" [ "$rc" = 0 ]
C=brain-pg-test-upgraded-nosum
docker run -d --name $C --mount "$(SUB $V)" "${PROD_ENV[@]}" -e BRAIN_DEV=1 -e BRAIN_INIT=none "$IMAGE" > /dev/null
if wait_up $C; then
  check "...and the upgraded one has none either" [ "$(sql -c 'show data_checksums')" = off ]
else
  bad "the 18 server starts on the upgraded cluster without checksums"
fi
docker rm -f -v $C > /dev/null

# Not shut down cleanly: the server was killed with a segment waiting for the archiver.
V=brain-pg-test-up-kill
upgrade $V
[ "$rc" = 0 ] || tail -20 "$WORK/err"
check "a cluster that was killed is recovered and upgraded (exit $rc)" [ "$rc" = 0 ]
check "...saying it was not shut down" grep -q 'state: in production' "$WORK/err"
check "...without archiving: the old config's archive_command never ran" quiet vol_sh $V 'test ! -e /data/postgres-16/archive-attempted && test ! -e /data/postgres/archive-attempted'
C=brain-pg-test-upgraded-kill
docker run -d --name $C --mount "$(SUB $V)" "${PROD_ENV[@]}" -e BRAIN_INIT=none "$IMAGE" > /dev/null
if wait_up $C; then
  check "...and the row written before the kill is there" [ "$(sqlj -c 'select v from t')" = row16 ]
else
  bad "the 18 server starts on the recovered and upgraded cluster"
fi
cleanup

# --- dev mode on a volume the stock image made -------------------------------
C=brain-pg-test-dev
DEV=(-e POSTGRES_DB=logjam -e POSTGRES_USER=logjam -e POSTGRES_PASSWORD=logjam)
# The stock image of the Dockerfile's own FROM line, with PGDATA where a dev volume has always been
# (its own default is outside the mount: the Dockerfile says why).
STOCK=$(sed -n 's/^FROM //p' Dockerfile)
docker run -d --name brain-pg-test-stock -v brain-pg-test-dev:$DATA -e PGDATA=$DATA "${DEV[@]}" "$STOCK" > /dev/null
for _ in $(seq 60); do docker exec brain-pg-test-stock pg_isready -q -h 127.0.0.1 -U logjam && break; sleep 1; done
docker stop brain-pg-test-stock > /dev/null && docker rm brain-pg-test-stock > /dev/null
docker run -d --name $C -v brain-pg-test-dev:$DATA -e BRAIN_DEV=1 -e BRAIN_INIT=bootstrap "${DEV[@]}" "$IMAGE" postgres -c archive_mode=off > /dev/null
if wait_up $C; then
  ok "an existing stock volume starts"
  PW=logjam
  check "plain TCP with the dev password works" [ "$(conn 'host=127.0.0.1 user=logjam dbname=logjam sslmode=disable' 2>/dev/null)" = 1 ]
  check "the passwordless local socket works (make dev-snapshot)" quiet docker exec $C psql -U logjam logjam -tAqc 'select 1'
  check "the -c archive_mode=off from Compose wins" [ "$(docker exec $C psql -U logjam logjam -tAXqc 'show archive_mode' 2>/dev/null)" = off ]
  check "a volume made by the stock image gives no collation warning" \
    not grep -q 'collation version' <<<"$(docker exec $C psql -U logjam logjam -tAqc 'select 1' 2>&1)"
  check "the settings file still applies" [ "$(docker exec $C psql -U logjam logjam -tAXqc 'show log_error_verbosity' 2>/dev/null)" = terse ]
else
  bad "an existing stock volume starts"
fi

exit $fails
