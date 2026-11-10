"""Tests for handler.py: a fake S3 client and a fake URL opener, no AWS.

    python3 -m unittest discover -s infra/lambda/brain-watchdog

Mutations that turn this red (each applied once and seen to fail):
  - dropping the `check_wal` line from run(): test_wal_stale_when_status_claims_a_fresh_archive;
  - treating a missing status.json as green (`codes = []` in run()'s except):
    test_status_missing;
  - choosing the lexicographically last archive id, or any directory but the
    last: the listing tests;
  - dropping the `serving` condition on the API check: test_api_not_checked_when_not_serving.
"""

import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from unittest import mock

import handler

NOW = datetime(2026, 11, 10, 12, 0, 0, tzinfo=timezone.utc)
ENV = {
    "SIGNALS_BUCKET": "signals",
    "BACKUP_BUCKET": "backups",
    "WAL_PREFIX": "logjam/archive/logjam/",
    "READY_URL": "https://api.example.test/ready",
}
WAL = "logjam/archive/logjam/"


def ago(seconds):
    return NOW - timedelta(seconds=seconds)


def iso(when):
    return when.strftime("%Y-%m-%dT%H:%M:%SZ")


def good_status(**changes):
    status = {
        "schema": 1,
        "time": iso(ago(30)),
        "postgres_up": True,
        "disk_used_percent": 40,
        "last_archive_time": iso(ago(30)),
        "archive_failures": 0,
        "last_full_time": iso(ago(3600)),
        "api_sha": "abc",
        "serving": True,
        "boot_mode": "existing",
        "last_restore_at": None,
        "last_restore_lag_seconds": None,
    }
    status.update(changes)
    return status


class FakeS3:
    """Two buckets. `signals` maps key -> (body, last modified); `backups`
    maps key -> last modified. Lists honour prefix, delimiter and paging."""

    def __init__(self, signals, backups, page_size=1000):
        self.signals, self.backups, self.page_size = signals, backups, page_size
        self.gets, self.lists = [], []

    def get_object(self, Bucket, Key):
        self.gets.append((Bucket, Key))
        assert Bucket == "signals", "the watchdog must never read the backup bucket"
        body, modified = self.signals[Key]
        return {"Body": io.BytesIO(body), "LastModified": modified}

    def list_objects_v2(self, Bucket, Prefix, Delimiter, ContinuationToken=None):
        self.lists.append(Prefix)
        assert Bucket == "backups" and Delimiter == "/"
        prefixes, objects = [], []
        for key in sorted(self.backups):
            if not key.startswith(Prefix):
                continue
            rest = key[len(Prefix) :]
            if "/" in rest:
                p = Prefix + rest.split("/")[0] + "/"
                if p not in prefixes:
                    prefixes.append(p)
            else:
                objects.append({"Key": key, "LastModified": self.backups[key]})
        entries = [("p", p) for p in prefixes] + [("o", o) for o in objects]
        start = int(ContinuationToken or 0)
        chunk = entries[start : start + self.page_size]
        page = {
            "CommonPrefixes": [{"Prefix": v} for k, v in chunk if k == "p"],
            "Contents": [v for k, v in chunk if k == "o"],
            "IsTruncated": start + self.page_size < len(entries),
        }
        if page["IsTruncated"]:
            page["NextContinuationToken"] = str(start + self.page_size)
        return page


class FakeResponse:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    """Answers each call from `answers` (a status code or an exception), the
    last answer repeating."""

    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    def __call__(self, request, timeout):
        self.calls.append((request.full_url, timeout))
        answer = self.answers[min(len(self.calls), len(self.answers)) - 1]
        if isinstance(answer, Exception):
            raise answer
        return FakeResponse(answer)


def signals(status=None, status_age=30, drill=None, drill_age=3600, raw_status=None):
    out = {}
    if status is not False:
        body = (
            raw_status
            if raw_status is not None
            else json.dumps(status or good_status()).encode()
        )
        out["status.json"] = (body, ago(status_age))
    if drill is not False:
        out["drill.json"] = (
            json.dumps(drill or {"schema": 1, "ok": True}).encode(),
            ago(drill_age),
        )
    return out


