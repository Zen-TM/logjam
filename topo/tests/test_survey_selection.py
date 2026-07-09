"""Unit tests for per-footprint overlapping-survey selection (pipeline.py).

Pure logic: ELVIS filename parsing + the density-vs-recency pick. The only
external dependency, `_measure_tile_density` (which shells out to `pdal info`),
is mocked so the whole suite runs on the dev host with no PDAL/GDAL. Density
probing must also NOT run for single-survey footprints — that invariant is
asserted directly (mock call count).

Plain unittest (no pytest dep) so it runs unchanged in the worker Docker image.
"""
import os
import sys
import unittest
from unittest import mock

import _native_stub  # noqa: F401  (stubs osgeo when absent on the host)
import pipeline


# Realistic ELVIS tile names. Footprint = everything after "-AHD_".
MUDGEE_LID1 = "Mudgee201408-LID1-C3-AHD_7766366_55_0002_0002.laz"   # dense, older
MUDGEE_LID2 = "Mudgee201612-LID2-C3-AHD_7766366_55_0002_0002.laz"   # sparse, newer
# A different footprint, single survey.
OTHER_LID1 = "Mudgee201408-LID1-C3-AHD_7766368_55_0002_0002.laz"
# No "-C<c>-" classification segment (some ELVIS packages omit it).
BOOROWA_NOC = "Boorowa201709-LID1-AHD_6666180_55_0002_0002.laz"


def _with_density(mapping):
    """Patch _measure_tile_density to a fixed basename→density lookup."""
    def fake(path):
        return mapping[os.path.basename(path)]
    return mock.patch.object(pipeline, "_measure_tile_density", side_effect=fake)


class TestParseElvisFilename(unittest.TestCase):
    def test_parses_full_name(self):
        info = pipeline.parse_elvis_filename("/tmp/" + MUDGEE_LID1)
        self.assertEqual(info.footprint, "7766366_55_0002_0002")
        self.assertEqual(info.capture_yyyymm, 201408)
        self.assertEqual(info.lid_category, 1)
        self.assertEqual(info.survey_label, "Mudgee201408-LID1")

    def test_parses_name_without_classification_segment(self):
        info = pipeline.parse_elvis_filename(BOOROWA_NOC)
        self.assertEqual(info.footprint, "6666180_55_0002_0002")
        self.assertEqual(info.capture_yyyymm, 201709)
        self.assertEqual(info.survey_label, "Boorowa201709-LID1")

    def test_same_tile_different_survey_shares_footprint(self):
        self.assertEqual(
            pipeline.parse_elvis_filename(MUDGEE_LID1).footprint,
            pipeline.parse_elvis_filename(MUDGEE_LID2).footprint,
        )

    def test_non_elvis_name_is_unique(self):
        info = pipeline.parse_elvis_filename("/data/random_cloud.laz")
        self.assertIsNone(info.footprint)
        self.assertIsNone(info.capture_yyyymm)

    def test_elvis_looking_but_unparseable_fails_loud(self):
        # Carries the -LID marker but has no "-AHD_<tile>.laz" tail: silently
        # skipping it would resurrect the order-dependent mosaic ambiguity.
        with self.assertRaises(ValueError):
            pipeline.parse_elvis_filename("Weird201408-LID1-garbage.laz")


class TestSelectSurveysByLayer(unittest.TestCase):
    def test_single_survey_serves_both_without_probing(self):
        with _with_density({}) as probe:
            sel = pipeline.select_surveys_by_layer([OTHER_LID1])
        probe.assert_not_called()  # no density probe for single-survey footprints
        self.assertEqual(sel.terrain_tiles, [OTHER_LID1])
        self.assertEqual(sel.veg_tiles, [OTHER_LID1])
        self.assertEqual(sel.decisions, [])
        self.assertEqual(sel.gridded_paths, [OTHER_LID1])

    def test_overlap_splits_terrain_density_veg_recency(self):
        # LID1 denser (1.7) but older (2014); LID2 sparser (0.5) but newer (2016).
        with _with_density({MUDGEE_LID1: 1.7, MUDGEE_LID2: 0.5}):
            sel = pipeline.select_surveys_by_layer([MUDGEE_LID1, MUDGEE_LID2])
        self.assertEqual(sel.terrain_tiles, [MUDGEE_LID1])  # densest
        self.assertEqual(sel.veg_tiles, [MUDGEE_LID2])      # newest
        self.assertEqual(len(sel.decisions), 1)
        d = sel.decisions[0]
        self.assertEqual(d["footprint"], "7766366_55_0002_0002")
        self.assertEqual(d["terrainSurvey"], "Mudgee201408-LID1")
        self.assertEqual(d["vegSurvey"], "Mudgee201612-LID2")
        self.assertEqual(d["vegCapture"], 201612)
        self.assertTrue(d["divergentSurveys"])
        self.assertEqual(d["surveyCount"], 2)
        # Both tiles gridded (each policy needs a different one).
        self.assertEqual(sorted(sel.gridded_paths), sorted([MUDGEE_LID1, MUDGEE_LID2]))

    def test_newest_is_also_densest_no_divergence(self):
        # When the newer survey is also the denser one, both policies agree →
        # one tile, gridded once, divergentSurveys False.
        with _with_density({MUDGEE_LID1: 0.5, MUDGEE_LID2: 1.9}):
            sel = pipeline.select_surveys_by_layer([MUDGEE_LID1, MUDGEE_LID2])
        self.assertEqual(sel.terrain_tiles, [MUDGEE_LID2])
        self.assertEqual(sel.veg_tiles, [MUDGEE_LID2])
        self.assertFalse(sel.decisions[0]["divergentSurveys"])
        self.assertEqual(sel.gridded_paths, [MUDGEE_LID2])

    def test_density_tiebreak_prefers_newer_for_terrain(self):
        with _with_density({MUDGEE_LID1: 1.0, MUDGEE_LID2: 1.0}):
            sel = pipeline.select_surveys_by_layer([MUDGEE_LID1, MUDGEE_LID2])
        # Equal density → terrain tiebreak is the newer capture (LID2 = 201612).
        self.assertEqual(sel.terrain_tiles, [MUDGEE_LID2])

    def test_non_elvis_tile_bypasses_selection(self):
        other = "/data/hand_flown.laz"
        with _with_density({}) as probe:
            sel = pipeline.select_surveys_by_layer([other])
        probe.assert_not_called()
        self.assertEqual(sel.terrain_tiles, [other])
        self.assertEqual(sel.veg_tiles, [other])

    def test_independent_footprints(self):
        # Two footprints: one overlapping pair + one singleton, handled apart.
        with _with_density({MUDGEE_LID1: 1.7, MUDGEE_LID2: 0.5}):
            sel = pipeline.select_surveys_by_layer(
                [MUDGEE_LID1, MUDGEE_LID2, OTHER_LID1]
            )
        self.assertIn(OTHER_LID1, sel.terrain_tiles)
        self.assertIn(OTHER_LID1, sel.veg_tiles)
        self.assertIn(MUDGEE_LID1, sel.terrain_tiles)
        self.assertIn(MUDGEE_LID2, sel.veg_tiles)
        # Only the multi-survey footprint yields a decision record.
        self.assertEqual(len(sel.decisions), 1)


if __name__ == "__main__":
    unittest.main()
