#!/usr/bin/env bash
# Every minute: the canary write (an idle database still archives WAL), then
# status.json in the signals bucket for the watchdog. The keys below are all
# there is, ever, and none holds user data. Guard: tests/e2e.sh.
. "$(dirname "$0")/lib.sh"

# The canary is not the superuser: its own role and password, over TLS.
pw=$(cat /data/brain/canary.pw 2> /dev/null || true)
pgq=$(PGPASSWORD=$pw docker exec -e PGPASSWORD "$(pg_cid)" psql -X -q -tA -F '|' \
  "host=localhost dbname=postgres user=brain_canary sslmode=verify-full sslrootcert=/var/lib/postgresql/data/server.crt" \
  -c 'UPDATE brain.canary SET at = now()' \
  -c "SELECT coalesce(to_char(last_archived_time AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), ''), failed_count FROM pg_stat_archiver" \
  2> /dev/null) || pgq=

api_cid=$(compose ps -aq api 2> /dev/null || true)
api_image=
[ -z "$api_cid" ] || api_image=$(docker inspect -f '{{.Config.Image}}' "$api_cid" 2> /dev/null || true)
serving=$(s3_get serving 2> /dev/null || true)
backups=$(pgb info --output=json 2> /dev/null || true)
disk=$(df --output=pcent /data 2> /dev/null | tail -1 | tr -dc 0-9 || true)
boot_mode=$(cat /run/brain/boot-mode 2> /dev/null || true)

PGQ=$pgq API_IMAGE=$api_image SERVING=$serving BACKUPS=$backups DISK=$disk BOOT_MODE=$boot_mode python3 - <<'PY' | s3_put status.json
import json, os, time
e = os.environ
pgq = e["PGQ"].split("|") if e["PGQ"] else None
fulls = []
try:
    for stanza in json.loads(e["BACKUPS"]):
        fulls += [b["timestamp"]["stop"] for b in stanza["backup"] if b["type"] == "full"]
except ValueError:
    pass
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
    "serving": e["SERVING"].strip() == "on",
    "boot_mode": e["BOOT_MODE"] or None,
}))
PY
