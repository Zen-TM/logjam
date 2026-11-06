"""Unit tests for build_fire_history: resolve_fire_year, the pure date→year
mapping used to decide which NPWS Fire History polygons are rasterizable, and
the monthly refresh's read of the map service and its publish decision.

Pure stdlib logic — no GDAL/OGR — but build_fire_history.py imports osgeo at
module top, so we stub it first (per topo/tests/_native_stub.py convention)
to keep this suite runnable on a host without GDAL Python bindings.
"""

import io
import json
import os
import re
import sys
import tempfile
import unittest
import urllib.error
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

import build_fire_history as fh  # noqa: E402
from build_fire_history import resolve_fire_year  # noqa: E402

_CURRENT_YEAR = 2026


class TestResolveFireYear(unittest.TestCase):
    def test_end_date_present_uses_end_date_year(self):
        self.assertEqual(
            resolve_fire_year(date(2019, 7, 1), date(2020, 3, 15), _CURRENT_YEAR),
            2020,
        )

    def test_end_date_null_falls_back_to_start_date_year(self):
        self.assertEqual(
            resolve_fire_year(date(2015, 11, 1), None, _CURRENT_YEAR),
            2015,
        )

    def test_both_dates_null_returns_none(self):
        self.assertIsNone(resolve_fire_year(None, None, _CURRENT_YEAR))

    def test_sentinel_1899_start_date_rejected(self):
        self.assertIsNone(resolve_fire_year(date(1899, 12, 30), None, _CURRENT_YEAR))

    def test_sentinel_1899_end_date_rejected(self):
        self.assertIsNone(
            resolve_fire_year(date(2007, 1, 1), date(1899, 12, 30), _CURRENT_YEAR)
        )

    def test_bogus_1807_end_date_rejected_even_with_valid_start_date(self):
        # Real NPWS data quirk: StartDate=2007-07-18 but EndDate=1807-07-01.
        # EndDate is coalesced first, so the bogus year drops the feature
        # even though StartDate alone would have been valid.
        self.assertIsNone(
            resolve_fire_year(date(2007, 7, 18), date(1807, 7, 1), _CURRENT_YEAR)
        )

    def test_future_year_rejected(self):
        future = date(_CURRENT_YEAR + 2, 1, 1)
        self.assertIsNone(resolve_fire_year(None, future, _CURRENT_YEAR))

    def test_normal_recent_year_accepted(self):
        self.assertEqual(
            resolve_fire_year(date(2019, 7, 1), date(2019, 12, 20), _CURRENT_YEAR),
            2019,
        )


def _feature(oid, start_ms=None):
    return {
        "type": "Feature",
        "properties": {"OBJECTID": oid, "StartDate": start_ms, "EndDate": None},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[150, -33], [150.1, -33], [150, -33.1], [150, -33]]],
        },
    }


class FakeService:
    """The layer's /query: `count` polygons, served `page` at a time in
    OBJECTID order, as ArcGIS pages by resultOffset."""

    def __init__(
        self,
        count,
        page=2,
        counted=None,
        ignores_offset=False,
        too_big=None,
        latest=None,
    ):
        self.features = [_feature(oid, 1572566400000) for oid in range(1, count + 1)]
        self.page = page
        self.counted = count if counted is None else counted
        self.ignores_offset = ignores_offset
        # (offset, size): a page from this offset over this many polygons
        # answers 500, as the service's size limit does.
        self.too_big = too_big
        # Each date field's maximum, in epoch ms, where it isn't 2019-11-01.
        self.latest = latest or {}
        # An error every page raises instead of answering.
        self.down = None
        self.page_requests = 0
        self.offsets = []

    def __call__(self, params):
        if params.get("returnCountOnly"):
            return {"count": self.counted}
        if "outStatistics" in params:
            return {
                "features": [
                    {
                        "attributes": {
                            f"latest_{f}": self.latest.get(f, 1572566400000)
                            for f in fh.DATE_FIELDS
                        }
                    }
                ]
            }
        self.page_requests += 1
        if self.down:
            raise self.down
        offset = 0 if self.ignores_offset else params["resultOffset"]
        size = min(self.page, params["resultRecordCount"])
        if self.too_big and offset >= self.too_big[0] and size > self.too_big[1]:
            raise OSError("HTTP Error 500")
        self.offsets.append(params["resultOffset"])
        doc = {
            "type": "FeatureCollection",
            "features": self.features[offset : offset + size],
        }
        if offset + size < len(self.features):
            doc["exceededTransferLimit"] = True
        return doc


