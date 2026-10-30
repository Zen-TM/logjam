"""The gauge builder: what a reading is allowed to be, what fits the quota,
what a request may hold, and the files it writes.

shared/src/gauges.ts reads the two fixtures in shared/src/__fixtures__/ this
test writes; it fails when the builder stops writing them and gauges.test.ts
fails when the reader stops understanding them. After a deliberate format
change, regenerate them with REGENERATE_FIXTURE=1 (then `npm run format`) and
bump the format on both sides.

Pure Python: boto3 is faked, nothing touches the network.
"""

import gzip
import json
import os
import re
import sys
import unittest
from datetime import datetime, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import build_gauges as g  # noqa: E402

_HERE = os.path.dirname(__file__)
_FIXTURES = os.path.join(_HERE, "..", "..", "shared", "src", "__fixtures__")
_SHARED_TS = os.path.join(_HERE, "..", "..", "shared", "src", "gauges.ts")

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
FIXTURE_GAUGES = [
    {
        "id": "900001",
        "name": "MADE UP R @ ONE",
        "lat": -33.418,
        "lon": 150.726,
        "hot": True,
        "hasFlow": True,
        "bomLevelTs": "1",
        "bomFlowTs": "2",
    },
    {
        "id": "900002",
        "name": "MADE UP CK @ TWO",
        "lat": -33.5,
        "lon": 150.3,
        "hot": False,
        "hasFlow": False,
        "bomLevelTs": "3",
        "bomFlowTs": None,
    },
    {
        "id": "900003",
        "name": "MADE UP R @ THREE",
        "lat": -34.0,
        "lon": 150.6,
        "hot": False,
        "hasFlow": False,
        "bomLevelTs": "4",
        "bomFlowTs": None,
    },
]


def record(site, stamp, variable, value, quality="125"):
    return {
        "siteId": site,
        "timeStamp": stamp,
        "variableName": variable,
        "value": value,
        "unitOfMeasure": "m",
        "qualityCode": quality,
        "dataType": "autoqc",
    }


FIXTURE_RECORDS = [
    record("900001", "30-Oct-2026 19:00", g.LEVEL_VARIABLE, 0.9),
    record("900001", "30-Oct-2026 19:00", g.FLOW_VARIABLE, 110.0),
    record("900001", "30-Oct-2026 20:00", g.LEVEL_VARIABLE, 0.95),
    # Flat-lined (a still river does): kept.
    record("900001", "30-Oct-2026 20:00", g.FLOW_VARIABLE, 120.5, "55"),
    # Data Unavailable arrives as 0.000: dropped, the flow beside it kept.
    record("900001", "30-Oct-2026 21:00", g.LEVEL_VARIABLE, 0.0, "255"),
    record("900001", "30-Oct-2026 21:00", g.FLOW_VARIABLE, 130.0),
    record("900002", "30-Oct-2026 20:00", g.LEVEL_VARIABLE, 0.4),
]
FIXTURE_DAYS = {
    "2026-10-01": [0.91, 120.5],
    "2026-10-03": [0.88, 99.0],
}


def fixture_latest():
    fresh = g.parse_records(FIXTURE_RECORDS)
    return g.build_latest(FIXTURE_GAUGES, None, fresh, NOW, True)


def fixture_history():
    return g.history_doc("900001", FIXTURE_DAYS)


def check_fixture(test, name, built):
    path = os.path.join(_FIXTURES, name)
    if os.environ.get("REGENERATE_FIXTURE"):
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(built, fh, indent=2)
            fh.write("\n")
    with open(path, encoding="utf-8") as fh:
        test.assertEqual(json.load(fh), built)


