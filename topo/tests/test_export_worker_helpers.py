"""export_worker.py pure helpers: what a failed export tells its owner, and
that an area export's box stays out of the log.

export_worker.py reads required env vars and creates a boto3 client at import
time, so we set placeholder env before importing. boto3/psycopg2 are stubbed by
_native_stub when absent on the host.

Privacy boundary: a RenderError's message embeds raw subprocess stderr from
ogr2ogr / gdal_translate / tippecanoe, which carries temp dirs (/tmp/export_*)
and internal paths. The owner reads `failure_sentence` in both clients and in
the email, and it never holds the exception's text.
Mutation that turns this red: return `str(error)` from `failure_sentence`.
"""

import os
import re
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

os.environ.setdefault("S3_BUCKET_TOPO", "test-bucket")
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "test")
os.environ.setdefault("DB_USER", "test")
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("EXPORT_JOB_ID", "export-123")

import export_worker  # noqa: E402
import regions  # noqa: E402
from area_export import AreaOutsideTerrain  # noqa: E402
from export_worker import GENERIC_FAILURE, failure_sentence  # noqa: E402
from renderers.context import ExportTooLarge, RenderError  # noqa: E402


class TestFailureSentence(unittest.TestCase):
    def test_a_render_failure_shows_none_of_its_stderr(self):
        error = RenderError(
            "tippecanoe (features) failed:\nerror writing /tmp/export_abc/foo.tif"
        )
        self.assertEqual(failure_sentence(error), GENERIC_FAILURE)

    def test_an_unexpected_failure_shows_none_of_itself(self):
        self.assertEqual(
            failure_sentence(OSError("/app/work/x.geojson not found")),
            GENERIC_FAILURE,
        )

    # There is no support to contact. Mutation: put "contact support" back in
    # GENERIC_FAILURE.
    def test_the_generic_sentence_sends_no_one_to_support(self):
        self.assertNotIn("support", GENERIC_FAILURE.lower())

    # Logjam Web offers Report a bug beside exactly this sentence
    # (areaExportFailed()). Mutation: reword one copy only, and the button
    # vanishes from the failures it is for.
    def test_the_generic_sentence_matches_shared(self):
        src = (
            Path(__file__).resolve().parents[2] / "shared" / "src" / "areaExport.ts"
        ).read_text()
        match = re.search(
            r"function areaExportFailed\(\): UserSentence \{\s*return say`([^`]*)`",
            src,
        )
        self.assertIsNotNone(match, "areaExportFailed() not found in areaExport.ts")
        self.assertEqual(match.group(1), GENERIC_FAILURE)

    def test_too_large_says_what_to_do(self):
        sentence = failure_sentence(ExportTooLarge("would generate over 9 map tiles"))
        self.assertIn("smaller", sentence)
        self.assertNotIn("tiles", sentence)

    # Mutation: map an AreaExportError to GENERIC_FAILURE whatever it is, and
    # a box in Victoria reads as a fault worth retrying.
    def test_outside_terrain_says_what_to_do(self):
        self.assertEqual(
            failure_sentence(AreaOutsideTerrain("no heights tiles in the box")),
            AreaOutsideTerrain.SENTENCE,
        )


class TestAreaBoxNeverLogged(unittest.TestCase):
    # Mutation: put `bbox` in render_area_export's log line, and an export's
    # box (where someone means to go) is in the worker's log.
    def test_the_box_is_in_no_log_line(self):
        row = {
            "bbox": {
                "west": 150.123457,
                "south": -33.765432,
                "east": 150.2,
                "north": -33.7,
            },
            "format": "gpkg",
            "layers": ["heights", "contours"],
            "vector_style_snapshot": {},
            "source_job_ids": [],
        }
        with (
            mock.patch.object(export_worker, "render_area") as render,
            mock.patch.object(export_worker, "s3_archives"),
            mock.patch.object(
                regions, "export_region", return_value=regions.region("nsw")
            ),
            self.assertLogs("export_worker", level="DEBUG") as logs,
        ):
            export_worker.render_area_export(mock.Mock(), row, Path("/work"))
        self.assertEqual(
            render.call_args.args[1], (150.123457, -33.765432, 150.2, -33.7)
        )
        for line in logs.output:
            for number in ("150.12", "33.76", "150.2", "33.7"):
                self.assertNotIn(number, line)


