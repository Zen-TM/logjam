"""PDAL pipeline JSON construction (pure dict building; no PDAL run)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

try:
    from pipeline import (  # noqa: E402
        PDAL_SCAN_ANGLE_MAX,
        SCRUB_BAND_MAX_M,
        SCRUB_STRATUM_LOW_MAX_M,
        build_pipeline_full,
    )

    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc


def _stages_of_type(pipeline, type_name):
    return [s for s in pipeline if isinstance(s, dict) and s.get("type") == type_name]


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestBuildPipelineFull(unittest.TestCase):
    def setUp(self):
        self.p = build_pipeline_full(
            ["a.laz", "b.laz"],
            "dtm.tif",
            "scrub_low.tif",
            "scrub_high.tif",
            "below.tif",
            "all.tif",
            resolution=0.5,
            ground="smrf",
        )["pipeline"]

    def test_one_reader_per_input(self):
        readers = _stages_of_type(self.p, "readers.las")
        self.assertEqual([r["filename"] for r in readers], ["a.laz", "b.laz"])

    def test_no_point_reprojection_rasterizes_native(self):
        # Rasters are produced in the LAZ's native CRS; reprojection happens
        # later as a raster warp (reproject_raster_to_web_mercator). Reprojecting
        # points here would rasterize a rotated quad into an axis-aligned grid →
        # edge wedges of no data.
        self.assertEqual(_stages_of_type(self.p, "filters.reprojection"), [])

    def test_drops_asprs_noise_and_overlap_before_smrf(self):
        rng = _stages_of_type(self.p, "filters.range")[0]
        self.assertIn("Classification![7:7]", rng["limits"])
        self.assertIn("Classification![12:12]", rng["limits"])
        self.assertIn("Classification![18:18]", rng["limits"])
        # range must come before assign/smrf so codes survive the wipe.
        types = [s["type"] for s in self.p]
        self.assertLess(types.index("filters.range"), types.index("filters.assign"))
        self.assertLess(types.index("filters.assign"), types.index("filters.smrf"))

    def test_uses_smrf_and_hag_nn(self):
        self.assertEqual(len(_stages_of_type(self.p, "filters.smrf")), 1)
        self.assertEqual(len(_stages_of_type(self.p, "filters.hag_nn")), 1)

    # Red if a survey with class 2 still has its classes wiped and SMRF run:
    # on a classified survey SMRF reads canopy as ground (sharpen.py's rule),
    # so heights above ground come out low under trees.
    def test_class2_ground_keeps_the_survey_classes(self):
        p = build_pipeline_full(
            ["a.laz"],
            "dtm.tif",
            "lo.tif",
            "hi.tif",
            "below.tif",
            "all.tif",
            ground="class2",
        )["pipeline"]
        types = [s["type"] for s in p]
        self.assertNotIn("filters.assign", types)
        self.assertNotIn("filters.smrf", types)
        # Noise and overlap still go first; height above ground still runs.
        self.assertLess(types.index("filters.range"), types.index("filters.hag_nn"))

    def test_five_gdal_writers_with_resolution(self):
        writers = _stages_of_type(self.p, "writers.gdal")
        self.assertEqual(len(writers), 5)
        for w in writers:
            self.assertEqual(w["resolution"], 0.5)
            self.assertEqual(w["gdalopts"], "COMPRESS=LZW")
            self.assertEqual(
                w["output_type"], "count" if w["filename"] != "dtm.tif" else "mean"
            )
            self.assertEqual(w["nodata"], 0 if w["filename"] != "dtm.tif" else -9999)

    def test_dtm_writer_is_mean_of_ground(self):
        dtm = next(
            w
            for w in _stages_of_type(self.p, "writers.gdal")
            if w["filename"] == "dtm.tif"
        )
        self.assertEqual(dtm["output_type"], "mean")
        self.assertEqual(dtm["where"], "Classification == 2")

    def test_count_writers_height_bands_and_scan_gate(self):
        writers = {w["filename"]: w for w in _stages_of_type(self.p, "writers.gdal")}
        scrub_low = writers["scrub_low.tif"]
        scrub_high = writers["scrub_high.tif"]
        below = writers["below.tif"]
        all_count = writers["all.tif"]

        self.assertIn("HeightAboveGround >= 0.25", scrub_low["where"])
        self.assertIn(
            f"HeightAboveGround < {SCRUB_STRATUM_LOW_MAX_M}", scrub_low["where"]
        )
        self.assertIn(
            f"HeightAboveGround >= {SCRUB_STRATUM_LOW_MAX_M}", scrub_high["where"]
        )
        self.assertIn(f"HeightAboveGround <= {SCRUB_BAND_MAX_M}", scrub_high["where"])
        self.assertIn("HeightAboveGround < 0.25", below["where"])
        # all.tif carries no HAG filter at all — every return counts.
        self.assertNotIn("HeightAboveGround", all_count["where"])

        # All four count rasters carry the ±scan-angle gate; the DTM does not.
        gate = f"ScanAngleRank >= -{PDAL_SCAN_ANGLE_MAX}"
        for w in (scrub_low, scrub_high, below, all_count):
            self.assertIn(gate, w["where"])


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestGroundPerTile(unittest.TestCase):
    """Each point cloud is grounded on its own: class 2 where it has it, SMRF
    where it has none. Made-up tiles, no PDAL run.

    Red if one ground is chosen for the whole job: a ZIP mixing a classified
    tile with an unclassified one (a water-only tile, a second survey) then
    either runs height above ground on a tile with no ground points, which
    fails the job, or wipes the survey's classes everywhere. Red too if the
    tiles are gridded one a CPU whatever their size (eight dense tiles at
    once run the task out of memory), by the first tile's size instead of
    the largest's, or one at a time when several fit."""

    def grid(self, points, memory):
        """run_pdal_per_tile on two made-up tiles with PDAL mocked. Returns
        (the pipelines run, how many at a time)."""
        import tempfile
        from concurrent.futures import ThreadPoolExecutor
        from unittest import mock

        import pipeline

        run = mock.Mock()
        pools = []

        def pool(n):
            pools.append(n)
            return ThreadPoolExecutor(n)

        with (
            tempfile.TemporaryDirectory() as work,
            mock.patch.object(
                pipeline, "has_class2", side_effect=lambda p: p == "classified.laz"
            ),
            mock.patch.object(pipeline, "point_count", side_effect=points.get),
            mock.patch.object(pipeline, "available_memory", return_value=memory),
            mock.patch.object(pipeline, "ThreadPoolExecutor", side_effect=pool),
            mock.patch.object(pipeline, "run_pdal_pipeline", run),
            mock.patch.object(pipeline, "_merge_raster_tiles"),
            mock.patch.object(pipeline.os, "remove"),
        ):
            pipeline.run_pdal_per_tile(
                list(points),
                list(points),
                *(os.path.join(work, f"{n}.tif") for n in "abcde"),
                work,
                workers=8,
            )
        return [c.args[0] for c in run.call_args_list], pools[0]

    def test_a_mixed_tile_set_grounds_each_tile_on_its_own(self):
        pipelines, _ = self.grid(
            {"classified.laz": 1_000_000, "unclassified.laz": 1_000_000}, 2**34
        )
        smrf = {
            next(
                s["filename"] for s in p["pipeline"] if s.get("type") == "readers.las"
            ): bool(_stages_of_type(p["pipeline"], "filters.smrf"))
            for p in pipelines
        }
        self.assertEqual(smrf, {"classified.laz": False, "unclassified.laz": True})

    def test_as_many_tiles_at_a_time_as_the_largest_fits_in_memory_with(self):
        import pipeline

        per_point = pipeline.GRID_BYTES_PER_POINT
        self.assertGreater(per_point, 0)
        tiles = {"classified.laz": 1_000_000, "unclassified.laz": 50_000_000}
        # Room for three of the largest in the share of memory the tiles get.
        memory = int(3.5 * 50_000_000 * per_point / pipeline.GRID_MEMORY_SHARE)
        self.assertEqual(self.grid(tiles, memory)[1], 3)
        # No room for one: still one, as before.
        self.assertEqual(self.grid(tiles, 1)[1], 1)
        # Small tiles: one a CPU.
        small = {"classified.laz": 1000, "unclassified.laz": 1000}
        self.assertEqual(self.grid(small, 2**34)[1], 8)


if __name__ == "__main__":
    unittest.main()