class TestFixture(unittest.TestCase):
    def test_builder_writes_the_shared_latest_fixture(self):
        # Mutation: rename or reorder a latest.json field → red here, and
        # gauges.test.ts would read a file the builder no longer writes.
        check_fixture(self, "gauges-latest.json", fixture_latest())

    def test_builder_writes_the_shared_history_fixture(self):
        # Mutation: rename a history field, or write one column short → red.
        check_fixture(self, "gauge-history.json", fixture_history())

    def test_prefix_matches_the_shared_constant(self):
        # Mutation: change FORMAT or S3_PREFIX on one side only → red.
        with open(_SHARED_TS, encoding="utf-8") as fh:
            ts = fh.read()
        self.assertIn("export const GAUGE_FORMAT = %d;" % g.FORMAT, ts)
        self.assertIn("`master/gauges/v${GAUGE_FORMAT}/`", ts)
        self.assertEqual(g.S3_PREFIX, "master/gauges/v%d/" % g.FORMAT)


class TestReadings(unittest.TestCase):
    def test_a_q255_zero_never_becomes_a_reading(self):
        # Mutation: drop the quality 255 check → red; a dry-looking 0.000
        # would sit in the file for a river with no data.
        fresh = g.parse_records(FIXTURE_RECORDS)
        levels = [row[0] for row in fresh["900001"].values()]
        self.assertNotIn(0.0, levels)
        self.assertEqual(
            fresh["900001"][g.aest_epoch("30-Oct-2026 21:00")], [None, 130.0]
        )

    def test_a_null_value_is_dropped(self):
        # Mutation: keep rows with value None → red.
        rec = record("900001", "30-Oct-2026 19:00", g.LEVEL_VARIABLE, None)
        self.assertEqual(g.parse_records([rec]), {})

    def test_level_and_flow_at_one_time_are_one_reading(self):
        # Mutation: key rows by (time, variable) → red.
        fresh = g.parse_records(FIXTURE_RECORDS)
        self.assertEqual(len(fresh["900001"]), 3)
        at = g.aest_epoch("30-Oct-2026 19:00")
        self.assertEqual(fresh["900001"][at], [0.9, 110.0])

    def test_a_flat_line_is_kept_and_other_variables_ignored(self):
        # Mutation: drop quality 55 as well as 255, or accept any variable → red.
        fresh = g.parse_records(
            FIXTURE_RECORDS + [record("900001", "30-Oct-2026 22:00", "Rainfall", 3)]
        )
        self.assertEqual(fresh["900001"][g.aest_epoch("30-Oct-2026 20:00")][1], 120.5)
        self.assertNotIn(g.aest_epoch("30-Oct-2026 22:00"), fresh["900001"])

    def test_the_portal_clock_is_aest(self):
        # Mutation: read the stamp as UTC → red (ten hours out).
        self.assertEqual(
            g.aest_epoch("01-Jan-2026 10:00"),
            int(datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc).timestamp()),
        )

    def test_merge_dedupes_by_time_and_prunes_past_seven_days(self):
        # Mutation: append without de-duping, or prune at 8 days → red.
        now = int(NOW.timestamp())
        old = [[now - 8 * 86400, 1.0, None], [now - 3600, 1.0, 5.0]]
        merged = g.merge_readings(old, {now - 3600: [2.0, None], now: [3.0, 6.0]}, now)
        self.assertEqual(merged, [[now - 3600, 2.0, 5.0], [now, 3.0, 6.0]])