class TestSharpenedAreasInTheApisOrder(unittest.TestCase):
    # Mutation: return the rows in the database's order, and where two areas
    # overlap the file draws the one the map doesn't (the API sends them in
    # the router's order). Or keep a row this build can't read.
    def test_keeps_the_given_order_and_drops_what_is_not_an_area(self):
        def row(job_id):
            keys = {k: f"outputs/{job_id}/{k}.pmtiles" for k in ("heights", "slope")}
            return {
                "id": job_id,
                "sharpen": {
                    "v": 1, "zmax": 16, "tiles15": [0, 0, 1, 1],
                    "coverage": [0.0, 0.0, 1.0, 1.0], "credit": "c", "keys": keys,
                },
                "footprint": None,
            }  # fmt: skip

        cursor = mock.MagicMock()
        cursor.fetchall.return_value = [
            row("b"),
            row("a"),
            {"id": "c", "sharpen": None},
        ]
        conn = mock.MagicMock()
        conn.cursor.return_value.__enter__.return_value = cursor
        areas = export_worker.get_sharpened_areas(conn, ["a", "c", "b", "gone"])
        self.assertEqual([a.id for a in areas], ["a", "b"])


class TestAreaExportGrid(unittest.TestCase):
    ROW = {
        "bbox": {"west": 168.6, "south": -44.7, "east": 168.7, "north": -44.6},
        "format": "geotiff",
        "layers": ["heights"],
        "vector_style_snapshot": {},
        "source_job_ids": [],
    }

    def epsg_passed(self, bbox):
        with (
            mock.patch.object(export_worker, "render_area") as render,
            mock.patch.object(export_worker, "s3_archives"),
            mock.patch.object(
                regions, "export_region", return_value=regions.region("nsw")
            ),
        ):
            export_worker.render_area_export(
                mock.Mock(), {**self.ROW, "bbox": bbox}, Path("/work")
            )
        return render.call_args.kwargs["epsg"]

    # Mutation: leave `epsg` out of the render_area call, and an export in
    # New Zealand is warped to the zone area_export.py guesses from its
    # longitude.
    def test_the_grid_the_api_stored_with_the_box_reaches_the_render(self):
        self.assertEqual(self.epsg_passed({**self.ROW["bbox"], "epsg": 2193}), 2193)

    # Mutation: read `bbox["epsg"]`, and a job an older API queued fails.
    def test_a_job_queued_before_the_api_named_a_grid_passes_none(self):
        self.assertIsNone(self.epsg_passed(self.ROW["bbox"]))


class TestAreaExportRegion(unittest.TestCase):
    """The archives an export reads are its box's region's."""

    ROW = {
        "format": "geotiff",
        "layers": ["heights"],
        "vector_style_snapshot": {},
        "source_job_ids": [],
    }

    def render(self, box, every=None):
        west, south, east, north = box
        row = {
            **self.ROW,
            "bbox": {"west": west, "south": south, "east": east, "north": north},
        }
        with (
            mock.patch.object(export_worker, "render_area") as render,
            mock.patch.object(export_worker, "s3_archives") as archives,
            mock.patch.object(
                regions, "REGIONS", regions.REGIONS if every is None else every
            ),
        ):
            export_worker.render_area_export(mock.Mock(), row, Path("/work"))
        return archives, render

    # Mutation: pass a fixed region (read `region("nsw")`) in place of the box's,
    # and a box over New Zealand reads New South Wales's archives.
    def test_a_box_reads_the_archives_of_the_region_it_is_in(self):
        env = {"SIM_REGIONS": "1", "DB_HOST": "postgres"}
        with mock.patch.dict(os.environ, env, clear=True):
            loaded = regions._load()
        archives, render = self.render((169.22, -44.08, 169.24, -44.06), loaded)
        self.assertEqual(archives.call_args.args[2]["id"], "simnz")
        self.assertEqual(render.call_args.kwargs["top_zoom"], 17)

    # A box over New South Wales exports what it did before regions: the same
    # archives (area_export.py `region_keys`, pinned in test_area_export.py
    # `NswExportUnchanged`), z15 and the grid the API named.
    # Mutation: leave `top_zoom` out of the render_area call, and a region
    # whose archives go deeper than z15 is read at z15.
    def test_a_box_over_nsw_is_read_from_nsw_at_z15(self):
        archives, render = self.render((150.30, -33.72, 150.32, -33.70))
        self.assertEqual(archives.call_args.args[2]["id"], "nsw")
        self.assertEqual(render.call_args.kwargs["top_zoom"], 15)

    # Mutation: read the archives of "no region" as NSW's, and a box in
    # Victoria is exported from archives that hold none of its ground.
    def test_a_box_no_region_touches_is_refused_with_the_sentence(self):
        with self.assertRaises(AreaOutsideTerrain) as raised:
            self.render((144.2, -36.8, 144.3, -36.7))
        self.assertEqual(
            failure_sentence(raised.exception), AreaOutsideTerrain.SENTENCE
        )


if __name__ == "__main__":
    unittest.main()
