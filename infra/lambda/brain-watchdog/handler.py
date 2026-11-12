"""The brain's outside check: runs every 5 minutes, fails loudly on any miss.

The brain reports on itself (status.json), but a thing that is down cannot say
so, and after a long archiving stall pgBackRest drops WAL while every check
inside the brain stays green. So this looks at the bucket and the public API
from outside.

Reads status.json and drill.json (signals bucket) and LISTs the backup bucket's
WAL archive. It never reads an object from the backup bucket (guards: the
Terraform test brain_watchdog_role_reads_only_the_signals, and here
test_three_listings_and_only_the_last_directory_is_listed). The error carries
only the codes below, and the log line those and one HTTP status number (the
/ready probe while the brain is not serving). Each code, what it means and what
to do first: docs/operations/alarms.md. Tests: test_handler.py (run by ci.yml's
infra-scripts job).
"""

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone

STATUS_MAX_AGE = 3 * 60
WAL_MAX_AGE = 5 * 60
FULL_MAX_AGE = 26 * 3600
DRILL_MAX_AGE = 50 * 3600
DISK_MAX_PERCENT = 80
# On a t4g.micro the lowest MemAvailable seen in a rehearsal was 164 MiB under a
# release swap with a 1.7 GB database (331 idle): under 100 is the next size up.
MEMORY_MIN_MB = 100
READY_TIMEOUT = 10
READY_TRIES = 2


def parse_time(text):
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def age(when, now):
    return (now - when).total_seconds()


def read_json(s3, bucket, key):
    """(parsed or None if unparseable, the object's last-modified time)."""
    obj = s3.get_object(Bucket=bucket, Key=key)
    try:
        return json.loads(obj["Body"].read()), obj["LastModified"]
    except ValueError:
        return None, obj["LastModified"]


def check_status(s3, bucket, now):
    """(codes, status or None). Dependent checks run only on a usable status."""
    status, modified = read_json(s3, bucket, "status.json")
    if status is None or not isinstance(status, dict) or status.get("schema") != 1:
        return ["status_invalid"], None
    if age(modified, now) > STATUS_MAX_AGE:
        return ["status_stale"], None
    return [], status


def check_boot_and_postgres(status):
    codes = []
    if status.get("boot_mode") in ("failed", "refused"):
        codes.append("boot_failed")
    if not status.get("postgres_up") and status.get("boot_mode") not in (
        "restoring",
        "upgrading",
    ):
        codes.append("postgres_down")
    return codes


def check_disk(status):
    used = status.get("disk_used_percent")
    if used is None:
        return ["disk_high"] if status.get("postgres_up") else []
    return ["disk_high"] if used >= DISK_MAX_PERCENT else []


def check_full(status, now):
    last = status.get("last_full_time")
    return [] if last and age(parse_time(last), now) <= FULL_MAX_AGE else ["full_stale"]


def check_memory(status):
    mem = status.get("mem_available_mb")
    if status.get("postgres_up") and (mem is None or mem < MEMORY_MIN_MB):
        return ["memory_low"]
    return []


def check_drill(s3, bucket, now):
    drill, modified = read_json(s3, bucket, "drill.json")
    codes = []
    if age(modified, now) > DRILL_MAX_AGE:
        codes.append("drill_stale")
    if not isinstance(drill, dict) or drill.get("ok") is not True:
        codes.append("drill_failed")
    return codes


def _listing(s3, bucket, prefix):
    """Every page of one delimiter listing: (sub-prefixes, objects)."""
    prefixes, objects, token = [], [], None
    while True:
        extra = {"ContinuationToken": token} if token else {}
        page = s3.list_objects_v2(Bucket=bucket, Prefix=prefix, Delimiter="/", **extra)
        prefixes += [p["Prefix"] for p in page.get("CommonPrefixes", [])]
        objects += page.get("Contents", [])
        token = page.get("NextContinuationToken")
        if not page.get("IsTruncated") or not token:
            return prefixes, objects