class TestQuota(unittest.TestCase):
    def test_hot_and_cold_fit_the_daily_quota(self):
        # Mutation: raise MAX_HOT or MAX_GAUGES past the ceiling of 20 hot and
        # 279 gauges (25 calls a day at the ceiling, 26 with 7 hot) or past what
        # 29 calls cover, or
        # run the job more often than the schedule → red.
        self.assertLessEqual(g.calls_per_day(g.MAX_HOT, g.MAX_GAUGES), g.CALLS_PER_DAY)
        gauges = g.load_gauges()
        self.assertLessEqual(
            g.calls_per_day(sum(x["hot"] for x in gauges), len(gauges)), g.CALLS_PER_DAY
        )

    def test_the_registry_never_exceeds_the_limits(self):
        # Mutation: mark a 21st gauge hot, or list a 280th → red.
        gauges = g.load_gauges()
        self.assertLessEqual(sum(x["hot"] for x in gauges), g.MAX_HOT)
        self.assertLessEqual(len(gauges), g.MAX_GAUGES)
        self.assertEqual(len({x["id"] for x in gauges}), len(gauges))

    def test_the_schedule_runs_as_often_as_the_quota_assumes(self):
        # Mutation: change the schedule to hourly without RUNS_PER_DAY → red.
        tf = os.path.join(
            _HERE, "..", "..", "infra", "terraform", "envs", "prod", "ecs.tf"
        )
        with open(tf, encoding="utf-8") as fh:
            self.assertIn('"rate(%d hours)"' % (24 // g.RUNS_PER_DAY), fh.read())

    def test_the_hot_list_is_in_the_registry(self):
        # Mutation: name a hot id that is not listed → red.
        hot = {x["id"] for x in g.load_gauges() if x["hot"]}
        self.assertEqual(hot, set(g.HOT))


class TestRequests(unittest.TestCase):
    def test_urls_hold_only_gauge_ids_and_constants(self):
        # Mutation: add any other value (a place, a user, a coordinate) to a
        # query → red.
        urls = []

        def fake(url, headers=None, timeout=60):
            urls.append(url)
            if url.startswith(g.WATERNSW_URL):
                return {"latestRecords": [], "totalPages": 1}
            return []

        gauge = FIXTURE_GAUGES[0]
        with mock.patch.object(g, "http_get", fake):
            g.fetch_latest(["900001", "900002"], "KEY")
            g.fetch_daily(gauge, "2026-10-01", "2026-10-30")
        allowed = {
            "siteId": r"\d+(,\d+)*",
            "frequency": "Latest",
            "pageNumber": r"\d+",
            "variable": f"{g.LEVEL_VARIABLE},{g.FLOW_VARIABLE}",
            "service": "kisters",
            "type": "QueryServices",
            "format": "json",
            "datasource": "0",
            "request": "getTimeseriesValues",
            "ts_id": r"\d+(,\d+)*",
            "from": r"\d{4}-\d\d-\d\d",
            "to": r"\d{4}-\d\d-\d\d",
            "returnfields": "Timestamp,Value",
        }
        self.assertEqual(len(urls), 2)
        for url in urls:
            self.assertNotIn("KEY", url)
            for key, value in re.findall(r"[?&]([^=]+)=([^&]*)", url):
                self.assertIn(key, allowed)
                self.assertRegex(value, "^(%s)$" % allowed[key])

    def test_every_listed_id_is_a_station_number(self):
        # Mutation: list an id with a dot or letters → red.
        for gauge in g.load_gauges():
            self.assertRegex(gauge["id"], r"^\d+$")

    def test_a_later_page_is_read(self):
        # Mutation: stop after page one → red.
        pages = iter(
            [
                {"latestRecords": [], "totalPages": 2},
                {"latestRecords": [], "totalPages": 2},
            ]
        )
        with (
            mock.patch.object(g, "http_get", lambda *a, **k: next(pages)),
            mock.patch.object(g.time, "sleep"),
        ):
            g.fetch_latest(["900001"], "KEY")

    def test_bom_flow_is_converted_to_megalitres_a_day(self):
        series = [
            {
                "ts_id": "2",
                "data": [
                    ["2026-10-01T00:00:00.000+10:00", 1.0],
                    ["2026-10-02T00:00:00.000+10:00", None],
                ],
            }
        ]
        with mock.patch.object(g, "http_get", lambda *a, **k: series):
            days = g.fetch_daily(FIXTURE_GAUGES[0], "a", "b")
        self.assertEqual(days, {"2026-10-01": [None, 86.4]})


class FakeS3:
    def __init__(self):
        self.store = {}
        self.puts = []

    def list_objects_v2(self, Bucket, Prefix, MaxKeys):
        return {"KeyCount": int(Prefix in self.store)}

    def get_object(self, Bucket, Key):
        if Key not in self.store:
            raise PermissionError("AccessDenied")  # Mutation: skip the list → red
        body = self.store[Key]
        return {"Body": type("B", (), {"read": lambda _s: body})()}

    def put_object(self, Bucket, Key, Body, **kw):
        self.store[Key] = Body
        self.puts.append((Key, kw))

    def get_paginator(self, _name):
        s3 = self
        return type(
            "P",
            (),
            {
                "paginate": lambda _s, Bucket, Prefix: [
                    {"Contents": [{"Key": k} for k in s3.store if k.startswith(Prefix)]}
                ]
            },
        )()

    def doc(self, key):
        return json.loads(gzip.decompress(self.store[g.S3_PREFIX + key]))


def run_with(s3, gauges, fetch, bom=None, env=True):
    fake_boto3 = mock.Mock()
    fake_boto3.client.return_value = s3
    patches = [
        mock.patch.dict(sys.modules, {"boto3": fake_boto3}),
        mock.patch.dict(os.environ, {g.KEY_ENV: "KEY"} if env else {}),
        mock.patch.object(g, "load_gauges", lambda: gauges),
        mock.patch.object(g, "fetch_latest", fetch),
        mock.patch.object(
            g, "fetch_daily", bom or (lambda *a: {"2026-10-01": [1.0, 2.0]})
        ),
        mock.patch.object(g.time, "sleep"),
    ]
    for p in patches:
        p.start()
    try:
        g.run("bucket")
    finally:
        mock.patch.stopall()


class TestRun(unittest.TestCase):
    def fresh(self, ids, key):
        return {i: {int(NOW.timestamp()): [1.0, None]} for i in ids}

    def test_a_first_run_writes_latest_and_history_for_every_gauge(self):
        s3 = FakeS3()
        run_with(s3, FIXTURE_GAUGES, self.fresh)
        latest = s3.doc("latest.json")
        self.assertEqual(
            [x["id"] for x in latest["gauges"]], ["900001", "900002", "900003"]
        )
        self.assertEqual(s3.doc("history/900003.json")["start"], "2026-10-01")
        keys = dict(s3.puts)
        self.assertEqual(
            keys[g.S3_PREFIX + "latest.json"]["CacheControl"], "public, max-age=300"
        )
        self.assertEqual(keys[g.S3_PREFIX + "latest.json"]["ContentEncoding"], "gzip")
        self.assertEqual(
            keys[g.S3_PREFIX + "history/900001.json"]["CacheControl"],
            "public, max-age=3600",
        )

    def test_a_failed_hot_fetch_exits_and_leaves_the_old_file(self):
        # Mutation: catch the hot error and publish anyway → red.
        s3 = FakeS3()
        s3.store[g.S3_PREFIX + "latest.json"] = g.encode(fixture_latest())

        def boom(ids, key):
            raise OSError("down")

        with self.assertRaises(OSError):
            run_with(s3, FIXTURE_GAUGES, boom)
        self.assertEqual(s3.puts, [])

    def test_no_hot_readings_is_a_failure(self):
        # Mutation: publish an empty hot result → red.
        with self.assertRaises(SystemExit):
            run_with(FakeS3(), FIXTURE_GAUGES, lambda ids, key: {})

    def run_failing_on(self, bad, s3):
        calls = []

        def fetch(ids, key):
            calls.append(ids)
            if bad in ids:
                raise OSError("down")
            return self.fresh(ids, key)

        with mock.patch.object(g, "SITES_PER_CALL", 1):
            with self.assertRaises(SystemExit):
                run_with(s3, FIXTURE_GAUGES, fetch)
        return calls

    def test_a_chunk_failing_midway_stops_the_sweep_and_exits_non_zero(self):
        # Mutation: carry on after a failed chunk → red (a third call, and
        # the quota spent on a sweep that is already broken); swallow the
        # failure so the run exits 0 → red (the alarm never fires); skip the
        # publish → red (the hot readings are lost).
        s3 = FakeS3()
        calls = self.run_failing_on("900002", s3)
        self.assertEqual(calls, [["900001"], ["900002"]])
        self.assertTrue(s3.doc("latest.json")["gauges"][0]["readings"])

    def test_a_sweep_with_one_chunk_through_is_stamped(self):
        # Mutation: never advance coldSweptAt after a partial sweep → red;
        # the next run would spend the sweep's calls again.
        s3 = FakeS3()
        self.run_failing_on("900003", s3)
        self.assertNotEqual(
            s3.doc("latest.json")["coldSweptAt"], "1970-01-01T00:00:00Z"
        )

    def test_a_sweep_with_no_chunk_through_is_not_stamped(self):
        # Mutation: advance coldSweptAt regardless → red; the cold gauges
        # would wait a day for a sweep that got nothing.
        s3 = FakeS3()
        s3.store[g.S3_PREFIX + "latest.json"] = g.encode(
            {**fixture_latest(), "coldSweptAt": "2026-10-01T00:00:00Z"}
        )
        self.run_failing_on("900002", s3)
        self.assertEqual(s3.doc("latest.json")["coldSweptAt"], "2026-10-01T00:00:00Z")
        # A first run that swept nothing is swept again by the next.
        first = FakeS3()
        self.run_failing_on("900002", first)
        self.assertTrue(g.needs_sweep(first.doc("latest.json"), NOW))

    def test_the_cold_sweep_runs_once_a_day(self):
        # Mutation: sweep on every run → red; 13 more calls each run.
        s3 = FakeS3()
        run_with(s3, FIXTURE_GAUGES, self.fresh)
        calls = []
        run_with(
            s3,
            FIXTURE_GAUGES,
            lambda ids, key: calls.append(ids) or self.fresh(ids, key),
        )
        self.assertEqual(calls, [["900001"]])

    def test_refuses_a_registry_far_smaller_than_the_published_one(self):
        # Mutation: drop the count check → red.
        s3 = FakeS3()
        run_with(s3, FIXTURE_GAUGES, self.fresh)
        s3.puts.clear()
        with self.assertRaises(SystemExit):
            run_with(s3, FIXTURE_GAUGES[:1], self.fresh)
        self.assertEqual(s3.puts, [])

    def test_a_bom_failure_for_one_gauge_is_not_fatal(self):
        # Mutation: let the BoM error escape → red; latest.json is already
        # written, but the other gauges' history would stop.
        def bom(gauge, start, end):
            if gauge["id"] == "900002":
                raise OSError("502")
            return {"2026-10-01": [1.0, None]}

        s3 = FakeS3()
        run_with(s3, FIXTURE_GAUGES, self.fresh, bom)
        self.assertIn(g.S3_PREFIX + "history/900003.json", s3.store)
        self.assertNotIn(g.S3_PREFIX + "history/900002.json", s3.store)

    def test_an_existing_history_gets_only_recent_days_merged(self):
        # Mutation: refetch the full series for a gauge that has a file → red.
        s3 = FakeS3()
        s3.store[g.S3_PREFIX + "history/900001.json"] = g.encode(fixture_history())
        starts = []

        def bom(gauge, start, end):
            starts.append((gauge["id"], start))
            return {"2026-10-03": [9.0, None]}

        run_with(s3, FIXTURE_GAUGES, self.fresh, bom)
        self.assertNotIn(("900001", g.BOM_FROM), starts)
        self.assertIn(("900002", g.BOM_FROM), starts)
        merged = s3.doc("history/900001.json")
        self.assertEqual(merged["level"], [0.91, None, 9.0])
        self.assertEqual(merged["flow"], [120.5, None, None])

    def test_a_partly_null_recent_day_keeps_the_stored_value(self):
        # Mutation: replace the stored row with days.update → red; a day BoM
        # has only a level for would lose its stored flow.
        s3 = FakeS3()
        doc = g.history_doc("900001", {"2026-10-01": [1.0, 5.0]})
        s3.store[g.S3_PREFIX + "history/900001.json"] = g.encode(doc)
        run_with(s3, FIXTURE_GAUGES, self.fresh, lambda *a: {"2026-10-01": [2.0, None]})
        merged = s3.doc("history/900001.json")
        self.assertEqual((merged["level"], merged["flow"]), ([2.0], [5.0]))

    def test_a_missing_key_stops_before_any_request(self):
        with self.assertRaises(SystemExit):
            run_with(FakeS3(), FIXTURE_GAUGES, self.fresh, env=False)


if __name__ == "__main__":
    unittest.main()
