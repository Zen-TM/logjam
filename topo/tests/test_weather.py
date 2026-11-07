"""The weather builder: the grid it samples, the steps and totals it keeps,
what a request may hold, the files it writes and the order it publishes them.

shared/src/weatherMap.ts reads the two fixtures in shared/src/__fixtures__/
this test writes (weather-latest.json, weather-wind.json); it fails when the
builder stops writing them and weatherMap.test.ts fails when the reader stops
understanding them. After a deliberate format change, regenerate them with
REGENERATE_FIXTURE=1 (then `npm run format`) and bump the format on both sides.

Pure Python: the reader and S3 are faked, nothing touches the network.
"""

import gzip
import io
import json
import os
import re
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: E402,F401  (osgeo, for build_nsw_dem's encoder)

import numpy as np  # noqa: E402

import build_weather as w  # noqa: E402

_HERE = os.path.dirname(__file__)
_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
_FIXTURES = os.path.join(_ROOT, "shared", "src", "__fixtures__")
_SHARED_TS = os.path.join(_ROOT, "shared", "src", "weatherMap.ts")

RUN = datetime(2026, 11, 7, 0, 0, tzinfo=timezone.utc)
NOW = datetime(2026, 11, 7, 6, 40, tzinfo=timezone.utc)
# A small box keeps the fixtures small; the build is the same at any size.
SMALL_BOX = (149.0, -35.0, 151.0, -33.0)


def ifs_valid_times(run=RUN):
    """IFS's steps: hourly to 90 h, 3-hourly to 144 h, 6-hourly to 360 h."""
    hours = list(range(0, 91)) + list(range(93, 145, 3)) + list(range(150, 361, 6))
    return [run + timedelta(hours=h) for h in hours]


def latest_json(run=RUN):
    return {
        "completed": True,
        "crs_wkt": 'GEOGCRS["Reduced Gaussian Grid", REMARK["Reduced Gaussian Grid O1280 (ECMWF)"]]',
        "reference_time": run.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "valid_times": [t.strftime("%Y-%m-%dT%H:%MZ") for t in ifs_valid_times(run)],
        "variables": list(w.VARIABLES) + ["cape"],
    }


class FakeRead:
    """Each variable as a known function of the grid point, by file."""

    def __init__(self, cut, missing=()):
        nx, _, lat = w.grid_lines()
        lines = np.repeat(cut.lines, cut.count)
        x = np.concatenate([np.arange(f, f + c) for f, c in zip(cut.first, cut.count)])
        self.lon = x * 360.0 / nx[lines]
        self.lat = lat[lines]
        self.paths = []
        self.missing = set(missing)

    def __call__(self, path, names):
        self.paths.append(path)
        if path in self.missing:
            raise w.Missing(path)
        # Rain of 1 mm in every hour of the file's step, so a total counts hours.
        hours = 1 if path.split("/")[-1] <= "2026-11-10T1800.om" else 3
        return {
            "precipitation": np.full(self.lon.size, float(hours)),
            "temperature_2m": self.lon / 10 + self.lat,
            "wind_u_component_10m": np.full(self.lon.size, 5.0),
            "wind_v_component_10m": np.zeros(self.lon.size),
            "wind_gusts_10m": np.full(self.lon.size, 10.0),
        }


class TestGrid(unittest.TestCase):
    def test_o1280_has_the_points_open_meteo_stores(self):
        nx, start, lat = w.grid_lines()
        self.assertEqual(int(nx.sum()), w.GRID_POINTS)
        self.assertEqual(w.GRID_POINTS, 6_599_680)
        self.assertEqual(int(nx[0]), 20)
        self.assertEqual(int(nx[w.GRID_N - 1]), int(nx[w.GRID_N]))
        self.assertGreater(lat[0], 89.9)
        self.assertLess(lat[-1], -89.9)
        self.assertEqual(int(start[1]), 20)

    def test_bilinear_is_exact_on_a_plane(self):
        # Mutation: swap a line's weights (wy for 1 - wy, or wx for 1 - wx)
        # and the samples move off the plane.
        cut = w.box_cut(SMALL_BOX)
        fake = FakeRead(cut)
        plane = fake.lon * 2 + fake.lat * 5
        lon = np.array([149.0, 150.123, 150.987, 151.0])
        lat = np.array([-33.0, -34.321, -33.555, -35.0])
        idx, weights = w.sample_weights(cut, lon, lat)
        np.testing.assert_allclose(
            w.regrid(plane, idx, weights), lon * 2 + lat * 5, atol=1e-9
        )
        np.testing.assert_allclose(weights.sum(axis=0), 1.0)

    def test_the_four_tiles_cover_the_box(self):
        self.assertEqual(w.tiles_over(), [(28, 18), (29, 18), (28, 19), (29, 19)])


class TestTime(unittest.TestCase):
    def test_steps_run_from_the_anchor_with_the_hours_each_covers(self):
        anchor = w.anchor_of(NOW)
        steps = w.forecast_steps(ifs_valid_times(), RUN, anchor)
        self.assertEqual(steps[0], (RUN + timedelta(hours=6), 1))
        hours = dict((round((t - RUN).total_seconds() / 3600), h) for t, h in steps)
        self.assertEqual(hours[90], 1)
        self.assertEqual(hours[93], 3)
        self.assertEqual(hours[150], 6)
        self.assertEqual(max(hours), 168)

    def test_a_past_hour_comes_from_the_run_just_before_it(self):
        sources = w.past_sources(datetime(2026, 11, 6, 7, tzinfo=timezone.utc))
        self.assertEqual(sources[0], datetime(2026, 11, 6, 6, tzinfo=timezone.utc))
        self.assertEqual(len(sources), 3)
        # Its sixth hour, not the next run's zeroth.
        self.assertEqual(
            w.past_sources(datetime(2026, 11, 6, 6, tzinfo=timezone.utc))[0],
            datetime(2026, 11, 6, 0, tzinfo=timezone.utc),
        )

    def test_urls_hold_only_the_model_and_times(self):
        # Mutation: put anything else in a path (a box, a user's spot) and
        # it fails the pattern.
        fake = FakeRead(w.box_cut(SMALL_BOX))
        with tempfile.TemporaryDirectory() as tmp:
            w.build(latest_json(), NOW, Path(tmp), fake, SMALL_BOX)
        pattern = re.compile(r"^\d{4}/\d{2}/\d{2}/\d{4}Z/\d{4}-\d{2}-\d{2}T\d{4}\.om$")
        self.assertTrue(fake.paths)
        for path in fake.paths:
            self.assertRegex(path, pattern)
        self.assertEqual(
            w.SOURCE_URL, "https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/"
        )


class TestFields(unittest.TestCase):
    def test_wind_from_the_west_blows_from_270(self):
        cut = w.box_cut(SMALL_BOX)
        plan = w.plan(SMALL_BOX)
        n = int(cut.count.sum())
        arrows = w.wind_arrows(
            plan,
            {
                "wind_u_component_10m": np.full(n, 5.0),
                "wind_v_component_10m": np.zeros(n),
            },
        )
        self.assertEqual(set(arrows["from"]), {270})
        self.assertEqual(set(arrows["speed"]), {18})
        north = w.wind_arrows(
            plan,
            {
                "wind_u_component_10m": np.zeros(n),
                "wind_v_component_10m": np.full(n, 5.0),
            },
        )
        self.assertEqual(set(north["from"]), {180})

    def test_rain_is_a_rate_over_the_step(self):
        n = 3
        fields = w.step_fields(
            {
                "precipitation": np.full(n, 6.0),
                "temperature_2m": np.zeros(n),
                "wind_u_component_10m": np.full(n, 3.0),
                "wind_v_component_10m": np.full(n, 4.0),
                "wind_gusts_10m": np.full(n, 10.0),
            },
            3,
        )
        np.testing.assert_allclose(fields["rain"], 2.0)
        np.testing.assert_allclose(fields["wind"], 18.0)
        np.testing.assert_allclose(fields["gusts"], 36.0)


class TestTotals(unittest.TestCase):
    def test_a_total_missing_an_hour_is_left_out(self):
        # Mutation: drop the every-hour check and a gap reads as a dry hour,
        # a short total drawn as a whole one.
        anchor = w.anchor_of(NOW)
        past = {anchor - timedelta(hours=h): np.ones(1) for h in range(168)}
        del past[anchor - timedelta(hours=30)]
        totals = w.totals_from(anchor, {}, past)
        self.assertEqual(sorted(totals), ["rainPast24"])
        np.testing.assert_allclose(totals["rainPast24"], 24)

    def test_next_totals_sum_the_steps_after_the_anchor(self):
        anchor = w.anchor_of(NOW)
        steps = w.forecast_steps(ifs_valid_times(), RUN, anchor)
        rain = {t: (h, np.full(1, float(h))) for t, h in steps}
        totals = w.totals_from(anchor, rain, {})
        np.testing.assert_allclose(totals["rainNext24"], 24)
        np.testing.assert_allclose(totals["rainNext72"], 72)

    def test_a_past_hour_falls_back_to_an_older_run(self):
        cut = w.box_cut(SMALL_BOX)
        gone = w.step_path(
            datetime(2026, 11, 6, 12, tzinfo=timezone.utc),
            datetime(2026, 11, 6, 15, tzinfo=timezone.utc),
        )
        fake = FakeRead(cut, missing={gone})
        with tempfile.TemporaryDirectory() as tmp:
            manifest = w.build(latest_json(), NOW, Path(tmp), fake, SMALL_BOX)
        self.assertIn(
            w.step_path(
                datetime(2026, 11, 6, 6, tzinfo=timezone.utc),
                datetime(2026, 11, 6, 15, tzinfo=timezone.utc),
            ),
            fake.paths,
        )
        self.assertIn("rainPast72", manifest["totals"])


class TestBuild(unittest.TestCase):
    def build(self, tmp):
        fake = FakeRead(w.box_cut(SMALL_BOX))
        return w.build(latest_json(), NOW, Path(tmp), fake, SMALL_BOX)

    def test_a_tile_decodes_to_the_regridded_value(self):
        from PIL import Image
        from pmtiles.reader import MmapSource, Reader
        from pmtiles.tile import zxy_to_tileid  # noqa: F401

        import build_nsw_dem

        with tempfile.TemporaryDirectory() as tmp:
            manifest = self.build(tmp)
            path = Path(tmp) / manifest["path"] / "temperature" / "000.pmtiles"
            with open(path, "rb") as f:
                reader = Reader(MmapSource(f))
                self.assertEqual(reader.header()["min_zoom"], w.ZOOM)
                self.assertEqual(reader.metadata()["attribution"], w.ATTRIBUTION)
                png = reader.get(w.ZOOM, 29, 19)
        heights = build_nsw_dem.decode_terrarium(
            np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))
        )
        lon, lat = w.tile_pixels(29, 19)
        lon, lat = lon.reshape(256, 256), lat.reshape(256, 256)
        inside = (lon >= 149) & (lon <= 151) & (lat >= -35) & (lat <= -33)
        # Within half the rounding (0.5°), and a little for the PNG round trip.
        np.testing.assert_allclose(heights[inside], (lon / 10 + lat)[inside], atol=0.26)
        self.assertTrue(np.isnan(heights[~inside]).all())

    def test_the_build_matches_the_fixtures(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = self.build(tmp)
            wind = json.loads((Path(tmp) / manifest["path"] / "wind.json").read_text())
            folder = Path(tmp) / manifest["path"]
            for field in w.FIELDS:
                self.assertEqual(
                    len(list((folder / field.key).iterdir())), len(manifest["steps"])
                )
            self.assertEqual(
                sorted(p.stem for p in (folder / "totals").iterdir()),
                sorted(manifest["totals"]),
            )
        self.assertEqual(manifest["totals"], list(w.TOTALS))
        self.assertEqual(len(wind["steps"]), len(manifest["steps"]))
        # Two steps of arrows are enough to read; the rest are the same.
        wind["steps"] = wind["steps"][:2]
        for name, doc in (
            ("weather-latest.json", manifest),
            ("weather-wind.json", wind),
        ):
            path = os.path.join(_FIXTURES, name)
            if os.environ.get("REGENERATE_FIXTURE"):
                with open(path, "w") as f:
                    json.dump(doc, f, indent=2)
                    f.write("\n")
            with open(path) as f:
                self.assertEqual(
                    json.load(f),
                    doc,
                    f"{name}: REGENERATE_FIXTURE=1 after a deliberate change",
                )

    def test_the_prefix_and_format_match_shared(self):
        with open(_SHARED_TS) as f:
            ts = f.read()
        self.assertIn(f"export const WEATHER_MAP_FORMAT = {w.FORMAT};", ts)
        self.assertEqual(w.S3_PREFIX, f"master/weather/v{w.FORMAT}/")
        self.assertIn("prefix: `master/weather/v${WEATHER_MAP_FORMAT}/`", ts)
        for key in w.TOTALS:
            self.assertIn(f'key: "{key}"', ts)
        for field in w.FIELDS:
            self.assertIn(f'key: "{field.key}"', ts)

    def test_an_incomplete_or_regridded_run_is_refused(self):
        with self.assertRaises(SystemExit):
            w.check_source({**latest_json(), "completed": False})
        with self.assertRaises(SystemExit):
            w.check_source({**latest_json(), "crs_wkt": "GEOGCRS[regular 0.1]"})
        with self.assertRaises(SystemExit):
            w.check_source({**latest_json(), "variables": ["precipitation"]})


class FakeS3:
    def __init__(self, objects=None):
        self.objects = dict(objects or {})
        self.puts = []
        self.deleted = []

    def list_objects_v2(self, Bucket, Prefix, MaxKeys=1000):
        keys = [k for k in self.objects if k.startswith(Prefix)][:MaxKeys]
        return {"KeyCount": len(keys), "Contents": [{"Key": k} for k in keys]}

    def get_paginator(self, _name):
        s3 = self

        class Pages:
            def paginate(self, Bucket, Prefix):
                return [s3.list_objects_v2(Bucket, Prefix)]

        return Pages()

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, **kw):
        self.puts.append((Key, kw))
        self.objects[Key] = Body

    def delete_objects(self, Bucket, Delete):
        for obj in Delete["Objects"]:
            self.deleted.append(obj["Key"])
            del self.objects[obj["Key"]]