def _archive_id_order(prefix):
    # "<major>-<history>", as "16-1" or "18-2": the newest is the highest history, which only
    # ever grows, not the highest major (a stanza taken back from 18 to 16 is "16-3") and
    # not the lexicographic last ("9-1" after "10-1").
    try:
        major, history = (
            int(n) for n in prefix.rstrip("/").rsplit("/", 1)[1].split("-")
        )
        return (history, major)
    except ValueError:
        return (-1, -1)


def newest_wal_time(s3, bucket, wal_prefix):
    """When the newest WAL segment was archived, or None if there is none.

    pgBackRest keeps <wal_prefix><archive id>/<16 hex digits: timeline and
    log>/<segment>-<checksum>.zst. A listing of every segment would be
    thousands of keys; three delimiter listings (ids, directories, the last
    directory) are all it takes. Directory names sort in time order, timeline
    first, so the last one holds the newest segment.
    """
    ids, _ = _listing(s3, bucket, wal_prefix)
    if not ids:
        return None
    dirs, _ = _listing(s3, bucket, max(ids, key=_archive_id_order))
    if not dirs:
        return None
    _, segments = _listing(s3, bucket, max(dirs))
    return max((o["LastModified"] for o in segments), default=None)


def check_wal(s3, bucket, wal_prefix, now):
    newest = newest_wal_time(s3, bucket, wal_prefix)
    return ["wal_stale"] if newest is None or age(newest, now) > WAL_MAX_AGE else []


def _request(url):
    return urllib.request.Request(url, headers={"User-Agent": "logjam-brain-watchdog"})


def check_ready(url, opener):
    for _ in range(READY_TRIES):
        try:
            with opener(_request(url), timeout=READY_TIMEOUT) as response:
                if response.status == 200:
                    return []
        except Exception:
            pass
    return ["api_unready"]


def probe_ready(url, opener):
    """One attempt at /ready, never a failure: the HTTP status, or None.

    Logged, not judged, while the brain is not serving or its status is
    missing. A 4xx/5xx is a status too (a WAF block is a 403, which is what
    the probe is there to show).
    """
    try:
        with opener(_request(url), timeout=READY_TIMEOUT) as response:
            return response.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


def run(s3, opener, now, env):
    """(codes of every failed check, extra log fields). One broken check never
    hides the others."""
    failed, extra = [], {}

    def attempt(fallback, check, *args):
        try:
            codes = check(*args)
        except Exception:
            codes = fallback
        failed.extend(codes)

    signals, backups = env["SIGNALS_BUCKET"], env["BACKUP_BUCKET"]
    status = None
    try:
        codes, status = check_status(s3, signals, now)
    except Exception:
        codes = ["status_missing"]
    failed.extend(codes)

    if status is not None:
        attempt(["boot_failed"], check_boot_and_postgres, status)
        attempt(["disk_high"], check_disk, status)
        attempt(["full_stale"], check_full, status, now)
        attempt(["memory_low"], check_memory, status)
    if status is not None and status.get("serving") is True:
        attempt(["api_unready"], check_ready, env["READY_URL"], opener)
    else:
        extra["ready_probe"] = probe_ready(env["READY_URL"], opener)
    # Only a Postgres known to be down (or restoring) excuses a quiet archive.
    if status is None or status.get("postgres_up"):
        attempt(["wal_stale"], check_wal, s3, backups, env["WAL_PREFIX"], now)
    attempt(["drill_missing"], check_drill, s3, signals, now)
    return failed, extra


def handler(event, context):
    import boto3

    env = {
        k: os.environ[k]
        for k in ("SIGNALS_BUCKET", "BACKUP_BUCKET", "WAL_PREFIX", "READY_URL")
    }
    failed, extra = run(
        boto3.client("s3"), urllib.request.urlopen, datetime.now(timezone.utc), env
    )
    print(json.dumps({"failed": failed, **extra}))
    if failed:
        raise RuntimeError(",".join(failed))


if __name__ == "__main__":
    raise SystemExit(
        "run the tests: python3 -m unittest discover -s infra/lambda/brain-watchdog"
    )
