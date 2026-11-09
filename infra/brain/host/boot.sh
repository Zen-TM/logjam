#!/usr/bin/env bash
# The only thing that starts Postgres. Mounts the data volume (formatting it
# only if it is completely blank), then decides what the data directory needs:
#   has a database    -> start it
#   has none          -> restore if the backup repository holds a backup,
#                        else bootstrap if BRAIN_BOOTSTRAP is exactly 1,
#                        else refuse.
# Never deletes anything, never formats a device that has any signature.
# Guard: tests/e2e.sh.
. "$(dirname "$0")/lib.sh"

mkdir -p /run/brain
mode_file=/run/brain/boot-mode
echo failed > "$mode_file"

dev=$BRAIN_DATA_DEVICE
for _ in $(seq 120); do [ -b "$dev" ] && break; sleep 2; done
[ -b "$dev" ] || die "the data volume $dev did not appear"
dev=$(readlink -f "$dev")

if mountpoint -q /data; then
  [ "$(findmnt -n -o SOURCE /data)" = "$dev" ] || die "/data is mounted from something other than $dev"
else
  rc=0; blkid -p "$dev" > /dev/null || rc=$?
  case $rc in
    0) ;; # a filesystem or some other signature: only ever mounted, below
    2) # blkid sees nothing: still format only if the first MiB is zeros and wipefs sees nothing either
      if [ -n "$(head -c 1048576 "$dev" | tr -d '\0' | head -c 1)" ] || [ -n "$(wipefs -n "$dev")" ]; then
        die "$dev looks blank to blkid but is not: not formatting it"
      fi
      log "$dev is blank: formatting"
      mkfs.ext4 -q -L brain-data "$dev" ;;
    *) die "cannot tell whether $dev is blank (blkid exit $rc): not touching it" ;;
  esac
  [ "$(blkid -p -o value -s TYPE "$dev")" = ext4 ] || die "$dev is not an ext4 filesystem: not mounting it"
  mkdir -p /data
  mount -o noatime "$dev" /data
fi
mkdir -p /data/brain

repo_has_backup() {
  local out
  out=$(compose --profile tools run --rm --no-deps -T repo 2>&1) || { echo "$out" >&2; die "cannot read the backup repository"; }
  grep -q '"backup":\[{' <<<"$out"
}

if [ -s /data/postgres/PG_VERSION ]; then
  mode=existing
elif repo_has_backup; then
  mode=restore
elif [ "${BRAIN_BOOTSTRAP:-}" = 1 ]; then
  mode=bootstrap
else
  echo refused > "$mode_file"
  die "no database in /data/postgres, no backup in the repository and BRAIN_BOOTSTRAP is '${BRAIN_BOOTSTRAP:-}': refusing to create one"
fi
log "boot mode: $mode"

case $mode in
  existing) export BRAIN_INIT=none ;;
  *) export BRAIN_INIT=$mode; mkdir -p /data/postgres ;;
esac
echo "$mode" > "$mode_file"
compose up -d postgres

# The throwaway server a bootstrap runs has no TCP listener, so this waits for the real one.
# A restore replays WAL first, so allow it time and also wait for it to finish recovering.
for i in $(seq 3600); do
  docker exec "$(pg_cid)" pg_isready -q -h 127.0.0.1 && break
  [ "$(docker inspect -f '{{.State.Running}}' "$(pg_cid)")" = true ] || { compose logs --tail 20 postgres >&2; die "postgres stopped"; }
  [ "$i" != 3600 ] || die "postgres did not come up"
  sleep 2
done
until [ "$(psql_super -d postgres -tAc 'select pg_is_in_recovery()')" = f ]; do sleep 2; done

if [ "$mode" != existing ]; then
  # Printing the password is only ever to the pipe of the psql that sets it.
  APP_PW=$(aws secretsmanager get-secret-value --secret-id "${BRAIN_APP_DB_SECRET_ID:?}" --query SecretString --output text |
    python3 -c 'import json,sys; s=json.load(sys.stdin); assert s["username"]=="logjam_app"; print(s["password"])') \
    || die "cannot read the logjam_app secret"
  export APP_PW
  # shellcheck disable=SC2016 # psql, not the shell, runs the backticks
  { printf '%s\n' '\set app_password `printenv APP_PW`'; cat /opt/brain/host/bootstrap-app-db-role.sql; } |
    docker exec -i -e APP_PW -u postgres "$(pg_cid)" psql -U postgres -d logjam -X -q -v ON_ERROR_STOP=1 > /dev/null
  unset APP_PW
fi
# The canary's password lives on the data volume, so a new volume needs a new one.
if [ "$mode" != existing ] || [ ! -s /data/brain/canary.pw ]; then
  umask 077
  openssl rand -hex 24 > /data/brain/canary.pw
  CANARY_PW=$(cat /data/brain/canary.pw) && export CANARY_PW
  # shellcheck disable=SC2016
  { printf '%s\n' '\set canary_password `printenv CANARY_PW`'; cat /opt/brain/host/canary.sql; } |
    docker exec -i -e CANARY_PW -u postgres "$(pg_cid)" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
  unset CANARY_PW
fi

pgb stanza-create
if [ "$mode" = restore ] || ! repo_has_backup; then pgb --type=full backup; fi

# The API is the release agent's: on only if the switch is on.
"$(dirname "$0")/release-agent.sh" || log "the release agent failed; its timer retries"