def fresh_wal():
    return {WAL + "16-1/0000000100000000/000000010000000000000042-abc.zst": ago(20)}


def run(s3=None, opener=None, **kw):
    s3 = s3 or FakeS3(signals(**kw), fresh_wal())
    return handler.run(s3, opener or FakeOpener(200), NOW, ENV), s3


class Codes(unittest.TestCase):
    def failed(self, **kw):
        return sorted(run(**kw)[0])

    def test_all_green(self):
        opener = FakeOpener(200)
        failed, s3 = run(opener=opener)
        self.assertEqual(failed, [])
        self.assertEqual(opener.calls, [("https://api.example.test/ready", 10)])
        self.assertTrue(all(b == "signals" for b, _ in s3.gets))

    def test_status_missing(self):
        self.assertEqual(self.failed(status=False), ["status_missing"])
        # A missing report must not hide the bucket check.
        old = {
            WAL + "16-1/0000000100000000/000000010000000000000042-abc.zst": ago(3600)
        }
        s3 = FakeS3(signals(status=False), old)
        self.assertEqual(sorted(run(s3=s3)[0]), ["status_missing", "wal_stale"])

    def test_status_stale(self):
        self.assertEqual(self.failed(status_age=181), ["status_stale"])
        self.assertEqual(self.failed(status_age=179), [])

    def test_status_invalid(self):
        self.assertEqual(self.failed(raw_status=b"{not json"), ["status_invalid"])
        self.assertEqual(self.failed(status=good_status(schema=2)), ["status_invalid"])
        self.assertEqual(self.failed(raw_status=b"[1]"), ["status_invalid"])

    def test_boot_failed(self):
        for mode in ("failed", "refused"):
            self.assertEqual(
                self.failed(status=good_status(boot_mode=mode)), ["boot_failed"]
            )

    def test_postgres_down(self):
        self.assertEqual(
            self.failed(status=good_status(postgres_up=False)), ["postgres_down"]
        )

    def test_restoring_is_not_postgres_down_nor_a_quiet_archive(self):
        # Nothing archives while a restore runs, and that is not an alarm.
        s3 = FakeS3(
            signals(status=good_status(postgres_up=False, boot_mode="restoring")), {}
        )
        self.assertEqual(run(s3=s3)[0], [])

    def test_disk_high(self):
        self.assertEqual(
            self.failed(status=good_status(disk_used_percent=80)), ["disk_high"]
        )
        self.assertEqual(self.failed(status=good_status(disk_used_percent=79)), [])
        self.assertEqual(
            self.failed(status=good_status(disk_used_percent=None)), ["disk_high"]
        )

    def test_disk_unknown_is_fine_while_postgres_is_not_up(self):
        status = good_status(
            postgres_up=False, disk_used_percent=None, boot_mode="restoring"
        )
        s3 = FakeS3(signals(status=status), {})
        self.assertEqual(run(s3=s3)[0], [])

    def test_wal_stale(self):
        old = {WAL + "16-1/0000000100000000/000000010000000000000042-abc.zst": ago(301)}
        self.assertEqual(sorted(run(s3=FakeS3(signals(), old))[0]), ["wal_stale"])

    def test_wal_stale_when_status_claims_a_fresh_archive(self):
        # status.json says it archived 30 s ago (good_status); the bucket says
        # nothing arrived for an hour. The bucket wins: this is the dropped-WAL case.
        old = {
            WAL + "16-1/0000000100000000/000000010000000000000042-abc.zst": ago(3600)
        }
        self.assertEqual(good_status()["last_archive_time"], iso(ago(30)))
        self.assertEqual(run(s3=FakeS3(signals(), old))[0], ["wal_stale"])

    def test_wal_stale_when_the_archive_is_empty(self):
        self.assertEqual(run(s3=FakeS3(signals(), {}))[0], ["wal_stale"])

    def test_full_stale(self):
        for last in (iso(ago(26 * 3600 + 1)), None):
            self.assertEqual(
                self.failed(status=good_status(last_full_time=last)), ["full_stale"]
            )
        self.assertEqual(
            self.failed(status=good_status(last_full_time=iso(ago(26 * 3600 - 1)))), []
        )

    def test_restore_lag_high(self):
        recent = dict(last_restore_at=iso(ago(3600)), last_restore_lag_seconds=301)
        self.assertEqual(
            self.failed(status=good_status(**recent)), ["restore_lag_high"]
        )
        recent["last_restore_lag_seconds"] = 300
        self.assertEqual(self.failed(status=good_status(**recent)), [])
        old = dict(
            last_restore_at=iso(ago(24 * 3600 + 1)), last_restore_lag_seconds=9999
        )
        self.assertEqual(self.failed(status=good_status(**old)), [])

    def test_drill_missing(self):
        self.assertEqual(self.failed(drill=False), ["drill_missing"])

    def test_drill_stale(self):
        self.assertEqual(self.failed(drill_age=50 * 3600 + 1), ["drill_stale"])
        self.assertEqual(self.failed(drill_age=50 * 3600 - 1), [])

    def test_drill_failed(self):
        for body in (
            {"schema": 1, "ok": False, "error": "no_backup"},
            {"schema": 1},
            {"ok": "true"},
        ):
            self.assertEqual(self.failed(drill=body), ["drill_failed"])

    def test_api_unready_after_two_tries(self):
        down = FakeOpener(503)
        self.assertEqual(run(opener=down)[0], ["api_unready"])
        self.assertEqual(len(down.calls), 2)
        self.assertEqual(
            run(opener=FakeOpener(OSError("timed out")))[0], ["api_unready"]
        )

    def test_api_ready_on_the_second_try(self):
        flaky = FakeOpener(OSError("reset"), 200)
        self.assertEqual(run(opener=flaky)[0], [])
        self.assertEqual(len(flaky.calls), 2)

    def test_api_not_checked_when_not_serving(self):
        opener = FakeOpener(503)
        self.assertEqual(run(opener=opener, status=good_status(serving=False))[0], [])
        self.assertEqual(opener.calls, [])

    def test_one_check_throwing_does_not_hide_the_others(self):
        # A string where a number belongs breaks the disk check; the broken
        # check reports its own code and every other check still runs.
        status = good_status(
            disk_used_percent="lots", last_full_time=iso(ago(30 * 3600))
        )
        s3 = FakeS3(signals(status=status, drill=False), fresh_wal())
        self.assertEqual(
            sorted(run(s3=s3)[0]), ["disk_high", "drill_missing", "full_stale"]
        )

    def test_the_bucket_listing_failing_is_wal_stale_only(self):
        class Broken(FakeS3):
            def list_objects_v2(self, **kw):
                raise RuntimeError("AccessDenied")

        self.assertEqual(run(s3=Broken(signals(), {}))[0], ["wal_stale"])