class TestEsriDate(unittest.TestCase):
    def test_epoch_ms_is_the_utc_day(self):
        # Mutation: convert in local time (fromtimestamp without tz) and
        # Sydney's clock moves a midnight-UTC date to the next day.
        self.assertEqual(fh.esri_date(1793059200000), "2026-10-27")

    def test_dates_before_1970_and_the_null_sentinel(self):
        self.assertEqual(fh.esri_date(15638400000), "1970-07-01")
        self.assertEqual(fh.esri_date(-2209161600000), "1899-12-30")
        self.assertIsNone(fh.esri_date(None))

    def test_a_date_past_year_9999_is_no_date(self):
        # Mutation: drop the OverflowError catch and the read dies here.
        self.assertIsNone(fh.esri_date(10**15))


class TestFetch(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.out = Path(self.dir.name) / "fire.geojson"

    def test_pages_through_every_polygon_into_one_geojson(self):
        # Mutation: page by a fixed PAGE_SIZE instead of what came back, or
        # skip the date conversion.
        service = FakeService(5, page=2)
        with mock.patch("sys.stdout", io.StringIO()):
            self.assertEqual(fh.fetch(self.out, fh.RASTER_FIELDS, 5, service), 5)
        self.assertEqual(service.offsets, [0, 2, 4])
        doc = json.loads(self.out.read_text())
        self.assertEqual(
            [f["properties"]["OBJECTID"] for f in doc["features"]], [1, 2, 3, 4, 5]
        )
        self.assertEqual(doc["features"][0]["properties"]["StartDate"], "2019-11-01")
        self.assertEqual(doc["crs"]["properties"]["name"], "EPSG:4283")

    def test_a_page_over_the_size_limit_is_asked_for_in_halves(self):
        # Mutation: re-raise a failed page instead of halving it.
        service = FakeService(9, page=8, too_big=(4, 2))
        with mock.patch("sys.stdout", io.StringIO()):
            self.assertEqual(fh.fetch(self.out, fh.RASTER_FIELDS, 9, service), 9)
        doc = json.loads(self.out.read_text())
        self.assertEqual(len(doc["features"]), 9)

    def test_an_unreachable_service_fails_without_halving(self):
        # Mutation: halve on every error and an outage takes ten halvings,
        # each with its retries, to fail.
        service = FakeService(5)
        service.down = urllib.error.URLError("Name or service not known")
        with (
            mock.patch("sys.stdout", io.StringIO()),
            self.assertRaises(urllib.error.URLError),
        ):
            fh.fetch(self.out, fh.RASTER_FIELDS, 5, service)
        self.assertEqual(service.page_requests, 1)

    def test_a_short_read_fails(self):
        # Mutation: drop fetch()'s count check and a partial read builds.
        service = FakeService(5, page=2)
        service.features.pop()
        with mock.patch("sys.stdout", io.StringIO()), self.assertRaises(SystemExit):
            fh.fetch(self.out, fh.RASTER_FIELDS, 5, service)
        self.assertEqual(list(Path(self.dir.name).iterdir()), [])

    def test_a_server_ignoring_the_offset_stops_and_fails(self):
        # Mutation: drop the `not new` stop and this never returns.
        service = FakeService(5, page=2, ignores_offset=True)
        with mock.patch("sys.stdout", io.StringIO()), self.assertRaises(SystemExit):
            fh.fetch(self.out, fh.RASTER_FIELDS, 5, service)
        self.assertEqual(len(service.offsets), 2)


class FakeS3:
    def __init__(self, legend=None):
        self.legend = legend
        self.uploads = []

    def list_objects_v2(self, Bucket, Prefix, MaxKeys):
        return {"KeyCount": 0 if self.legend is None else 1}

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(json.dumps(self.legend).encode())}

    def upload_file(self, path, bucket, key):
        self.uploads.append(key)

    def put_object(self, Bucket, Key, Body, ContentType):
        self.uploads.append(Key)


