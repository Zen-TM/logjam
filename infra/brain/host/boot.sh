#!/usr/bin/env bash
# The only thing that starts Postgres. Mounts the data volume (formatting it
# only if it is completely blank), then decides what the data directory needs:
#   has a database    -> start it
#   has none          -> restore if the backup repository holds a backup,
#                        else bootstrap if the brain-bootstrap tag is exactly 1,
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

# An earlier restore did not finish. Its files are the only ones this script
# ever deletes: the marker is written below only after the directory was seen
# absent or empty, so everything in it now came from that restore.
marker=/data/.restore-in-progress
if [ -e "$marker" ]; then
  log "an earlier restore did not finish: emptying /data/postgres to restore again"
  [ ! -d /data/postgres ] || find /data/postgres -mindepth 1 -delete
  rm -f "$marker"
fi

repo_has_backup() {
  local out
  out=$(compose --profile tools run --rm --no-deps -T repo 2>&1) || { echo "$out" >&2; die "cannot read the backup repository"; }
  grep -q '"backup":\[{' <<<"$out"
}

if [ -s /data/postgres/PG_VERSION ]; then
  mode=existing
elif repo_has_backup; then
  mode=restore
elif bootstrap_allowed; then
  mode=bootstrap
else
  echo refused > "$mode_file"
  die "no database in /data/postgres, no backup in the repository and the brain-bootstrap tag is not 1: refusing to create one"
fi
log "boot mode: $mode"

case $mode in
  existing) export BRAIN_INIT=none ;;
  *) export BRAIN_INIT=$mode; mkdir -p /data/postgres ;;
esac
if [ "$mode" = restore ]; then
  [ -z "$(ls -A /data/postgres)" ] || die "/data/postgres has files but no database: not restoring over them"
  touch "$marker" && sync
fi
# A restore is the one long wait, and status.json says so while it runs.
if [ "$mode" = restore ]; then echo restoring > "$mode_file"; else echo "$mode" > "$mode_file"; fi
compose up -d postgres

# The throwaway server a bootstrap runs has no TCP listener, so this waits for the real one.
# A restore replays WAL first, so allow it 30 minutes.
for i in $(seq 900); do
  docker exec "$(pg_cid)" pg_isready -q -h 127.0.0.1 && break
  # Restart count: the restart policy would keep a crashing server looking alive.
  [ "$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$(pg_cid)")" = "true 0" ] || { compose logs --tail 20 postgres >&2; die "postgres stopped"; }
  [ "$i" != 900 ] || die "postgres did not come up in 30 minutes"
  sleep 2
done

# The agent's identity map (the image's pg_hba.conf names it). A restored directory has it already.
if ! grep -qs '^agent ' /data/postgres/pg_ident.conf; then
  echo 'agent postgres brain_agent' >> /data/postgres/pg_ident.conf
  psql_super -d postgres -c 'select pg_reload_conf()' > /dev/null
fi

if [ "$mode" != bootstrap ]; then
  until [ "$(psql_agent -c 'select pg_is_in_recovery()')" = f ]; do sleep 2; done
fi
if [ "$mode" = restore ]; then
  # How stale the restored data is, read before anything writes the canary: a
  # long archiving stall makes pgBackRest drop WAL, and a restore then stops at
  # the gap with every other check green.
  { date -u +%Y-%m-%dT%H:%M:%SZ; psql_agent -c 'select extract(epoch from now() - at)::bigint from brain.canary'; } \
    | paste -sd' ' > /data/brain/last-restore
  echo restore > "$mode_file"
  rm -f "$marker"
fi

if [ "$mode" != existing ]; then
  # The password only ever travels in the environment of the docker client and the pipe of the psql that sets it.
  APP_PW=$(aws secretsmanager get-secret-value --secret-id "${BRAIN_APP_DB_SECRET_ID:?}" --query SecretString --output text |
    python3 -c 'import json,sys; s=json.load(sys.stdin); assert s["username"]=="logjam_app"; print(s["password"])') \
    || die "cannot read the logjam_app secret"
  export APP_PW
  # shellcheck disable=SC2016 # psql, not the shell, runs the backticks
  { printf '%s\n' '\set app_password `printenv APP_PW`'; cat /opt/brain/host/bootstrap-app-db-role.sql; } |
    docker exec -i -e APP_PW -u postgres "$(pg_cid)" psql -U postgres -d logjam -X -q -v ON_ERROR_STOP=1 > /dev/null
  unset APP_PW
  psql_super -d postgres -f - < /opt/brain/host/agent.sql
fi

pgb stanza-create
if [ "$mode" = restore ] || ! repo_has_backup; then pgb --type=full backup; fi

# The API is the release agent's: on only if the switch is on.
"$(dirname "$0")/release-agent.sh" || log "the release agent failed; its timer retries"