class Listing(unittest.TestCase):
    """The archive layout pgBackRest writes, made up: two archive ids (a
    stanza upgrade), several directories (one per 4 GiB of WAL, the timeline
    first), many segments."""

    def archive(self):
        keys = {}
        # The old archive id still has recent-looking objects: it must not count.
        keys[WAL + "16-1/0000000100000003/000000010000000300000010-a.zst"] = ago(5)
        for i in range(5):
            keys[WAL + f"16-2/0000000100000000/0000000100000000000000{i:02x}-a.zst"] = (
                ago(90000 + i)
            )
        keys[WAL + "16-2/0000000100000001/000000010000000100000001-b.zst"] = ago(50000)
        keys[WAL + "16-2/0000000200000000/000000020000000000000007-c.zst"] = ago(700)
        keys[WAL + "16-2/0000000200000000/000000020000000000000008-d.zst"] = ago(100)
        keys[
            WAL + "16-2/0000000200000000/000000020000000000000007.00000028.backup-e.zst"
        ] = ago(400)
        keys[WAL + "16-2/00000002.history"] = ago(800)
        keys[WAL + "archive.info"] = ago(99)
        return keys

    def test_newest_segment_of_the_newest_id_and_directory(self):
        s3 = FakeS3({}, self.archive())
        self.assertEqual(handler.newest_wal_time(s3, "backups", WAL), ago(100))

    def test_three_listings_and_only_the_last_directory_is_listed(self):
        s3 = FakeS3({}, self.archive())
        handler.newest_wal_time(s3, "backups", WAL)
        self.assertEqual(s3.lists, [WAL, WAL + "16-2/", WAL + "16-2/0000000200000000/"])
        self.assertEqual(s3.gets, [])

    def test_the_newest_directory_old_means_stale_whatever_older_ones_hold(self):
        keys = self.archive()
        for k in [k for k in keys if "0000000200000000/" in k]:
            keys[k] = ago(3000)
        s3 = FakeS3(signals(), keys)
        self.assertEqual(run(s3=s3)[0], ["wal_stale"])

    def test_archive_ids_order_by_number(self):
        keys = {
            WAL + "9-1/0000000100000000/x-a.zst": ago(5000),
            WAL + "10-1/0000000100000000/y-a.zst": ago(10),
        }
        self.assertEqual(
            handler.newest_wal_time(FakeS3({}, keys), "backups", WAL), ago(10)
        )

    def test_listings_follow_pages(self):
        keys = {WAL + f"16-1/{n:016x}/seg-a.zst": ago(1000 - n) for n in range(7)}
        s3 = FakeS3({}, keys, page_size=2)
        self.assertEqual(handler.newest_wal_time(s3, "backups", WAL), ago(994))

    def test_ids_but_no_directories_or_no_segments(self):
        self.assertIsNone(
            handler.newest_wal_time(
                FakeS3({}, {WAL + "16-1/stray.txt": ago(1)}), "backups", WAL
            )
        )

        class EmptyDir(FakeS3):
            def list_objects_v2(
                self, Bucket, Prefix, Delimiter, ContinuationToken=None
            ):
                if Prefix == WAL:
                    return {"CommonPrefixes": [{"Prefix": WAL + "16-1/"}]}
                if Prefix == WAL + "16-1/":
                    return {
                        "CommonPrefixes": [{"Prefix": WAL + "16-1/0000000100000000/"}]
                    }
                return {}

        self.assertIsNone(handler.newest_wal_time(EmptyDir({}, {}), "backups", WAL))