class TestPublish(unittest.TestCase):
    """The monthly task's decision: upload, skip or refuse."""

    def _publish(self, s3, service, valid=100):
        def fake_build(src, tif, source):
            return {"source": source, "valid_feature_count": valid}

        with (
            mock.patch.object(fh, "build", side_effect=fake_build) as build,
            mock.patch("sys.stdout", io.StringIO()),
        ):
            fh.publish("bucket", s3, service)
        return build

    def test_a_new_source_uploads_the_raster_then_its_legend(self):
        # Mutation: upload the legend first, and a failed raster upload
        # leaves a legend that makes next month's run skip the stale raster.
        s3 = FakeS3()
        self._publish(s3, FakeService(3))
        self.assertEqual(s3.uploads, [fh.RASTER_KEY, fh.LEGEND_KEY])

    def test_an_unchanged_source_uploads_nothing(self):
        # Mutation: drop the comparison with the published legend.
        service = FakeService(3)
        s3 = FakeS3({"source": fh.source_state(service), "valid_feature_count": 100})
        build = self._publish(s3, service)
        build.assert_not_called()
        self.assertEqual(service.offsets, [])
        self.assertEqual(s3.uploads, [])

    def test_a_new_polygon_rebuilds(self):
        # Mutation: leave the count out of source_state().
        s3 = FakeS3(
            {"source": fh.source_state(FakeService(3)), "valid_feature_count": 100}
        )
        self._publish(s3, FakeService(4))
        self.assertEqual(s3.uploads, [fh.RASTER_KEY, fh.LEGEND_KEY])

    def test_a_change_in_any_latest_date_alone_rebuilds(self):
        # Mutation: drop a field from DATE_FIELDS (or compare only the count)
        # and an edit that moves only that date is skipped.
        for field in ("StartDate", "EndDate", "VerDate"):
            with self.subTest(field=field):
                s3 = FakeS3(
                    {
                        "source": fh.source_state(FakeService(3)),
                        "valid_feature_count": 100,
                    }
                )
                self._publish(s3, FakeService(3, latest={field: 1572652800000}))
                self.assertEqual(s3.uploads, [fh.RASTER_KEY, fh.LEGEND_KEY])

    def test_a_short_read_uploads_nothing(self):
        # Mutation: drop fetch()'s count check and the partial read uploads.
        s3 = FakeS3()
        service = FakeService(3, counted=4)
        with self.assertRaises(SystemExit):
            self._publish(s3, service)
        self.assertEqual(s3.uploads, [])

    def test_a_much_smaller_build_uploads_nothing(self):
        # Mutation: drop the MIN_VALID_RATIO check.
        s3 = FakeS3({"source": {}, "valid_feature_count": 100})
        with self.assertRaises(SystemExit):
            self._publish(s3, FakeService(3), valid=89)
        self.assertEqual(s3.uploads, [])


class TestGridCeiling(unittest.TestCase):
    def test_a_grid_far_larger_than_nsw_stops_before_allocating(self):
        # Mutation: drop the MAX_CELLS check and a stray polygon sizes the
        # in-memory raster past the task's memory.
        with self.assertRaises(SystemExit):
            fh.rasterize_max_year(None, {2019}, (0, 4e6, -5e6, 0), None, "x.tif")


class TestRasterKey(unittest.TestCase):
    def test_the_pipeline_reads_where_publish_writes(self):
        # Mutation: change RASTER_KEY or FIRE_HISTORY_S3_PATH's default alone.
        src = (Path(__file__).parent.parent / "pipeline.py").read_text()
        default = re.search(r'"FIRE_HISTORY_S3_PATH",\s*"([^"]+)"', src).group(1)
        self.assertEqual(default, f"s3://logjam-topo-jobs/{fh.RASTER_KEY}")


if __name__ == "__main__":
    unittest.main()
