#!/usr/bin/env bash
# The only thing that starts Postgres. Mounts the data volume (formatting it
# only if it is completely blank), then decides what the data directory needs:
#   has a database    -> start it
#   has none          -> restore if the backup repository holds a backup,
#                        else bootstrap if the brain-bootstrap tag is exactly 1,
#                        else refuse.
# Never formats a device that has any signature. The one thing it deletes is
# what its own unfinished setup left (see the marker). It never bootstraps
# unless the repository is positively empty. Guard: tests/e2e.sh.
. "$(dirname "$0")/lib.sh"

mkdir -p /run/brain
mode_file=/run/brain/boot-mode
echo failed > "$mode_file"
# Any exit but success or a deliberate refusal is a failed boot, whatever mode it had reached.
trap '[ $? = 0 ] || [ "$(cat "$mode_file")" = refused ] || echo failed > "$mode_file"' EXIT

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
    2) # blkid sees nothing: still format only if wipefs sees nothing either. Not "the first MiB is
      # zeros": the unwritten blocks of a new encrypted EBS volume read back as non-zero data.
      if [ -n "$(wipefs -n "$dev")" ]; then
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

# A one-time setup, a restore or a bootstrap, did not finish. The marker holds
# which (empty: restore) and is written below only after the directory was seen
# absent or empty, so whatever is in it came from that setup. Nothing may run on
# files that may go. pgBackRest writes global/pg_control last, and initdb writes
# it before anything else is built on the cluster: without it nothing usable was
# ever there and the directory is emptied (the only deletion any script makes);
# with it nothing is deleted, as the database may already hold rows, and the
# setup is finished with the same mode's steps, which are safe to repeat.
marker=/data/.setup-in-progress
resume=
if [ -e "$marker" ]; then
  compose rm -sf postgres
  if [ -e /data/postgres/global/pg_control ]; then
    resume=$(cat "$marker"); resume=${resume:-restore}
    case $resume in restore | bootstrap) ;; *) die "$marker says '$resume': not touching /data/postgres" ;; esac
    log "an earlier $resume finished creating the cluster: finishing it"
  else
    log "an earlier setup did not get far: emptying /data/postgres to start it again"
    [ ! -d /data/postgres ] || find /data/postgres -mindepth 1 -delete
    rm -f "$marker"
  fi
fi

# backup or empty. `pgbackrest info` exits 0 when the repository cannot be
# reached (stanza status 99), so the JSON decides: only "no stanza" (1) and "no
# valid backup" (2) with an empty backup list is empty. Anything else is retried,
# then fatal: an unreadable repository must never look empty.
repo_state() {
  local out try
  for try in 1 2 3 4 5 6; do
    out=$(compose --profile tools run --rm --no-deps -T repo) || out=
    if OUT=$out python3 -c '
import json, os, sys
try:
    stanzas = json.loads(os.environ["OUT"])
    if any(s["backup"] for s in stanzas):
        print("backup")
    elif stanzas and all(s["status"]["code"] in (1, 2) for s in stanzas):
        print("empty")
    else:
        sys.exit(1)
except (ValueError, KeyError, TypeError):
    sys.exit(1)'; then return; fi
    [ "$try" = 6 ] || sleep "${BRAIN_REPO_WAIT:-20}"
  done
  echo "$out" >&2
  die "cannot read the backup repository"
}

if [ -n "$resume" ]; then
  mode=$resume
elif [ -s /data/postgres/PG_VERSION ]; then
  mode=existing
else
  repo=$(repo_state) # a failure here ends the script: not inside a condition, where set -e is off
  if [ "$repo" = backup ]; then
    mode=restore
  elif bootstrap_allowed; then
    mode=bootstrap
  else
    echo refused > "$mode_file"
    die "no database in /data/postgres, the backup repository is empty and the brain-bootstrap tag is not 1: refusing to create one"
  fi
fi
log "boot mode: $mode"

case $mode in
  existing) export BRAIN_INIT=none ;;
  *)
    compose rm -sf postgres # a new container: its restart count is 0
    mkdir -p /data/postgres
    if [ -n "$resume" ]; then
      export BRAIN_INIT=none
    else
      export BRAIN_INIT=$mode
      [ -z "$(ls -A /data/postgres)" ] || die "/data/postgres has files but no database: not creating one over them"
      echo "$mode" > "$marker" && sync
    fi ;;
esac
# A restore is the one long wait, and status.json says so while it runs.
if [ "$mode" = restore ]; then echo restoring > "$mode_file"; else echo "$mode" > "$mode_file"; fi
compose up -d postgres

# No time limit while the container runs: a restore replays WAL for as long as it takes.
# A restart since `up` means it is crash-looping (the restart policy would keep it looking alive).
# The throwaway server a bootstrap runs has no TCP listener, so pg_isready waits for the real one.
cid=$(pg_cid)
restarts=$(docker inspect -f '{{.RestartCount}}' "$cid")
while :; do
  if [ "$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$cid")" != "true $restarts" ]; then
    compose logs --tail 20 postgres >&2; die "postgres stopped"
  fi
  if docker exec "$cid" pg_isready -q -h 127.0.0.1 && { [ "$mode" = bootstrap ] || [ "$(psql_agent -c 'select pg_is_in_recovery()')" = f ]; }; then break; fi
  sleep 2
done

if [ "$mode" = restore ]; then
  # How stale the restored data is, read before anything writes the canary: a
  # long archiving stall makes pgBackRest drop WAL, and a restore then stops at
  # the gap with every other check green. Not for a resumed restore: the status
  # timer may have written the canary since.
  if [ -z "$resume" ]; then
    lag=$(psql_agent -c 'select extract(epoch from now() - at)::bigint from brain.canary')
    if [[ $lag =~ ^[0-9]+$ ]]; then
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $lag" > /data/brain/last-restore.tmp
      mv /data/brain/last-restore.tmp /data/brain/last-restore
    fi
  fi
  echo restore > "$mode_file"
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
  rm -f "$marker" # only now: a boot that died before this is finished by the next one
fi

pgb stanza-create
repo=$(repo_state)
if [ "$mode" = restore ] || [ "$repo" != backup ]; then pgb --type=full backup; fi

# The API is the release agent's: on only if the switch is on.
"$(dirname "$0")/release-agent.sh" || log "the release agent failed; its timer retries"
