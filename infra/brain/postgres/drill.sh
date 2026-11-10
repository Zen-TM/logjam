#!/usr/bin/env bash
# The weekly restore drill, run as the container's command by a scheduled task:
# restore the newest backup into an empty scratch directory, start Postgres on
# it, measure, stop, and write drill.json to the signals bucket. Exit 0 when
# the backup is good, 1 when not (the verdict is written either way).
#
# The restored copy must never archive into the live repository (a copy that
# promotes writes a timeline history file there and breaks later restores), so
# the restore always passes --archive-mode=off and the script refuses to start
# the server unless the restored configuration reads off. The task's role
# should be unable to write to the backup bucket as well.
# Guard: tests/e2e.sh, the drill scenarios.
#
# Environment: BRAIN_BACKUP_BUCKET, BRAIN_SIGNALS_BUCKET, AWS_REGION;
# BRAIN_DRILL_TIMEOUT (seconds for restore and recovery, default 3600);
# BRAIN_DRILL_PGDATA (scratch directory, default under /var/lib/postgresql).
# Credentials: AWS_ACCESS_KEY_ID and friends, else the ECS task role.
# BRAIN_BACKUP_ENDPOINT and BRAIN_BACKUP_VERIFY_TLS=n point both buckets at an
# S3 stand-in, as in pgbackrest-conf.sh.
set -uo pipefail

export PGDATA=${BRAIN_DRILL_PGDATA:-/var/lib/postgresql/drill}
if [ "$(id -u)" = 0 ]; then
  install -d -o postgres -g postgres -m 0700 "$PGDATA" || exit 1
  exec gosu postgres "$0" "$@"
fi

: "${BRAIN_BACKUP_BUCKET:?}" "${BRAIN_SIGNALS_BUCKET:?}" "${AWS_REGION:?}"
START=$(date +%s)
DEADLINE=$((START + ${BRAIN_DRILL_TIMEOUT:-3600}))
left() { echo $((DEADLINE - $(date +%s))); }
budget() { local l; l=$(left); echo $((l > 1 ? l : 1)); } # a timeout of 0 means none
WORK=$(mktemp -d)
SOCK=$WORK/sock
mkdir "$SOCK"
umask 077

# The verdict's error codes: the only text in it that is not a time or a label.
#   no_backup repo_unreadable restore_failed archive_mode_not_off start_failed
#   timed_out canary_unreadable migrations_unreadable tables_unreadable
ERROR='' LABEL='' STOP='' RESTORE_SECONDS='' LAG='' TABLES=''

stop_pg() { pg_ctl -D "$PGDATA" status > /dev/null 2>&1 && { pg_ctl -D "$PGDATA" -m fast -w stop > /dev/null 2>&1 || pg_ctl -D "$PGDATA" -m immediate -w stop > /dev/null 2>&1; }; return 0; }
trap 'stop_pg; rm -rf "$WORK"' EXIT

# shellcheck source=task-lib.sh
. "$(dirname "$0")/task-lib.sh"
task_credentials || exit 1
# Our own file, because the entrypoint rendered one before the credentials were known.
export PGBACKREST_CONFIG=$WORK/pgbackrest.conf
/usr/local/lib/brain/pgbackrest-conf.sh > "$PGBACKREST_CONFIG" || exit 1

PG_ARGS=(-c config_file=/etc/postgresql/postgresql.conf -c listen_addresses= -c "unix_socket_directories=$SOCK")
q() { psql -h "$SOCK" -U postgres -d "$1" -v ON_ERROR_STOP=1 -tAXq -c "$2"; }

