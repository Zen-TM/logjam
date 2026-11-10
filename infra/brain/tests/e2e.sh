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
  r docker rm -f brain-e2e-ministack brain-e2e-tls > /dev/null 2>&1
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
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=host.docker.internal \
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

[ "$fails" = 0 ] || dump
exit "$fails"
