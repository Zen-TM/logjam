#!/usr/bin/env bash
# The brain's whole life on one machine, with no AWS: the host scripts under
# infra/brain/host run for real against a loop device standing in for the data
# volume, the Postgres and API images built from this tree, and MiniStack
# standing in for S3 and Secrets Manager (behind a TLS proxy, because
# pgBackRest only speaks TLS to S3).
#
#   infra/brain/tests/e2e.sh        needs root or passwordless sudo, Docker with
#                                   Compose, the aws CLI, python3, openssl
#
# It refuses to run where /opt/brain, /etc/brain, /data/postgres or a mounted /data exist, and
# only ever formats, mounts or detaches the loop device it makes itself. Run it
# on a CI runner or in a throwaway container, never on a real brain.
# E2E_FAIL_FAST=1 stops at the first failure (for applying a mutation);
# E2E_KEEP=1 leaves the host as it ends, for debugging (remove it by hand);
# E2E_PREBUILT=1 skips the image builds (PG_IMAGE and API_IMAGE must exist);
# E2E_MS_PORT and E2E_TLS_PORT move the two ports it publishes (default 56010
# and 56011); the API listens on port 80 of the host, as on the brain.
#
# Mutations, each applied once and seen red (scenario in brackets):
#   host/lib.sh: bootstrap_allowed true for anything but the exact value 1 (`= 1` -> `!= 0`) [3]
#   host/boot.sh: format a device that has a signature (`0) ;;` -> `0) mkfs.ext4 -F ...`) [3]
#   host/boot.sh: the zeros clause back (`[ -n "$(wipefs -n "$dev")" ]` -> `[ -n "$(head -c 1048576 "$dev" | tr -d '\0' | head -c 1)" ] || [ -n "$(wipefs -n "$dev")" ]`) [3]
#   host/release-agent.sh: not reading the switch (`if false` for `!= on`) [5]
#   host/lib.sh: serving_state answering on for anything but exactly on [5]
#   host/release-agent.sh: writing LOGJAM_RUNTIME=prod before the release env [6]
#   host/status.sh: one more key in status.json [9]
#   compose.yaml: dropping `create_host_path: false` from the data mount [10]
#   host/agent.sql: GRANT ALL ON brain.canary [1]
#   compose.yaml: dropping BRAIN_BACKUP_PG_USER (pgBackRest connects as the superuser) [2]
#   host/status.sh: dropping `SELECT pg_switch_wal()` [8b]
#   host/boot.sh: an unreadable repository read as empty (`elif stanzas and all(` -> `elif True or all(`) [3]
#   host/boot.sh: dropping the pg_control check (`-e /data/postgres/global/pg_control` -> `-e /nonexistent`) [8c]
#   host/boot.sh: the restart baseline (`"true $restarts"` -> `"true 0"`) [2]
#   host/release-agent.sh: keeping the new api.env after a failed `compose up` (no `rm -f`) [7]
#   host/boot.sh: ignoring the setup marker (`if [ -e "$marker" ]` -> `if false`) [8c]
#   host/boot.sh: not writing the marker for a bootstrap (`echo "$mode" > "$marker"` -> `true`) [1]
# shellcheck disable=SC2329,SC2317 # functions run through check and wait_for
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit
ROOT=$PWD
SUDO=; [ "$(id -u)" = 0 ] || SUDO=sudo
r() { $SUDO "$@"; }

MS_PORT=${E2E_MS_PORT:-56010}
TLS_PORT=${E2E_TLS_PORT:-56011}
PG_IMAGE=${PG_IMAGE:-brain-e2e-postgres:test}
API_IMAGE=${API_IMAGE:-logjam-api-e2e:build}
API_REPO=logjam-api-e2e
SIGNALS=e2e-signals
BACKUPS=e2e-backups
APP_PW=e2e-app-password-$$
WORK=$(mktemp -d)
LOOP=
fails=0
S=setup

ok() { echo "ok   - $S: $1"; }
bad() { echo "FAIL - $S: $1"; fails=1; [ -z "${E2E_FAIL_FAST:-}" ] || exit 1; }
check() { if "${@:2}"; then ok "$1"; else bad "$1"; fi; }
not() { ! "$@"; }
fatal() { bad "$1"; dump; exit 1; }
wait_for() { # <seconds> <command...>
  local n=$1; shift
  while ! "$@" > /dev/null 2>&1; do n=$((n - 1)); [ "$n" -gt 0 ] || return 1; sleep 1; done
}

