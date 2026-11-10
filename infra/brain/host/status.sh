#!/usr/bin/env bash
# Every minute: the canary write (an idle database still archives WAL), then
# status.json in the signals bucket for the watchdog. The keys below are all
# there is, ever, and none holds user data. Guard: tests/e2e.sh.
. "$(dirname "$0")/lib.sh"

# The canary, as the agent role, not the superuser. pg_switch_wal() hands the
# minute's WAL to the archiver whatever the checkpointer is doing: archive_timeout
# alone stalls for up to checkpoint_timeout after a crash recovery or a restore.
boot_mode=$(cat /run/brain/boot-mode 2> /dev/null || true)
# Not while a restore runs: boot.sh reads the canary's age when it ends, and a write
# in between would hide how stale the restored data was.
pgq=
if [ "$boot_mode" != restoring ]; then
  pgq=$(psql_agent -F '|' \
    -c 'UPDATE brain.canary SET at = now()' \
    -c 'SELECT pg_switch_wal()' \
    -c "SELECT coalesce(to_char(last_archived_time AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), ''), failed_count FROM pg_stat_archiver" \
    2> /dev/null | tail -1) || pgq=
fi

api_cid=$(compose ps -aq api 2> /dev/null || true)
api_image=
[ -z "$api_cid" ] || api_image=$(docker inspect -f '{{.Config.Image}}' "$api_cid" 2> /dev/null || true)
serving=$(serving_state)
backups=$(pgb info --output=json 2> /dev/null || true)
disk=$(df --output=pcent /data 2> /dev/null | tail -1 | tr -dc 0-9 || true)
restore=$(cat /data/brain/last-restore 2> /dev/null || true)

PGQ=$pgq API_IMAGE=$api_image SERVING=$serving BACKUPS=$backups DISK=$disk BOOT_MODE=$boot_mode RESTORE=$restore python3 - <<'PY' | s3_put status.json
import json, os, time
e = os.environ
pgq = e["PGQ"].split("|") if e["PGQ"] else None
fulls = []
try:
    for stanza in json.loads(e["BACKUPS"]):
        fulls += [b["timestamp"]["stop"] for b in stanza["backup"] if b["type"] == "full"]
except ValueError:
    pass
restore = e["RESTORE"].split()
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
print(json.dumps({
    "schema": 1,
    "time": iso(time.time()),
    "postgres_up": pgq is not None,
    "disk_used_percent": int(e["DISK"]) if e["DISK"] else None,
    "last_archive_time": (pgq[0] or None) if pgq else None,
    "archive_failures": int(pgq[1]) if pgq else None,
    "last_full_time": iso(max(fulls)) if fulls else None,
    "api_sha": e["API_IMAGE"].rsplit(":", 1)[1] if ":" in e["API_IMAGE"] else None,
    "serving": e["SERVING"] == "on",
    "boot_mode": e["BOOT_MODE"] or None,
    "last_restore_at": restore[0] if restore else None,
    "last_restore_lag_seconds": int(restore[1]) if restore else None,
}))
PY