drill() {
  local info n code stop mode at t0 recovered
  info=$(pgbackrest --stanza=logjam info --output=json) || { ERROR=repo_unreadable; return; }
  # The newest backup of the stanza. Code 1 (no stanza) and 2 (no valid backup)
  # are an empty repository; anything else with no backup is one we cannot read.
  read -r n code LABEL stop < <(jq -r '(map(select(.name == "logjam"))[0] // {}) | [(.backup // [] | length), (.status.code // 99), (.backup[-1].label // ""), (.backup[-1].timestamp.stop // "")] | @tsv' <<< "$info") \
    || { ERROR=repo_unreadable; return; }
  if [ "${n:-0}" -eq 0 ]; then
    case $code in 1 | 2) ERROR=no_backup ;; *) ERROR=repo_unreadable ;; esac
    return
  fi
  [ -z "$stop" ] || STOP=$(date -u -d "@$stop" +%Y-%m-%dT%H:%M:%SZ)

  t0=$(date +%s)
  timeout "$(budget)" pgbackrest --stanza=logjam --set="$LABEL" --archive-mode=off restore
  case $? in 0) ;; 124) ERROR=timed_out; return ;; *) ERROR=restore_failed; return ;; esac

  # What the server will run with, read before it exists as a process.
  mode=$(postgres -C archive_mode -D "$PGDATA" "${PG_ARGS[@]}" 2> /dev/null)
  [ "$mode" = off ] || { ERROR=archive_mode_not_off; return; }

  if ! pg_ctl -D "$PGDATA" -o "${PG_ARGS[*]}" -w -t "$(budget)" start; then
    ERROR=timed_out
    [ "$(left)" -le 0 ] || ERROR=start_failed
    return
  fi
  until [ "$(q postgres 'select pg_is_in_recovery()' 2> /dev/null)" = f ]; do
    [ "$(left)" -gt 0 ] || { ERROR=timed_out; return; }
    # A server that died in recovery must not look like a slow one.
    pg_ctl -D "$PGDATA" status > /dev/null 2>&1 || { ERROR=start_failed; return; }
    sleep 2
  done
  recovered=$(date +%s)
  RESTORE_SECONDS=$((recovered - t0))

  # The canary's age when recovery ended: what losing the disk at that moment would have cost.
  # About a minute with healthy archiving, hours if archiving had stalled.
  at=$(q postgres 'select extract(epoch from at)::bigint from brain.canary' 2> /dev/null)
  [[ $at =~ ^[0-9]+$ ]] || { ERROR=canary_unreadable; return; }
  LAG=$((recovered - at))
  [ "$LAG" -ge 0 ] || LAG=0

  q logjam 'select count(*) from _prisma_migrations' > /dev/null 2>&1 || { ERROR=migrations_unreadable; return; }
  # One count(*) per table, thrown away: only how many tables were read leaves here.
  local tables
  tables=$(q logjam "select format('select count(*) from %I.%I;', schemaname, tablename) from pg_tables where schemaname = 'public' order by 1") \
    || { ERROR=tables_unreadable; return; }
  psql -h "$SOCK" -U postgres -d logjam -v ON_ERROR_STOP=1 -tAXq <<< "$tables" > /dev/null 2>&1 || { ERROR=tables_unreadable; return; }
  TABLES=$(grep -c . <<< "$tables")
}
drill

stop_pg

# The verdict: a fixed key set (tests/e2e.sh holds it). schema is the version of this shape.
# canary_lag_seconds: how many seconds of writes losing the disk when recovery ended would have cost.
verdict=$(jq -n --arg time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg error "$ERROR" --arg label "$LABEL" --arg stop "$STOP" \
  --arg rs "$RESTORE_SECONDS" --arg lag "$LAG" --arg tables "$TABLES" '
  def s: if . == "" then null else . end;
  def n: if . == "" then null else tonumber end;
  {schema: 1, time: $time, ok: ($error == ""), error: ($error | s), backup_label: ($label | s), backup_stop_time: ($stop | s),
   restore_seconds: ($rs | n), canary_lag_seconds: ($lag | n), tables_read: ($tables | n)}') || exit 1

printf '%s' "$verdict" > "$WORK/drill.json"
s3_curl "$BRAIN_SIGNALS_BUCKET" drill.json "$WORK/drill.json" > /dev/null || { echo "drill: the verdict was not written" >&2; exit 1; }

echo "drill: ${ERROR:-ok}"
[ -z "$ERROR" ]