class TestPublish(unittest.TestCase):
    def manifest_bytes(self, run, path):
        return gzip.compress(json.dumps({"run": run, "path": path}).encode())

    def test_the_manifest_goes_up_last_and_two_runs_are_kept(self):
        # Mutation: upload latest.json first, or prune the run before, and a
        # client mid-switch asks for files that aren't there.
        old = w.S3_PREFIX + "runs/20261106T1800Z/rain/000.pmtiles"
        older = w.S3_PREFIX + "runs/20261106T1200Z/rain/000.pmtiles"
        s3 = FakeS3(
            {
                w.S3_PREFIX + "latest.json": self.manifest_bytes(
                    "2026-11-06T18:00Z", "runs/20261106T1800Z/"
                ),
                old: b"x",
                older: b"x",
            }
        )
        cut = w.box_cut(SMALL_BOX)
        real_build = w.build
        try:
            w.build = lambda latest, now, out: real_build(
                latest, now, out, FakeRead(cut), SMALL_BOX
            )
            w.run(
                "bucket",
                s3=s3,
                get=lambda _url: json.dumps(latest_json()).encode(),
                now=NOW,
            )
        finally:
            w.build = real_build
        keys = [k for k, _ in s3.puts]
        self.assertEqual(keys[-1], w.S3_PREFIX + "latest.json")
        self.assertTrue(
            all(k.startswith(w.S3_PREFIX + "runs/20261107T0000Z/") for k in keys[:-1])
        )
        self.assertIn(old, s3.objects)
        self.assertEqual(s3.deleted, [older])
        wind = dict(s3.puts)[w.S3_PREFIX + "runs/20261107T0000Z/wind.json"]
        self.assertEqual(wind["ContentEncoding"], "gzip")

    def test_a_published_run_is_not_built_again(self):
        s3 = FakeS3(
            {
                w.S3_PREFIX + "latest.json": self.manifest_bytes(
                    "2026-11-07T00:00Z", "runs/20261107T0000Z/"
                )
            }
        )
        w.run(
            "bucket",
            s3=s3,
            get=lambda _url: json.dumps(latest_json()).encode(),
            now=NOW,
        )
        self.assertEqual(s3.puts, [])


class TestLicenceBoundary(unittest.TestCase):
    def test_open_meteos_reader_is_in_the_worker_image_only(self):
        # ADR 0048: the reader is GPL-2.0-only and Logjam is AGPL-3.0-only, so
        # it is never shipped to a user. Mutation: add `@openmeteo/file-reader`
        # to a client's package.json, or `omfiles` to another requirements
        # file, and this fails.
        found = []
        for dirpath, dirnames, filenames in os.walk(_ROOT):
            dirnames[:] = [
                d
                for d in dirnames
                if d
                not in (
                    "node_modules",
                    ".git",
                    "private",
                    "dist",
                    "build",
                    ".venv",
                    "venv",
                )
            ]
            for name in filenames:
                if name in ("package.json", "package-lock.json") or (
                    name.startswith("requirements") and name.endswith(".txt")
                ):
                    path = os.path.join(dirpath, name)
                    with open(path, encoding="utf-8") as f:
                        text = f.read()
                    if "@openmeteo/" in text or re.search(r"^omfiles\b", text, re.M):
                        found.append(os.path.relpath(path, _ROOT))
        self.assertEqual(found, ["topo/requirements.txt"])


if __name__ == "__main__":
    unittest.main()
