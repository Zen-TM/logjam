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
            ["a.laz", "b.laz"], "dtm.tif", "scrub.tif", "below.tif", resolution=0.5
        )["pipeline"]

    def test_one_reader_per_input(self):
        readers = _stages_of_type(self.p, "readers.las")
        self.assertEqual([r["filename"] for r in readers], ["a.laz", "b.laz"])

    def test_no_point_reprojection_rasterizes_native(self):
        # Rasters are produced in the LAZ's native CRS; reprojection happens
        # later as a raster warp (reproject_raster_to_web_mercator). Reprojecting
        # points here would rasterize a rotated quad into an axis-aligned grid →
        # edge wedges that fill_nodata fabricates data into.
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

    def test_three_gdal_writers_with_resolution(self):
        writers = _stages_of_type(self.p, "writers.gdal")
        self.assertEqual(len(writers), 3)
        for w in writers:
            self.assertEqual(w["resolution"], 0.5)
            self.assertEqual(w["gdalopts"], "COMPRESS=LZW")

    def test_dtm_writer_is_mean_of_ground(self):
        dtm = next(w for w in _stages_of_type(self.p, "writers.gdal") if w["filename"] == "dtm.tif")
        self.assertEqual(dtm["output_type"], "mean")
        self.assertEqual(dtm["where"], "Classification == 2")

    def test_count_writers_height_bands_and_scan_gate(self):
        scrub = next(w for w in _stages_of_type(self.p, "writers.gdal") if w["filename"] == "scrub.tif")
        below = next(w for w in _stages_of_type(self.p, "writers.gdal") if w["filename"] == "below.tif")
        self.assertEqual(scrub["output_type"], "count")
        self.assertIn("HeightAboveGround >= 0.25", scrub["where"])
        self.assertIn("HeightAboveGround <= 2.0", scrub["where"])
        self.assertIn("HeightAboveGround < 0.25", below["where"])
        # Both count rasters carry the ±scan-angle gate; the DTM does not.
        gate = f"ScanAngleRank >= -{PDAL_SCAN_ANGLE_MAX}"
        self.assertIn(gate, scrub["where"])
        self.assertIn(gate, below["where"])


if __name__ == "__main__":
    unittest.main()