# --- the host the scripts run on ----------------------------------------------
cid() { r docker ps -aq --filter label=com.docker.compose.project=brain --filter label=com.docker.compose.service="$1"; }
lcompose() { r bash -c '. /opt/brain/host/lib.sh; compose "$@"' _ "$@"; }
sql() { r docker exec -u postgres "$(cid postgres)" psql -U postgres -d "$1" -tAXqc "$2"; }
boot() { r /opt/brain/host/boot.sh > "$WORK/boot.log" 2>&1; }
boot_limited() { r timeout 300 /opt/brain/host/boot.sh > "$WORK/boot.log" 2>&1; } # a regression fails instead of hanging
agent() { r /opt/brain/host/release-agent.sh > "$WORK/agent.log" 2>&1; }
brain_env() { # <KEY> [value]: set the line, or remove it when no value is given
  r sed -i "/^$1=/d" /etc/brain/brain.env
  [ $# -lt 2 ] || echo "$1=$2" | r tee -a /etc/brain/brain.env > /dev/null
}
dump() {
  for f in boot agent; do [ -s "$WORK/$f.log" ] && { echo "--- $f.log"; tail -30 "$WORK/$f.log"; }; done
  for s in postgres api; do [ -n "$(cid $s)" ] && { echo "--- $s logs"; r docker logs --tail 25 "$(cid $s)" 2>&1; }; done
}

lose_disk() { # the volume vanishes under a running Postgres: no clean shutdown to archive its last segment
  r docker kill "$(cid postgres)" > /dev/null 2>&1
  reboot; new_disk
}
new_disk() { # a blank "data volume" at the stable path, whatever was there
  detach_disk
  rm -f "$WORK/disk.img"; truncate -s 512M "$WORK/disk.img"
  LOOP=$(r losetup --find --show "$WORK/disk.img") || fatal "no loop device"
  r ln -sfn "$LOOP" /run/brain-e2e-data
}
detach_disk() { # only what this script made
  [ -n "$LOOP" ] || return 0
  if mountpoint -q /data && [ "$(findmnt -n -o SOURCE /data)" = "$LOOP" ]; then r umount /data; fi
  r losetup -d "$LOOP"; LOOP=
}
reboot() { # containers die, the mount goes, the volume stays attached
  lcompose --profile '*' down > /dev/null 2>&1
  if mountpoint -q /data; then r umount /data; fi
}
cleanup() {
  [ -z "${E2E_KEEP:-}" ] || return 0 # leave everything up to debug a failure
  [ -x /opt/brain/host/lib.sh ] && lcompose --profile '*' down -v --remove-orphans > /dev/null 2>&1
  r docker rm -fv brain-e2e-ministack brain-e2e-tls brain-e2e-creds brain-e2e-src brain-e2e-copy > /dev/null 2>&1
  r docker network rm brain-e2e > /dev/null 2>&1
  detach_disk
  r rm -rf /opt/brain /etc/brain /run/brain /run/brain-e2e-data /run/brain-e2e-serving /run/brain-e2e-bootstrap /run/brain-release.lock
  [ -z "${IMDS_PID:-}" ] || kill "$IMDS_PID" 2> /dev/null
  rm -rf "$WORK"
}

fulls() { r docker exec -u postgres "$(cid postgres)" pgbackrest --stanza=logjam info --output=json | python3 -c '
import json, sys
print(sum(b["type"] == "full" for s in json.load(sys.stdin) for b in s["backup"]))'; }
status_keys() { aws s3 cp "s3://$SIGNALS/status.json" - | python3 -c 'import json, sys; print(*sorted(json.load(sys.stdin)))'; }
status_field() { aws s3 cp "s3://$SIGNALS/status.json" - | python3 -c 'import json, sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }
fingerprint() { r openssl x509 -in /data/postgres/server.crt -noout -fingerprint -sha256; }
ready() { curl -fsS -o /dev/null -m 3 http://127.0.0.1:80/ready; }
api_has() { r docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(cid api)" | grep -qx "$1"; }
pg_ready() { r docker exec "$(cid postgres)" pg_isready -q -h 127.0.0.1; }
pg_has() { r docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(cid postgres)" | grep -qx "$1"; }
superuser_connected() { # <extra docker logs args>
  r docker logs "$@" "$(cid postgres)" 2>&1 | grep -q 'connection authorized: user=postgres'
}
restore_reported() {
  [ "$(status_field last_restore_at)" != None ] && [ "$(status_field last_restore_lag_seconds)" -ge 0 ]
}
api_refused() { r docker logs "$(cid api)" 2>&1 | grep -q 'AUTH_MODE=fake refused'; }
archived() { # <wal file>: that segment or a later one reached the repository
  local got; got=$(sql postgres 'select last_archived_wal from pg_stat_archiver')
  [ -n "$got" ] && [[ ! $got < $1 ]]
}
as_agent() { # <database> <psql args>: connect as the agent role, as status.sh does
  local db=$1; shift
  r docker exec -u postgres "$(cid postgres)" psql -U brain_agent -d "$db" -tAXq "$@"
}
app_connects() {
  [ "$(r docker exec -e PGPASSWORD="$APP_PW" "$(cid postgres)" psql "host=localhost user=logjam_app dbname=logjam sslmode=verify-full sslrootcert=/var/lib/postgresql/data/server.crt" -tAXqc 'select current_user')" = logjam_app ]
}
identity() { echo "$(sql postgres "select string_agg(rolname, ',' order by rolname) from pg_roles where rolname !~ '^pg_'")/$(sql postgres "select string_agg(datname, ',' order by datname) from pg_database")"; }
api_tag() { r docker inspect -f '{{.Config.Image}}' "$(cid api)"; }

# A release pointer built from the committed api.env, as CI will build it, with
# the stand-in AWS endpoint added and any K=V overrides after it.
release() { # <sha> [K=V]...
  python3 - "$ROOT/infra/brain/api.env" "$MS_ENDPOINT_IN" "$@" <<'PY'
import json, sys
path, endpoint, sha, *overrides = sys.argv[1:]
env = dict(l.rstrip("\n").split("=", 1) for l in open(path) if l.strip() and not l.startswith("#"))
env.update(AWS_ENDPOINT_URL=endpoint, AWS_ACCESS_KEY_ID="test", AWS_SECRET_ACCESS_KEY="test", SMTP_HOST="127.0.0.1")
env.update(o.split("=", 1) for o in overrides)
print(json.dumps({"sha": sha, "env": env}))
PY
}
point() { release "$@" | aws s3 cp - "s3://$SIGNALS/release.json" --only-show-errors; }
serving() { printf '%s' "$1" | r tee /run/brain-e2e-serving > /dev/null; }
bootstrap_flag() { printf '%s' "$1" | r tee /run/brain-e2e-bootstrap > /dev/null; }

trap cleanup EXIT

# --- setup ---------------------------------------------------------------------
if [ -e /opt/brain ] || [ -e /etc/brain ] || [ -e /data/postgres ] || mountpoint -q /data; then
  echo "refusing: this host already has a brain (/opt/brain, /etc/brain, /data/postgres or a mounted /data)"; trap - EXIT; exit 1
fi
if ss -ltn 'sport = :80' | grep -q LISTEN; then echo "port 80 is taken: the API needs it"; trap - EXIT; exit 1; fi
r rm -rf /run/brain-e2e-serving /run/brain-e2e-bootstrap # a killed earlier run's switches
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=ap-southeast-2
export AWS_ENDPOINT_URL=http://127.0.0.1:$MS_PORT
MS_ENDPOINT_IN=http://host.docker.internal:$MS_PORT

if [ -z "${E2E_PREBUILT:-}" ]; then
  docker build -q -t "$PG_IMAGE" infra/brain/postgres > /dev/null || fatal "the Postgres image does not build"
  docker build -q -f api/Dockerfile --build-arg GIT_SHA=e2e -t "$API_IMAGE" . > /dev/null || fatal "the API image does not build"
fi
docker tag "$API_IMAGE" "$API_REPO:release-a"
docker tag "$API_IMAGE" "$API_REPO:release-b"

docker network create brain-e2e > /dev/null
docker run -d --name brain-e2e-ministack --network brain-e2e -p "$MS_PORT:4566" \
  -e SERVICES=s3,secretsmanager -e DEFAULT_REGION=ap-southeast-2 ministackorg/ministack > /dev/null || fatal "MiniStack does not start"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=host.docker.internal -addext subjectAltName=DNS:host.docker.internal \
  -keyout "$WORK/tls.key" -out "$WORK/tls.crt" 2> /dev/null
cat > "$WORK/nginx.conf" <<EOF
events {}
http {
  server {
    listen 4443 ssl;
    ssl_certificate /tls/tls.crt;
    ssl_certificate_key /tls/tls.key;
    client_max_body_size 0;
    proxy_request_buffering off;
    location / {
      proxy_pass http://brain-e2e-ministack:4566;
      proxy_http_version 1.1;
      proxy_set_header Host \$http_host;
    }
  }
}
EOF
chmod 644 "$WORK/tls.key"
docker run -d --name brain-e2e-tls --network brain-e2e -p "$TLS_PORT:4443" \
  -v "$WORK/nginx.conf:/etc/nginx/nginx.conf:ro" -v "$WORK:/tls:ro" nginx:1.27-alpine > /dev/null || fatal "the TLS proxy does not start"
wait_for 90 aws s3 ls || fatal "MiniStack does not answer"
for b in "$SIGNALS" "$BACKUPS"; do aws s3 mb "s3://$b" > /dev/null || fatal "no bucket $b"; done
aws secretsmanager create-secret --name logjam/app-db-password \
  --secret-string "{\"username\":\"logjam_app\",\"password\":\"$APP_PW\"}" > /dev/null || fatal "no app secret"
for s in logjam/origin-verify logjam/resend-api-key; do
  aws secretsmanager create-secret --name "$s" --secret-string e2e-placeholder > /dev/null || fatal "no secret $s"
done

# What the instance's user data does: infra/brain at /opt/brain, brain.env.
r mkdir -p /opt/brain /etc/brain /run/brain
r cp -a infra/brain/. /opt/brain/
cat <<EOF | r tee /etc/brain/brain.env > /dev/null
AWS_REGION=ap-southeast-2
BRAIN_DATA_DEVICE=/run/brain-e2e-data
BRAIN_PG_IMAGE=$PG_IMAGE
BRAIN_API_REPO=$API_REPO
BRAIN_BACKUP_BUCKET=$BACKUPS
BRAIN_SIGNALS_BUCKET=$SIGNALS
BRAIN_TLS_SANS=brain.e2e.test,postgres,localhost
BRAIN_PG_FLAGS=-c shared_buffers=64MB -c max_wal_size=256MB
BRAIN_RESTORE_TARGET=
BRAIN_APP_DB_SECRET_ID=logjam/app-db-password
BRAIN_LOG_GROUP_API=
BRAIN_LOG_GROUP_PG=
AWS_ENDPOINT_URL=$AWS_ENDPOINT_URL
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
BRAIN_BACKUP_ENDPOINT=host.docker.internal:$TLS_PORT
BRAIN_COMPOSE_EXTRA=/opt/brain/tests/compose.test.yaml
BRAIN_REPO_WAIT=1
BRAIN_SERVING_FILE=/run/brain-e2e-serving
BRAIN_BOOTSTRAP_FILE=/run/brain-e2e-bootstrap
EOF

# --- static ----------------------------------------------------------------------
S="static"
check "the shared role script is the one scripts/ keeps" cmp scripts/bootstrap-app-db-role.sql infra/brain/host/bootstrap-app-db-role.sql
if command -v shellcheck > /dev/null; then
  check "the host scripts pass shellcheck" bash -c 'cd infra/brain/host && shellcheck -x *.sh ../tests/e2e.sh'
elif [ -n "${CI:-}" ]; then bad "shellcheck is not installed"; fi
check "compose.yaml with the test file renders" lcompose --profile '*' config -q
check "compose.yaml with the awslogs file renders" env AWS_REGION=r BRAIN_BACKUP_BUCKET=b BRAIN_PG_IMAGE=i BRAIN_API_REPO=a BRAIN_TLS_SANS=s \
  BRAIN_LOG_GROUP_API=a BRAIN_LOG_GROUP_PG=p docker compose -f infra/brain/compose.yaml -f infra/brain/compose.aws.yaml --profile '*' config -q
if command -v systemd-analyze > /dev/null; then
  check "the systemd units verify" r systemd-analyze verify --man=no /opt/brain/host/systemd/*.service /opt/brain/host/systemd/*.timer
fi

# --- 3. a blank volume with nothing to restore and no flag: refuse -----------------
S="3 refusing an empty database"
new_disk
refused() { # <what the switch is>: boot.sh stops, says so, and creates nothing
  boot; rc=$?
  check "$1: boot.sh exits non-zero (got $rc)" [ "$rc" != 0 ]
  check "$1: and says why" grep -q refusing "$WORK/boot.log"
  check "$1: no data directory" [ ! -e /data/postgres ]
  check "$1: no container" [ -z "$(r docker ps -aq --filter label=com.docker.compose.project=brain)" ]
}
for flag in 0 "" yes true "1 please" 11; do
  bootstrap_flag "$flag"; refused "the bootstrap tag reading '$flag'"
done
r rm -f /run/brain-e2e-bootstrap; refused "no bootstrap tag"
r mkdir /run/brain-e2e-bootstrap; refused "an unreadable bootstrap tag"; r rmdir /run/brain-e2e-bootstrap
check "the backup repository is still empty" [ -z "$(aws s3 ls "s3://$BACKUPS" --recursive)" ]
check "the boot mode is refused" [ "$(cat /run/brain/boot-mode)" = refused ]

# `pgbackrest info` exits 0 when the repository cannot be reached, with an empty backup list: that
# must not read as an empty repository, or a blank volume with the tag at 1 would bootstrap.
S="3 an unreadable repository is not an empty one"
bootstrap_flag 1
brain_env BRAIN_BACKUP_ENDPOINT "host.docker.internal:1"
boot; rc=$?
check "boot.sh exits non-zero with the tag at 1 (got $rc)" [ "$rc" != 0 ]
check "...and names the repository" grep -q "cannot read the backup repository" "$WORK/boot.log"
check "...creates no data directory" [ ! -e /data/postgres ]
check "...starts no container" [ -z "$(r docker ps -aq --filter label=com.docker.compose.project=brain)" ]
check "...and the boot mode is failed" [ "$(cat /run/brain/boot-mode)" = failed ]
brain_env BRAIN_BACKUP_ENDPOINT "host.docker.internal:$TLS_PORT"

S="3 never formatting what has a signature"
bootstrap_flag 0
reboot; new_disk
r mkfs.ext4 -q -L precious "$LOOP"
mkdir "$WORK/m" && r mount "$LOOP" "$WORK/m" && echo keep | r tee "$WORK/m/marker" > /dev/null && r umount "$WORK/m"
boot
check "a volume with a filesystem is mounted, not reformatted (label kept)" [ "$(r blkid -o value -s LABEL "$LOOP")" = precious ]
check "its files survive" [ "$(cat /data/marker 2> /dev/null)" = keep ]
reboot; new_disk
r mkswap -q "$LOOP"
before=$(r blkid -p "$LOOP")
boot; rc=$?
check "a volume with another signature stops boot (exit $rc)" [ "$rc" != 0 ]
check "its signature is untouched" [ "$(r blkid -p "$LOOP")" = "$before" ]
check "it is not mounted" not mountpoint -q /data
# A new encrypted EBS volume reads back non-zero bytes with no signature: it is blank all the same.
reboot; new_disk
r dd if=/dev/urandom of="$LOOP" bs=1M count=2 status=none
boot
check "a device of random bytes with no signature is formatted" grep -q "is blank: formatting" "$WORK/boot.log"
check "...with the brain's label" [ "$(r blkid -o value -s LABEL "$LOOP")" = brain-data ]
check "...and mounted" mountpoint -q /data

# --- 10. the volume is not mounted ----------------------------------------------------
S="10 the volume is not mounted"
reboot; new_disk
check "/data is a plain directory on the root disk" not mountpoint -q /data
r mkdir -p /data
lcompose up -d postgres > "$WORK/up.log" 2>&1; rc=$?
check "compose up postgres fails (got $rc)" [ "$rc" != 0 ]
check "nothing is written under /data" [ -z "$(ls -A /data)" ]
check "no Postgres container was created" [ -z "$(cid postgres)" ]
lcompose --profile '*' down > /dev/null 2>&1

# --- 1. first boot ------------------------------------------------------------------
S="1 bootstrap"
new_disk
bootstrap_flag 1
# A first boot that dies at the roles step (an unreadable secret) leaves a cluster and the setup
# marker. The next boot finishes that bootstrap on the same cluster: it never deletes it, as the
# API may already have written to it, and never waits on a role that was not made yet.
brain_env BRAIN_APP_DB_SECRET_ID logjam/no-such-secret
boot; rc=$?
check "a bootstrap that cannot read the app secret fails (exit $rc)" [ "$rc" != 0 ]
check "...leaves the marker naming the bootstrap" [ "$(cat /data/.setup-in-progress)" = bootstrap ]
check "...and the cluster it made" r test -e /data/postgres/global/pg_control
check "...and the boot mode is failed" [ "$(cat /run/brain/boot-mode)" = failed ]
sysid0=$(sql postgres "select system_identifier from pg_control_system()")
brain_env BRAIN_APP_DB_SECRET_ID logjam/app-db-password
boot_limited; rc=$?
check "the next boot finishes it (exit $rc)" [ "$rc" = 0 ]
[ "$rc" = 0 ] || fatal "boot.sh did not finish the bootstrap"
check "...on the same cluster" [ "$(sql postgres "select system_identifier from pg_control_system()")" = "$sysid0" ]
check "...with the marker gone" [ ! -e /data/.setup-in-progress ]
check "...and the boot mode bootstrap" [ "$(cat /run/brain/boot-mode)" = bootstrap ]
check "the device is formatted and mounted at /data" [ "$(findmnt -n -o FSTYPE /data)" = ext4 ]
check "the database logjam exists" [ "$(sql postgres "select count(*) from pg_database where datname='logjam'")" = 1 ]
check "logjam_app exists and is not a superuser" [ "$(sql postgres "select count(*) from pg_roles where rolname='logjam_app' and not rolsuper and not rolcreatedb and not rolcreaterole")" = 1 ]
check "the superuser has no password" [ "$(sql postgres "select rolpassword is null from pg_authid where rolname='postgres'")" = t ]
check "logjam_app connects over TLS with the secret's password, verifying the name" app_connects
sans=$(r openssl x509 -in /data/postgres/server.crt -noout -ext subjectAltName)
for name in brain.e2e.test postgres localhost; do check "the certificate names $name" grep -q "DNS:$name" <<<"$sans"; done
check "no API container" [ -z "$(cid api)" ]
check "the boot mode is bootstrap" [ "$(cat /run/brain/boot-mode)" = bootstrap ]
check "the repository holds a backup" [ "$(fulls)" = 1 ]
check "the agent is not a superuser" [ "$(sql postgres "select rolsuper from pg_roles where rolname='brain_agent'")" = f ]
check "the agent has no password" [ "$(sql postgres "select rolpassword is null from pg_authid where rolname='brain_agent'")" = t ]
check "the agent updates the canary's row" as_agent postgres -c 'update brain.canary set at = now()'
check "the agent can run the backup functions" as_agent postgres -c "select pg_backup_start('e2e', true); select pg_backup_stop(true)"
check "the agent cannot delete the row" not as_agent postgres -c 'delete from brain.canary'
check "the agent cannot make a table in its schema" not as_agent postgres -c 'create table brain.x (a int)'
check "the agent cannot make a table in public" not as_agent postgres -c 'create table public.x (a int)'
check "the agent cannot read the roles' password hashes" not as_agent postgres -c 'select * from pg_authid'
check "the agent cannot connect to the application's database" not as_agent logjam -c 'select 1'
check "the agent cannot connect over TCP, with or without a password" not r docker exec -e PGPASSWORD=x "$(cid postgres)" psql "host=localhost user=brain_agent dbname=postgres sslmode=verify-full sslrootcert=/var/lib/postgresql/data/server.crt" -c 'select 1'
identity1=$(identity); sysid1=$(sql postgres "select system_identifier from pg_control_system()")
cert1=$(fingerprint); fulls1=$(fulls)

# --- 2. boot again ------------------------------------------------------------------------
S="2 boot again"
reboot
boot || fatal "boot.sh failed on a volume with a database"
check "boot and stanza-create connected as nobody but the agent" not superuser_connected
check "it starts on the existing data (mode existing)" [ "$(cat /run/brain/boot-mode)" = existing ]
check "Postgres got BRAIN_INIT=none although the tag is still 1" pg_has BRAIN_INIT=none
check "the same cluster (system identifier)" [ "$(sql postgres "select system_identifier from pg_control_system()")" = "$sysid1" ]
check "the same roles and databases, nothing new" [ "$(identity)" = "$identity1" ]
check "the same certificate" [ "$(fingerprint)" = "$cert1" ]
check "no extra full backup" [ "$(fulls)" = "$fulls1" ]
check "no API container with serving off" [ -z "$(cid api)" ]
# A container that restarted once under its policy is healthy: its restart count is not a crash loop.
r docker exec "$(cid postgres)" kill -QUIT 1 # an immediate shutdown: the container exits and its policy restarts it
check "Postgres restarts by itself" wait_for 60 pg_ready
check "...and the container's restart count is 1" [ "$(r docker inspect -f '{{.RestartCount}}' "$(cid postgres)")" = 1 ]
boot; rc=$?
check "boot.sh on that container, restart count 1, still succeeds (exit $rc)" [ "$rc" = 0 ]

# --- 9. status.json ---------------------------------------------------------------------------
S="9 status.json"
r /opt/brain/host/status.sh || bad "status.sh failed"
check "status.json has exactly the allowlisted keys" \
  [ "$(status_keys)" = "api_sha archive_failures boot_mode disk_used_percent last_archive_time last_full_time last_restore_at last_restore_lag_seconds mem_available_mb postgres_up schema serving time" ]
check "it carries the available memory as a whole number of MiB" [ "$(status_field mem_available_mb)" -gt 0 ]
check "it says Postgres is up" [ "$(status_field postgres_up)" = True ]
check "it carries the boot mode" [ "$(status_field boot_mode)" = existing ]
check "it carries the last full backup" [ "$(status_field last_full_time)" != None ]
check "serving reads off" [ "$(status_field serving)" = False ]
check "no restore yet" [ "$(status_field last_restore_at)" = None ]
check "the canary wrote through status.sh" [ "$(sql postgres "select count(*) from brain.canary where at > now() - interval '2 minutes'")" = 1 ]

# --- 4. migrate over TLS -------------------------------------------------------------------------
S="4 migrate over TLS"
migrate() { # <ca file>
  r docker run --rm --network brain_default -e DB_HOST=postgres -e DB_NAME=logjam -e DB_USER=logjam_app -e DB_PASSWORD="$APP_PW" \
    -e DATABASE_SSL_CA=/ca.pem -v "$1:/ca.pem:ro" "$API_IMAGE" npx prisma migrate deploy
}
migrated() { [ "$(sql logjam "select count(*) from information_schema.tables where table_name='_prisma_migrations'")" = 1 ]; }
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=postgres -addext subjectAltName=DNS:postgres \
  -keyout "$WORK/other.key" -out "$WORK/other.pem" 2> /dev/null
migrate "$WORK/other.pem" > "$WORK/migrate-wrong.log" 2>&1; rc=$?
check "migrate pinned to a different CA fails (got $rc)" [ "$rc" != 0 ]
check "nothing was migrated by it" not migrated
migrate /data/postgres/server.crt > "$WORK/migrate.log" 2>&1; rc=$?
check "migrate pinned to the brain's certificate succeeds (got $rc)" [ "$rc" = 0 ]
[ "$rc" = 0 ] || tail -15 "$WORK/migrate.log"
check "the schema is there" migrated

# --- 5. the serving switch ----------------------------------------------------------------------------
S="5 the serving switch"
point release-a
agent || bad "the agent failed with serving missing"
check "no switch file at all: no API container" [ -z "$(cid api)" ]
serving off; agent
check "serving off with a pointer present: no API container" [ -z "$(cid api)" ]
serving on; agent || { bad "the agent failed with serving on"; tail -5 "$WORK/agent.log"; }
check "serving on: the API runs at the pointer's release" [ "$(api_tag)" = "$API_REPO:release-a" ]
check "...and /ready answers 200 on port 80" wait_for 90 ready
r /opt/brain/host/status.sh || bad "status.sh failed"
check "status.json carries the live release" [ "$(status_field api_sha)" = release-a ]
check "the API publishes port 80 and nothing else" \
  [ "$(r docker inspect -f '{{json .HostConfig.PortBindings}}' "$(cid api)")" = '{"8080/tcp":[{"HostIp":"","HostPort":"80"}]}' ]
serving off; agent
check "serving back off: the container is gone after one run" [ -z "$(cid api)" ]
r /opt/brain/host/status.sh || bad "status.sh failed"
check "status.json has no release then" [ "$(status_field api_sha)" = None ]
# Anything but exactly on is off: other words, other case, an unreadable source.
for word in yes ON true 1 "on please" ""; do
  serving on; agent; serving "$word"; agent
  check "the switch reading '$word' is off" [ -z "$(cid api)" ]
done
serving on; agent; r rm -f /run/brain-e2e-serving; r mkdir /run/brain-e2e-serving; agent
check "an unreadable switch is off" [ -z "$(cid api)" ]
r rmdir /run/brain-e2e-serving
serving on; agent

# The metadata path prod uses: a tag read with an IMDSv2 token, against a stand-in.
cat > "$WORK/imds.py" <<'PY'
import http.server, os, sys
port, tag = int(sys.argv[1]), sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, body=b""):
        self.send_response(code); self.end_headers(); self.wfile.write(body)
    def do_PUT(self):
        ok = self.path == "/latest/api/token" and self.headers.get("X-aws-ec2-metadata-token-ttl-seconds")
        self.reply(200 if ok else 400, b"tok")
    def do_GET(self):
        if self.headers.get("X-aws-ec2-metadata-token") != "tok": return self.reply(401)
        name = self.path.rsplit("/", 1)[1]
        if self.path.startswith("/latest/meta-data/tags/instance/") and os.path.exists(f"{tag}.{name}"):
            return self.reply(200, open(f"{tag}.{name}", "rb").read())
        self.reply(404)
http.server.HTTPServer(("127.0.0.1", port), H).serve_forever()
PY
IMDS_PORT=${E2E_IMDS_PORT:-56012}
python3 "$WORK/imds.py" "$IMDS_PORT" "$WORK/tag" & IMDS_PID=$!
wait_for 20 curl -s "http://127.0.0.1:$IMDS_PORT/" || bad "the metadata stand-in does not start"
brain_env BRAIN_SERVING_FILE
brain_env BRAIN_BOOTSTRAP_FILE
brain_env BRAIN_IMDS_URL "http://127.0.0.1:$IMDS_PORT"
state() { r bash -c '. /opt/brain/host/lib.sh; serving_state'; }
tag() { printf '%s' "$2" > "$WORK/tag.$1"; }
can_bootstrap() { r bash -c '. /opt/brain/host/lib.sh; if bootstrap_allowed; then echo yes; else echo no; fi'; }
tag brain-serving on; check "the instance tag on reads on" [ "$(state)" = on ]
tag brain-serving off; check "the instance tag off reads off" [ "$(state)" = off ]
tag brain-serving yes; check "another tag value reads off" [ "$(state)" = off ]
rm -f "$WORK/tag.brain-serving"; check "no tag reads off" [ "$(state)" = off ]
tag brain-bootstrap 1; check "the bootstrap tag 1 allows a bootstrap" [ "$(can_bootstrap)" = yes ]
for v in 0 true "" 2; do tag brain-bootstrap "$v"; check "the bootstrap tag '$v' does not" [ "$(can_bootstrap)" = no ]; done
rm -f "$WORK/tag.brain-bootstrap"; check "no bootstrap tag does not" [ "$(can_bootstrap)" = no ]
tag brain-serving on; tag brain-bootstrap 1; brain_env BRAIN_IMDS_URL "http://127.0.0.1:1"
check "an unreachable metadata service reads off" [ "$(state)" = off ]
check "...and does not allow a bootstrap" [ "$(can_bootstrap)" = no ]
kill "$IMDS_PID"; IMDS_PID=
brain_env BRAIN_IMDS_URL
brain_env BRAIN_SERVING_FILE /run/brain-e2e-serving
brain_env BRAIN_BOOTSTRAP_FILE /run/brain-e2e-bootstrap
serving on; agent

# --- 6. a release cannot weaken the host ----------------------------------------------------------------------
S="6 the pinned runtime"
point release-a AUTH_MODE=fake NODE_ENV=development LOGJAM_RUNTIME=dev; agent
check "the pinned line is the last line of api.env" [ "$(r tail -1 /etc/brain/api.env)" = LOGJAM_RUNTIME=prod ]
check "the container's runtime is prod" api_has LOGJAM_RUNTIME=prod
wait_for 60 api_refused
check "the API refuses AUTH_MODE=fake" api_refused
check "and never answers /ready" not ready
before=$(r cat /etc/brain/api.env)
point release-a "BAD=a'b"; agent; rc=$?
check "a release with an unquotable value is refused (exit $rc)" [ "$rc" != 0 ]
check "...and changes nothing" [ "$(r cat /etc/brain/api.env)" = "$before" ]
point release-a 'BAD=a\b'; agent; rc=$?
check "so is one with a backslash (exit $rc)" [ "$rc" != 0 ]
check "...and changes nothing" [ "$(r cat /etc/brain/api.env)" = "$before" ]

# --- 7. releases and rollbacks -----------------------------------------------------------------------------------
S="7 releases and rollbacks"
point release-b CORS_ORIGIN=https://b.example; agent
check "a new pointer: the API is on release-b" [ "$(api_tag)" = "$API_REPO:release-b" ]
check "...with its environment" api_has CORS_ORIGIN=https://b.example
check "...and answers /ready" wait_for 90 ready
id=$(cid api); agent
check "the same pointer again changes nothing" [ "$(cid api)" = "$id" ]
point release-a; agent
check "the old pointer: back on release-a" [ "$(api_tag)" = "$API_REPO:release-a" ]
check "...with its environment" not api_has CORS_ORIGIN=https://b.example
check "...and answers /ready" wait_for 90 ready
id=$(cid api)
point release-missing; agent; rc=$?
check "a release whose image cannot be pulled fails (exit $rc)" [ "$rc" != 0 ]
check "...leaves no api.env behind, so the next run tries again" not r test -e /etc/brain/api.env
check "...and the running API is untouched" [ "$(cid api)" = "$id" ]
point release-a; agent
check "the next run applies the release again" [ "$(api_tag)" = "$API_REPO:release-a" ]
check "...and answers /ready" wait_for 90 ready

# --- 8. losing the disk ---------------------------------------------------------------------------------------------
S="8 losing the disk"
since=$(date -u +%Y-%m-%dT%H:%M:%S)
r /opt/brain/host/backup-full.sh > "$WORK/backup.log" 2>&1 || { bad "backup-full.sh failed"; tail "$WORK/backup.log"; }
for _ in 1 2 3; do r /opt/brain/host/status.sh || bad "status.sh failed"; done
check "a full backup and three canary runs connected as nobody but the agent" not superuser_connected --since "$since"
check "backup-full.sh adds a full backup" [ "$(fulls)" = "$((fulls1 + 1))" ]
sql logjam "create table e2e_rows as select g as n from generate_series(1, 1000) g" > /dev/null
want=$(sql logjam "select pg_walfile_name(pg_current_wal_lsn())")
sql postgres "select pg_switch_wal()" > /dev/null
check "the WAL with the rows is archived" wait_for 120 archived "$want"
fulls2=$(fulls)
# The bootstrap tag stays 1: a blank volume with a backup in the repository restores, whatever it says.
lose_disk
boot; rc=$?
[ "$rc" = 0 ] || fatal "boot.sh did not restore onto the blank volume (exit $rc)"
check "boot mode: restore, without being asked" [ "$(cat /run/brain/boot-mode)" = restore ]
check "the rows are there" [ "$(sql logjam 'select count(*) from e2e_rows')" = 1000 ]
check "the same certificate came back" [ "$(fingerprint)" = "$cert1" ]
check "a full backup was taken after the restore" [ "$(fulls)" = "$((fulls2 + 1))" ]
check "logjam_app still connects with the secret's password" app_connects
check "the agent works on the new volume" as_agent postgres -c 'update brain.canary set at = now()'
check "serving was on, so the API is back at the pointer's release" [ "$(api_tag)" = "$API_REPO:release-a" ]
check "...and answers /ready" wait_for 90 ready
r /opt/brain/host/status.sh || bad "status.sh failed after the restore"
check "status.json says restore" [ "$(status_field boot_mode)" = restore ]
check "...and when, and how stale the restored data was" restore_reported

# --- 8b. the canary's minute, after a recovery --------------------------------------------------------------------
# archive_timeout alone stalls for up to checkpoint_timeout after a restore or a crash
# recovery, so rows written then are lost with the disk unless status.sh closes the WAL
# segment itself. Each round: two minutes of one row a second, status.sh as its timer would
# run it (at 0, 60 and 120 s), then the disk is lost and restored.
S="8b the canary's minute"
sql logjam "create table e2e_stream (ts timestamptz)" > /dev/null
lost_seconds() { # two minutes of writes, the disk lost, restored; sets LOST to the seconds of rows that did not come back
  r docker exec -u postgres "$(cid postgres)" psql -U postgres -d logjam -qXc \
    "do \$\$ begin for i in 1..125 loop insert into e2e_stream values (clock_timestamp()); commit; perform pg_sleep(1); end loop; end \$\$" &
  local writer=$! i disaster newest
  for i in 1 2 3; do r /opt/brain/host/status.sh || bad "status.sh failed"; [ "$i" = 3 ] || sleep 60; done
  wait "$writer"
  disaster=$(date +%s)
  lose_disk
  boot || fatal "boot.sh did not restore the volume"
  newest=$(sql logjam 'select extract(epoch from max(ts))::bigint from e2e_stream')
  LOST=$((disaster - newest))
}
lost_seconds
check "after a restore, a second loss of the disk loses under 90 s of rows (lost $LOST s)" [ "$LOST" -lt 90 ]
r docker kill "$(cid postgres)" > /dev/null; r docker start "$(cid postgres)" > /dev/null 2>&1
check "Postgres is back on the same data after a kill" wait_for 120 bash -c "$SUDO docker exec $(cid postgres) pg_isready -q -h 127.0.0.1"
until [ "$(as_agent postgres -c 'select pg_is_in_recovery()')" = f ]; do sleep 1; done
lost_seconds
check "after a crash recovery, a loss of the disk loses under 90 s of rows (lost $LOST s)" [ "$LOST" -lt 90 ]

# --- 8c. a restore that did not finish -------------------------------------------------------------------------
# What an interrupted restore leaves: a marker on the volume and a half-filled data directory
# (here with a PG_VERSION, the worst case). boot.sh empties it and restores again.
S="8c an interrupted restore"
reboot; new_disk
r mkfs.ext4 -q -L brain-data "$LOOP"
r mount "$LOOP" "$WORK/m"
r mkdir -p "$WORK/m/postgres/base/1"
echo 16 | r tee "$WORK/m/postgres/PG_VERSION" "$WORK/m/postgres/base/1/partial" > /dev/null
r touch "$WORK/m/.setup-in-progress"
r umount "$WORK/m"
boot; rc=$?
check "boot.sh restores over the half-finished directory (exit $rc)" [ "$rc" = 0 ]
check "boot mode: restore" [ "$(cat /run/brain/boot-mode)" = restore ]
check "its leftovers are gone" not r test -e /data/postgres/base/1/partial
check "the marker is gone" [ ! -e /data/.setup-in-progress ]
check "the database is the restored one" [ "$(sql logjam 'select count(*) from e2e_rows')" = 1000 ]
r mkdir -p /data/postgres/junk
reboot
boot > /dev/null 2>&1; rc=$?
check "an existing database is not touched by a boot without the marker (exit $rc)" [ "$rc" = 0 ]
check "...and its extra files stay" r test -d /data/postgres/junk

# A restore that did finish copying (pg_control is written last) but whose boot died before the
# marker went: the database is complete, and a row written after the last archive push is only
# in its pg_wal. It must start as it is, not be emptied and restored from the archive.
S="8c a restore that finished copying"
sql logjam "create table e2e_keep as select 1 as n" > /dev/null
r docker kill "$(cid postgres)" > /dev/null
echo restore | r tee /data/.setup-in-progress > /dev/null
reboot
boot; rc=$?
check "boot.sh starts the finished copy (exit $rc)" [ "$rc" = 0 ]
check "the row written after the last archive push survived" [ "$(sql logjam 'select count(*) from e2e_keep')" = 1 ]
check "the marker is gone" [ ! -e /data/.setup-in-progress ]
check "boot mode: restore" [ "$(cat /run/brain/boot-mode)" = restore ]

# A restore whose server crash-loops: the next boot, once the cause is gone, finds the marker and
# the finished copy, and succeeds with a new container.
S="8d a crash-looping restore"
lose_disk
brain_env BRAIN_PG_FLAGS "-c no_such_setting=1"
boot; rc=$?
check "boot.sh stops on a server that will not start (exit $rc)" [ "$rc" != 0 ]
check "the marker stays" [ -e /data/.setup-in-progress ]
check "the boot mode is failed" [ "$(cat /run/brain/boot-mode)" = failed ]
brain_env BRAIN_PG_FLAGS "-c shared_buffers=64MB -c max_wal_size=256MB"
boot; rc=$?
check "the next boot, with the cause removed, succeeds (exit $rc)" [ "$rc" = 0 ]
check "the database is the restored one" [ "$(sql logjam 'select count(*) from e2e_rows')" = 1000 ]
check "the marker is gone" [ ! -e /data/.setup-in-progress ]

# --- 11. the restore drill -------------------------------------------------------------------------------------------
# infra/brain/postgres/drill.sh, as a scheduled task runs it: its own container, no route to the live Postgres,
# credentials from a task-role stand-in. Mutations (each applied once and seen red):
#   postgres/drill.sh: `--archive-mode=off` dropped from the restore: the guard refuses (exit non-zero);
#   postgres/drill.sh: that and the `[ "$mode" = off ]` guard: the repository listing differs;
#   postgres/drill.sh: one more key in the verdict;
#   postgres/drill.sh: not reading the task role's credentials;
#   postgres/drill.sh: dropping the `pg_ctl status` liveness check in the recovery wait (error timed_out, not start_failed);
#   postgres/drill.sh: `LAG=$((recovered - at))` -> `LAG=$((START - at))` (reads 0 when the canary is replayed).
S="11 the restore drill"
serving off; agent # the API's own connections would hide a drill that reached the live Postgres in its log
sql logjam "create table e2e_secret (v text); insert into e2e_secret values ('e2e-secret-value-7731')" > /dev/null
r /opt/brain/host/status.sh || bad "status.sh failed" # a fresh canary row
want=$(sql logjam "select pg_walfile_name(pg_current_wal_lsn())")
sql postgres "select pg_switch_wal()" > /dev/null
check "the WAL with the canary is archived" wait_for 120 archived "$want"
aws s3 mb "s3://e2e-empty" > /dev/null
cat > "$WORK/creds.conf" <<'EOF'
events {}
http { server { listen 80; location /creds {
  default_type application/json;
  return 200 '{"AccessKeyId":"test","SecretAccessKey":"test","Token":"e2e-token","Expiration":"2099-01-01T00:00:00Z"}'; } } }
EOF
r docker run -d --name brain-e2e-creds --network brain-e2e -v "$WORK/creds.conf:/etc/nginx/nginx.conf:ro" nginx:1.27-alpine > /dev/null || fatal "the task-role stand-in does not start"
drill() { # <backup bucket> [docker args]: on the test network only, where the live Postgres is not
  r docker run --rm --network brain-e2e --name brain-e2e-drill -e AWS_REGION=ap-southeast-2 -e BRAIN_BACKUP_BUCKET="$1" \
    -e BRAIN_SIGNALS_BUCKET="$SIGNALS" -e BRAIN_BACKUP_ENDPOINT=brain-e2e-tls:4443 -e BRAIN_BACKUP_VERIFY_TLS=n "${@:2}" \
    "$PG_IMAGE" /usr/local/lib/brain/drill.sh > "$WORK/drill.log" 2>&1
}
drill_json() { aws s3 cp "s3://$SIGNALS/drill.json" -; }
drill_field() { drill_json | python3 -c 'import json, sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }
repo_list() { aws s3 ls "s3://$BACKUPS" --recursive; } # keys, sizes and times
live_tables=$(sql logjam "select count(*) from pg_tables where schemaname = 'public'")
newest=$(r docker exec -u postgres "$(cid postgres)" pgbackrest --stanza=logjam info --output=json | python3 -c '
import json, sys
print([b["label"] for s in json.load(sys.stdin) for b in s["backup"]][-1])')
live_connections() { r docker logs "$(cid postgres)" 2>&1 | tail -n +$((log_lines + 1)) | grep -c 'connection authorized'; }
listing=$(repo_list); log_lines=$(r docker logs "$(cid postgres)" 2>&1 | wc -l)
drill "$BACKUPS" -e AWS_CONTAINER_CREDENTIALS_FULL_URI=http://brain-e2e-creds/creds; rc=$?
[ "$rc" = 0 ] || tail -20 "$WORK/drill.log"
check "the drill exits 0 (got $rc)" [ "$rc" = 0 ]
check "it read the task role's credentials from the stand-in" bash -c "$SUDO docker logs brain-e2e-creds 2>&1 | grep -q 'GET /creds'"
check "drill.json has exactly the allowlisted keys" \
  [ "$(drill_json | python3 -c 'import json, sys; print(*sorted(json.load(sys.stdin)))')" = "backup_label backup_stop_time canary_lag_seconds error ok restore_seconds schema tables_read time" ]
check "it says ok" [ "$(drill_field ok)" = True ]
check "...with no error" [ "$(drill_field error)" = None ]
check "it names the newest backup" [ "$(drill_field backup_label)" = "$newest" ]
# canary_lag_seconds: the canary's age when recovery ended, i.e. what losing the disk then would have cost.
# Healthy archiving: seconds here (status.sh ran just before), never 0, which is what measuring from the drill's start gives.
lag=$(drill_field canary_lag_seconds)
check "the canary was not 0 seconds old (lag $lag s)" [ "$lag" -ge 1 ]
check "...and seconds old, not minutes" [ "$lag" -lt 120 ]
check "it read every table in public ($live_tables)" [ "$(drill_field tables_read)" = "$live_tables" ]
check "the repository is byte for byte what it was (keys, sizes, times)" [ "$(repo_list)" = "$listing" ]
check "the live Postgres saw no connection while the drill ran" [ "$(live_connections)" = 0 ]
sql postgres "select 1" > /dev/null
check "...and that check does see a connection when there is one" [ "$(live_connections)" = 1 ]
check "the output has no value from the database" not grep -q 'e2e-secret-value-7731' "$WORK/drill.log"
check "the output carries no credential" not grep -q 'e2e-token' "$WORK/drill.log"
if command -v shellcheck > /dev/null; then
  check "the drill script passes shellcheck" bash -c 'cd infra/brain/postgres && shellcheck -x drill.sh'
elif [ -n "${CI:-}" ]; then bad "shellcheck is not installed"; fi

# A canary the live Postgres writes while the drill runs is replayed by its recovery and is then newer than the
# drill's start: the lag must still be measured at the end of recovery (from the start it would read 0).
drill "$BACKUPS" -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test &
drill_pid=$!
sleep 1; r /opt/brain/host/status.sh || bad "status.sh failed"
wait "$drill_pid"; rc=$?
check "a drill running while the canary is written exits 0 (got $rc)" [ "$rc" = 0 ]
check "...and its lag is not 0 (lag $(drill_field canary_lag_seconds) s)" [ "$(drill_field canary_lag_seconds)" -ge 1 ]

# A server that dies while recovering is a failed drill at once, not a timeout an hour later: a stand-in
# psql kills the postmaster when the drill first asks whether recovery has ended.
cat > "$WORK/psql-stub" <<'EOF'
#!/bin/sh
case "$*" in *pg_is_in_recovery*) kill -9 "$(head -1 /var/lib/postgresql/drill/postmaster.pid)"; sleep 1; exit 1 ;; esac
exec /usr/bin/psql "$@"
EOF
chmod 755 "$WORK/psql-stub"
drill "$BACKUPS" -e BRAIN_DRILL_TIMEOUT=90 -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -v "$WORK/psql-stub:/usr/local/bin/psql:ro"; rc=$?
check "a server killed in recovery: the drill exits non-zero (got $rc)" [ "$rc" != 0 ]
check "...and says start_failed, not timed_out" [ "$(drill_field error)" = start_failed ]

# An empty repository is a failed drill, said in a fixed code.
drill e2e-empty -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test; rc=$?
check "an empty repository: the drill exits non-zero (got $rc)" [ "$rc" != 0 ]
check "...and drill.json says ok false" [ "$(drill_field ok)" = False ]
check "...with the fixed code for no backup" [ "$(drill_field error)" = no_backup ]
check "...and nothing measured" [ "$(drill_field restore_seconds)/$(drill_field tables_read)" = None/None ]

# --- 12. the cutover's data copy ---------------------------------------------------------------------------------------
# infra/brain/postgres/copy.sh, as the one-off task runs it: its own container, the brain by its name through the
# published port with its certificate pinned, the source a second container of this image in dev mode (TLS, pgaudit,
# the real schema from `prisma migrate deploy`) standing in for RDS. Mutations (each applied once and seen red):
#   postgres/copy.sh: the body of brain_is_dormant replaced by `return 0` (serving, stale, unreadable);
#   postgres/copy.sh: the second `brain_is_dormant` call, after the dump, removed;
#   postgres/copy.sh: `unset BRAIN_BACKUP_VERIFY_TLS` removed (status.json read without verifying the bucket's certificate);
#   postgres/copy.sh: the `held` refusal removed (a second run without COPY_REPLACE);
#   postgres/copy.sh: PGSSLMODE=verify-full -> prefer (either CA wrong), and -> verify-ca (a target under another name);
#     (`require` is no mutation: with a root certificate given, libpq verifies the chain anyway);
#   postgres/copy.sh: `--single-transaction` removed from pg_restore (a restore that fails half way);
#   postgres/copy.sh: `--no-owner` removed from pg_restore (the table owned by another role);
#   postgres/copy.sh: the schema entry not filtered out of the restore list;
#   postgres/copy.sh: `--clean --if-exists` removed (a row deleted on the source);
#   postgres/copy.sh: `[ "$readonly_source" = on ]` -> `false` in differ (a count mismatch from a read-only source);
#   postgres/copy.sh: the same condition -> `true` (a count mismatch from a live source is only a warning);
#   postgres/copy.sh: pg_restore's stderr printed whole (a message that quotes a value);
#   postgres/copy.sh: the `show default_transaction_read_only` check inverted.
S="12 the data copy"
SRC=brain-e2e-src
r docker run -d --name "$SRC" --network brain-e2e -e BRAIN_DEV=1 -e BRAIN_INIT=bootstrap -e POSTGRES_PASSWORD=e2e-src-superuser \
  -e POSTGRES_DB=logjam -e BRAIN_TLS_SANS="$SRC" "$PG_IMAGE" postgres -c archive_mode=off > /dev/null || fatal "the stand-in source does not start"
src_up() { r docker exec "$SRC" pg_isready -q -h 127.0.0.1; }
wait_for 90 src_up || fatal "the stand-in source does not answer"
src_sql() { r docker exec -i -e PGOPTIONS='-c default_transaction_read_only=off' "$SRC" psql -U postgres -d logjam -v ON_ERROR_STOP=1 -tAXq "$@"; }
r docker exec -i "$SRC" psql -U postgres -d logjam -v app_password="$APP_PW" -q -f - < scripts/bootstrap-app-db-role.sql > /dev/null || fatal "no app role on the source"
r docker cp "$SRC:/var/lib/postgresql/data/server.crt" "$WORK/src.crt" && r chmod 644 "$WORK/src.crt"
r docker run --rm --network brain-e2e -e DB_HOST="$SRC" -e DB_NAME=logjam -e DB_USER=logjam_app -e DB_PASSWORD="$APP_PW" \
  -e DATABASE_SSL_CA=/ca.pem -v "$WORK/src.crt:/ca.pem:ro" "$API_IMAGE" npx prisma migrate deploy > "$WORK/src-migrate.log" 2>&1 \
  || { tail -15 "$WORK/src-migrate.log"; fatal "the source's schema does not migrate"; }
# Made-up rows in several tables, a sequence advanced, and a table owned by another role, as old tables on RDS may be.
src_sql <<'SQL' || fatal "the source does not take its rows"
insert into users (id, username, email, subject) values
  ('u1', 'alice-copy', 'alice-copy@example.test', 'sub-1'), ('u2', 'bob-copy', 'bob-copy@example.test', 'sub-2');
insert into announcements (id, title, body) values
  ('a1', 'Made up title', 'made-up body copy-secret-7731'), ('a2', 'Another one', 'second made-up body');
insert into sync_tombstones (user_id, entity_type, entity_id) values ('u1', 'place', 'p1'), ('u1', 'place', 'p2'), ('u2', 'place', 'p3');
select setval('sync_tombstones_id_seq', 500);
create role legacy_owner nologin;
create table public.legacy_things (id serial primary key, note text);
insert into public.legacy_things (note) values ('legacy copy-secret-7731');
alter table public.legacy_things owner to legacy_owner;
alter sequence public.legacy_things_id_seq owner to legacy_owner;
grant all on public.legacy_things, public.legacy_things_id_seq to logjam_app;
SQL
VALUE=copy-secret-7731
QUOTED=e2e-quoted-4471
# A certificate that no side has ever heard of, valid for every name used here: only trust can fail.
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=other -addext subjectAltName=DNS:brain.e2e.test,DNS:$SRC \
  -keyout "$WORK/copy-other.key" -out "$WORK/copy-other.pem" 2> /dev/null

# The brain's public schema, emptied: what a freshly bootstrapped brain holds.
sql logjam "do \$\$ declare t text; begin for t in select tablename from pg_tables where schemaname = 'public' loop
  execute format('drop table public.%I cascade', t); end loop; end \$\$" > /dev/null || fatal "the brain's public schema does not empty"

fresh() { r /opt/brain/host/status.sh || bad "status.sh failed"; } # a status.json that says serving false, just now
signal() { # <serving true|false> <age in seconds>
  printf '{"schema":1,"time":"%s","serving":%s}' "$(date -u -d "-$2 seconds" +%Y-%m-%dT%H:%M:%SZ)" "$1" | aws s3 cp - "s3://$SIGNALS/status.json" --only-show-errors
}
copy_raw() { # [docker args]: the task, on the test network; the brain at its own name through the host's published port
  r docker run --rm --network brain-e2e --name brain-e2e-copy \
    --add-host brain.e2e.test:host-gateway --add-host host.docker.internal:host-gateway \
    -e COPY_SOURCE_HOST="$SRC" -e COPY_TARGET_HOST=brain.e2e.test -e COPY_TARGET_CA="$(r cat /data/postgres/server.crt)" \
    -e COPY_SOURCE_CA_FILE=/source-ca.pem -v "$WORK/src.crt:/source-ca.pem:ro" \
    -e DB_USER=logjam_app -e DB_PASSWORD="$APP_PW" -e BRAIN_SIGNALS_BUCKET="$SIGNALS" -e AWS_REGION=ap-southeast-2 \
    -e BRAIN_BACKUP_ENDPOINT=host.docker.internal:"$TLS_PORT" -e CURL_CA_BUNDLE=/tls.crt -v "$WORK/tls.crt:/tls.crt:ro" \
    -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test "$@" "$PG_IMAGE" /usr/local/lib/brain/copy.sh > "$WORK/copy.log" 2>&1
  local rc=$?
  cat "$WORK/copy.log" >> "$WORK/copy-all.log"
  return "$rc"
}
copy() { fresh; copy_raw "$@"; }
# What a run must leave alone when it refuses or fails: the objects (identity and file) and the rows.
brain_state() {
  sql logjam "select md5(string_agg(c.relname || c.oid || c.relfilenode, ',' order by c.relname)) from pg_class c where c.relnamespace = 'public'::regnamespace"
  sql logjam "select count(*) from users" 2> /dev/null; sql logjam "select count(*) from announcements" 2> /dev/null
}
refuses() { # <what>: the last run exited non-zero, said why, copied nothing and left the brain as it was
  check "$1: exits non-zero (got $rc)" [ "$rc" != 0 ]
  check "$1: the brain is exactly as it was" [ "$(brain_state)" = "$state0" ]
  check "$1: stopped before the dump" not grep -q 'dumped' "$WORK/copy.log"
}

# The first copy: an empty brain.
copy; rc=$?
[ "$rc" = 0 ] || tail -20 "$WORK/copy.log"
check "an empty brain: the copy exits 0 (got $rc)" [ "$rc" = 0 ]
check "...and says every check held" grep -q 'ok: every check held' "$WORK/copy.log"
for t in users announcements sync_tombstones legacy_things; do
  check "...$t has the source's rows" [ "$(sql logjam "select count(*) from $t")" = "$(src_sql -c "select count(*) from $t")" ]
done
check "...a value arrived intact" [ "$(sql logjam "select body from announcements where id = 'a1'")" = "made-up body $VALUE" ]
check "...the table another role owned is owned by logjam_app" [ "$(sql logjam "select tableowner from pg_tables where tablename = 'legacy_things'")" = logjam_app ]
check "...every relation in public is owned by logjam_app" [ "$(sql logjam "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relowner <> 'logjam_app'::regrole")" = 0 ]
check "...the advanced sequence carries on from the source's value" [ "$(sql logjam "select last_value from pg_sequences where sequencename = 'sync_tombstones_id_seq'")" = 500 ]
check "...the brain is not read-only" [ "$(sql logjam "show default_transaction_read_only")" = off ]
check "...it lists the tables with their counts" grep -q '^  users 2$' "$WORK/copy.log"
check "...and the last migration matches" [ "$(sql logjam "select migration_name from _prisma_migrations order by migration_name desc limit 1")" = "$(src_sql -c "select migration_name from _prisma_migrations order by migration_name desc limit 1")" ]
as_app() { # the next `prisma migrate deploy` runs as this role and needs to own what it changes
  r docker exec -e PGPASSWORD="$APP_PW" "$(cid postgres)" psql "host=localhost user=logjam_app dbname=logjam sslmode=verify-full sslrootcert=/var/lib/postgresql/data/server.crt" -tAXqc "$1"
}
check "...and logjam_app can alter the table another role owned on the source" as_app "alter table legacy_things add column probe int; alter table legacy_things drop column probe"
if command -v shellcheck > /dev/null; then
  check "the copy script and its library pass shellcheck" bash -c 'cd infra/brain/postgres && shellcheck -x copy.sh task-lib.sh'
elif [ -n "${CI:-}" ]; then bad "shellcheck is not installed"; fi

# The brain now holds tables: a second run without COPY_REPLACE refuses, whatever else is true.
state0=$(brain_state)
copy; rc=$?
check "a second run says the brain already holds tables" grep -q 'already holds' "$WORK/copy.log"
refuses "a second run without COPY_REPLACE"

# With COPY_REPLACE, the target becomes the source: a row deleted there is gone here.
src_sql -c "delete from announcements where id = 'a2'"
copy -e COPY_REPLACE=1; rc=$?
check "with COPY_REPLACE the copy exits 0 (got $rc)" [ "$rc" = 0 ]
check "...and the row deleted on the source is gone" [ "$(sql logjam "select count(*) from announcements")" = 1 ]
state0=$(brain_state)

# A serving brain is never copied into, and a status.json that cannot be trusted is no different.
signal true 0
copy_raw -e COPY_REPLACE=1; rc=$?
check "serving true: the copy says so" grep -q 'does not say serving is false' "$WORK/copy.log"
refuses "serving true"
signal false 600
copy_raw -e COPY_REPLACE=1; rc=$?
check "a status.json ten minutes old: the copy says it is stale" grep -q 'stale' "$WORK/copy.log"
refuses "a stale status.json"
aws s3 rm "s3://$SIGNALS/status.json" --only-show-errors
copy_raw -e COPY_REPLACE=1; rc=$?
check "no status.json: the copy says it cannot read it" grep -q 'cannot be read' "$WORK/copy.log"
refuses "no status.json"
fresh
# The bucket's certificate is checked, and no setting turns that off.
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=host.docker.internal -addext subjectAltName=DNS:host.docker.internal \
  -keyout "$WORK/other-tls.key" -out "$WORK/other-tls.crt" 2> /dev/null
copy_raw -e COPY_REPLACE=1 -e BRAIN_BACKUP_VERIFY_TLS=n -e CURL_CA_BUNDLE=/other.pem -v "$WORK/other-tls.crt:/other.pem:ro"; rc=$?
check "a bucket certificate that is not trusted, with verification switched off: the copy cannot read status.json" grep -q 'cannot be read' "$WORK/copy.log"
refuses "an untrusted bucket certificate"
copy_raw -e COPY_REPLACE=1 -e COPY_TARGET_CA=; rc=$?
check "no CA for the brain: the copy says so" grep -q 'no CA for the brain' "$WORK/copy.log"
refuses "no CA for the brain"

# Both ends are verified against the CA they were given.
copy -e COPY_REPLACE=1 -e COPY_SOURCE_CA_FILE=/other.pem -v "$WORK/copy-other.pem:/other.pem:ro"; rc=$?
check "a wrong source CA: the copy says it cannot connect to the source" grep -q 'cannot connect to the source' "$WORK/copy.log"
refuses "a wrong source CA"
copy -e COPY_REPLACE=1 -e "COPY_TARGET_CA=$(cat "$WORK/copy-other.pem")"; rc=$?
check "a wrong target CA: the copy says it cannot connect to the brain" grep -q 'cannot connect to the brain' "$WORK/copy.log"
refuses "a wrong target CA"
# The certificate must also name the host that was dialled: the brain's certificate is valid, the address is another's.
copy -e COPY_REPLACE=1 -e COPY_TARGET_HOST=elsewhere.e2e.test --add-host elsewhere.e2e.test:host-gateway; rc=$?
check "a target whose name the certificate does not carry: the copy says it cannot connect to the brain" grep -q 'cannot connect to the brain' "$WORK/copy.log"
refuses "a target under another name"

# A brain that starts serving while the dump runs: a stand-in pg_dump writes that to status.json when it ends.
cat > "$WORK/stub-dump" <<'EOF'
#!/bin/sh
/usr/bin/pg_dump "$@"; rc=$?
sh -c "${AFTER_DUMP:-true}"
exit $rc
EOF
chmod 755 "$WORK/stub-dump"
stub=(-v "$WORK/stub-dump:/usr/local/bin/pg_dump:ro")
src_write() { echo "PGPASSWORD=\$DB_PASSWORD PGOPTIONS='-c default_transaction_read_only=off' psql 'host=$SRC dbname=logjam user=logjam_app sslmode=verify-full sslrootcert=/source-ca.pem' -qc \"$1\""; }
# shellcheck disable=SC2016 # runs inside the task
flip='printf "{\"schema\":1,\"time\":\"%s\",\"serving\":true}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /tmp/s.json; curl -fsSk -T /tmp/s.json https://host.docker.internal:'"$TLS_PORT/$SIGNALS"'/status.json'
copy -e COPY_REPLACE=1 "${stub[@]}" -e AFTER_DUMP="$flip"; rc=$?
check "serving true after the dump: the copy says so" grep -q 'does not say serving is false' "$WORK/copy.log"
check "...it had dumped, and did not restore" bash -c "grep -q dumped '$WORK/copy.log' && ! grep -q restored '$WORK/copy.log'"
check "...exits non-zero (got $rc)" [ "$rc" != 0 ]
check "...and the brain is exactly as it was" [ "$(brain_state)" = "$state0" ]

# A restore that fails half way leaves nothing behind. A view that depends on a table stops the restore's DROP;
# its name stands in for a server message that quotes a value.
sql logjam "create view public.\"view-$QUOTED\" as select id from public.users" > /dev/null
state0=$(brain_state)
copy -e COPY_REPLACE=1; rc=$?
check "a restore that fails half way: the copy exits non-zero (got $rc)" [ "$rc" != 0 ]
check "...says it was rolled back" grep -q 'rolled back' "$WORK/copy.log"
check "...and the brain is exactly as it was" [ "$(brain_state)" = "$state0" ]
check "...and its output quotes nothing from the server's message" not grep -q "$QUOTED" "$WORK/copy.log"
sql logjam "drop view public.\"view-$QUOTED\"" > /dev/null
state0=$(brain_state)

# A read-only source, as in the window: its setting does not travel, and its counts must match exactly.
src_sql -c "alter database logjam set default_transaction_read_only = on"
copy -e COPY_REPLACE=1; rc=$?
check "a read-only source: the copy exits 0 (got $rc)" [ "$rc" = 0 ]
check "...and says the source is read-only" grep -q 'source default_transaction_read_only = on' "$WORK/copy.log"
check "...and the brain is not read-only" [ "$(sql logjam "show default_transaction_read_only")" = off ]
state0=$(brain_state)
copy -e COPY_REPLACE=1 "${stub[@]}" -e AFTER_DUMP="$(src_write "delete from announcements where id = 'a1'")"; rc=$?
check "a read-only source that changed after the dump: the copy exits non-zero (got $rc)" [ "$rc" != 0 ]
check "...names the counts that differ" grep -q 'announcements: source 0, brain 1' "$WORK/copy.log"
check "...and says not to serve from the copy" grep -q 'do not serve' "$WORK/copy.log"
# A live source keeps writing: the same difference is only a warning.
src_sql -c "alter database logjam reset default_transaction_read_only" -c "insert into announcements (id, title, body) values ('a3', 'Third', 'third made-up body')"
copy -e COPY_REPLACE=1 "${stub[@]}" -e AFTER_DUMP="$(src_write "delete from announcements where id = 'a3'")"; rc=$?
check "a live source that changed after the dump: the copy exits 0 (got $rc)" [ "$rc" = 0 ]
check "...with a warning" grep -q 'warning: row counts differ' "$WORK/copy.log"

# Nothing a run printed holds a value, a row or the password; the brain's audit log records the restore as
# statements, never rows.
check "no run printed a value from the database" not grep -q "$VALUE" "$WORK/copy-all.log"
check "...or the password" not grep -q "$APP_PW" "$WORK/copy-all.log"
check "the brain's audit log has the restore's COPY statements" bash -c "$SUDO docker logs '$(cid postgres)' 2>&1 | grep -q 'AUDIT: SESSION,.*,WRITE,COPY,,,\"COPY public.announcements'"
check "...and no value in any line" bash -c "! $SUDO docker logs '$(cid postgres)' 2>&1 | grep -q '$VALUE'"


# --- 13. restore to a point in time -----------------------------------------------------------------------------------------
# The same boot as losing the disk, with BRAIN_RESTORE_TARGET (Terraform: the current volume's restore_to) set to a time.
# Mutations (each applied once and seen red):
#   compose.yaml: BRAIN_RESTORE_TARGET not passed to the Postgres container (B is there: the latest state came back);
#   host/boot.sh: the target applied to any boot (`[ "$mode" = restore ] && [ -z "$resume" ] &&` dropped from its condition): the
#     existing-database boots log a restore and refuse a malformed value;
#   postgres/brain-entrypoint.sh: `--target-action=promote` dropped (recovery pauses at the target, the database never opens
#     for writes and boot.sh waits for ever: boot_limited ends at 300 s with exit 124).
S="13 point in time"
serving off; agent
pitr_rows() { sql logjam "select coalesce(string_agg(v, ',' order by v), '') from e2e_pitr"; }
force_wal() { # sets WAL to the segment that holds everything written so far, once it is in the repository
  WAL=$(sql logjam "select pg_walfile_name(pg_current_wal_lsn())")
  sql postgres "select pg_switch_wal()" > /dev/null
  wait_for 120 archived "$WAL"
}
newest_full_stop() { r docker exec -u postgres "$(cid postgres)" pgbackrest --stanza=logjam info --output=json | python3 -c '
import json, sys
print(max(b["timestamp"]["stop"] for s in json.load(sys.stdin) for b in s["backup"] if b["type"] == "full"))'; }
timeline() { sql postgres "select timeline_id from pg_control_checkpoint()"; }
in_repo() { local keys; keys=$(aws s3 ls "s3://$BACKUPS" --recursive) && grep -q "$1" <<< "$keys"; }
sql logjam "create table e2e_pitr (v text); insert into e2e_pitr values ('A')" > /dev/null
force_wal
r /opt/brain/host/status.sh || bad "status.sh failed" # a canary just before T, so the restore's staleness reads in seconds
T=$(sql logjam "select to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') || 'Z'")
sleep 2
sql logjam "insert into e2e_pitr values ('B')" > /dev/null
force_wal
tl0=$(timeline)

brain_env BRAIN_RESTORE_TARGET "$T"
started=$(date +%s)
lose_disk
boot_limited; rc=$?
check "a blank disk with a target restores (exit $rc)" [ "$rc" = 0 ]
[ "$rc" = 0 ] || { tail -20 "$WORK/boot.log"; fatal "boot.sh did not restore to $T"; }
check "boot mode: restore" [ "$(cat /run/brain/boot-mode)" = restore ]
check "boot.sh says it is restoring to the target" grep -q "restoring to $T" "$WORK/boot.log"
check "A is there and B is not" [ "$(pitr_rows)" = A ]
check "the database is out of recovery" [ "$(sql postgres 'select pg_is_in_recovery()')" = f ]
check "...and takes a write" sql logjam "insert into e2e_pitr values ('C')"
check "...on a new timeline ($(timeline), was $tl0)" [ "$(timeline)" -gt "$tl0" ]
force_wal
check "a WAL object of the new timeline reaches the repository" in_repo "$WAL"
check "...named for it" [ "${WAL:0:8}" = "$(printf '%08X' "$(timeline)")" ]
check "a full backup was taken after the restore started" [ "$(newest_full_stop)" -ge "$started" ]
r /opt/brain/host/status.sh || bad "status.sh failed after the rewind"
check "status.json still says restore, and when" restore_reported
check "...and measures staleness from the target, not from now" [ "$(status_field last_restore_lag_seconds)" -lt 30 ]
check "last-restore records the target next to the lag" [ "$(r cut -d' ' -f3 /data/brain/last-restore)" = "$T" ]
check "...with no key added to status.json" [ "$(status_keys | wc -w)" = 13 ]

# The next loss of the disk, with no target (the next volume's entry has none): the latest state, on the new timeline.
brain_env BRAIN_RESTORE_TARGET
lose_disk
boot_limited; rc=$?
check "a blank disk with no target restores (exit $rc)" [ "$rc" = 0 ]
check "A and C are there, B is not" [ "$(pitr_rows)" = A,C ]
check "boot.sh does not mention a target" not grep -q "restoring to" "$WORK/boot.log"

# A disk that already holds a database: the target is ignored in silence, even a malformed one.
for value in 2026-01-01T00:00:00+11:00 "not a time"; do
  brain_env BRAIN_RESTORE_TARGET "$value"
  reboot
  boot; rc=$?
  check "an existing database starts with the target '$value' (exit $rc)" [ "$rc" = 0 ]
  check "...boot mode existing" [ "$(cat /run/brain/boot-mode)" = existing ]
  check "...unchanged" [ "$(pitr_rows)" = A,C ]
  check "...with nothing logged about a target" not grep -q "restoring to\|BRAIN_RESTORE_TARGET" "$WORK/boot.log"
  check "...and no target in the container" pg_has BRAIN_RESTORE_TARGET=
done

# A target that is not an RFC 3339 time with an offset never reaches a command line.
# shellcheck disable=SC2016 # the last value is meant to stay literal
for value in 2026-11-20T03:15:00 "2026-11-20 03:15:00+11:00" "2026-11-20T03:15:00Z;touch /tmp/e2e-injected" 'x$(id)'; do
  brain_env BRAIN_RESTORE_TARGET "$value"
  reboot; new_disk
  boot; rc=$?
  check "a blank disk with the target '$value' is refused (exit $rc)" [ "$rc" != 0 ]
  check "...boot mode failed" [ "$(cat /run/brain/boot-mode)" = failed ]
  check "...naming the format" grep -q "like 2026-11-20T03:15:00+11:00" "$WORK/boot.log"
  check "...with no data directory and no container" bash -c "[ ! -e /data/postgres ] && [ -z \"\$($SUDO docker ps -aq --filter label=com.docker.compose.project=brain)\" ]"
done
check "...and nothing in the target ran" [ ! -e /tmp/e2e-injected ]

# A target the archive cannot reach ends the boot as failed, with no database serving and no API.
serving on
brain_env BRAIN_RESTORE_TARGET "$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)"
reboot; new_disk
boot_limited; rc=$?
check "a target after the last archived WAL fails the boot (exit $rc)" [ "$rc" != 0 ]
check "...and does not wait for ever" [ "$rc" != 124 ]
check "...boot mode failed" [ "$(cat /run/brain/boot-mode)" = failed ]
check "...no API container" [ -z "$(cid api)" ]
check "...Postgres stopped at the end of the archive" bash -c "$SUDO docker logs '$(cid postgres)' 2>&1 | grep -q 'recovery ended before configured recovery target was reached'"
check "...and never opened for writes" bash -c "! $SUDO docker logs '$(cid postgres)' 2>&1 | grep -q 'selected new timeline'"
brain_env BRAIN_RESTORE_TARGET 2000-01-01T00:00:00Z
reboot; new_disk
boot_limited; rc=$?
check "a target before the oldest backup fails the boot (exit $rc)" [ "$rc" != 0 ]
check "...and does not wait for ever" [ "$rc" != 124 ]
check "...boot mode failed" [ "$(cat /run/brain/boot-mode)" = failed ]
check "...no API container" [ -z "$(cid api)" ]
check "...pgBackRest found no backup to start from" bash -c "$SUDO docker logs '$(cid postgres)' 2>&1 | grep -q 'unable to find backup set'"
serving off
brain_env BRAIN_RESTORE_TARGET
reboot

[ "$fails" = 0 ] || dump
exit "$fails"