class Entry(unittest.TestCase):
    def call(self, backups, **kw):
        fake = FakeS3(signals(**kw), backups)
        boto3 = mock.Mock(client=lambda name: fake)
        out = io.StringIO()
        env = {
            "SIGNALS_BUCKET": "signals",
            "BACKUP_BUCKET": "backups",
            "WAL_PREFIX": WAL,
            "READY_URL": "https://api.example.test/ready",
        }
        with (
            mock.patch.dict(sys.modules, {"boto3": boto3}),
            mock.patch.dict("os.environ", env),
            mock.patch("urllib.request.urlopen", FakeOpener(200)),
            mock.patch.object(
                handler,
                "datetime",
                mock.Mock(now=lambda tz: NOW, strptime=datetime.strptime),
            ),
            redirect_stdout(out),
        ):
            try:
                handler.handler({}, None)
                error = None
            except RuntimeError as e:
                error = str(e)
        return out.getvalue(), error

    def test_green_logs_an_empty_list_and_returns(self):
        out, error = self.call(fresh_wal())
        self.assertEqual((json.loads(out), error), ({"failed": []}, None))

    def test_a_miss_logs_one_line_and_raises_with_only_the_codes(self):
        out, error = self.call({}, drill=False)
        self.assertEqual(out.count("\n"), 1)
        self.assertEqual(json.loads(out), {"failed": ["wal_stale", "drill_missing"]})
        self.assertEqual(error, "wal_stale,drill_missing")


if __name__ == "__main__":
    unittest.main()
