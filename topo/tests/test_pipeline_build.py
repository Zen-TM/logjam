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
    the largest's, with an unclassified tile counted as a classified one
    (SMRF holds more than twice as much), with a small tile counted by its
    points alone, or one at a time when several fit; or if a failed tile
    leaves the tiles queued behind it to be gridded before the job fails."""

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
            mock.patch.object(pipeline, "ProcessPoolExecutor", ThreadPoolExecutor),
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
        # The first pool asks each tile for its ground; the second grids.
        return [c.args[0] for c in run.call_args_list], pools[1]

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

    def test_a_failed_tile_stops_the_tiles_still_queued(self):
        import tempfile
        import time
        from unittest import mock

        import pipeline

        started = []

        def grid(job):
            started.append(job[0])
            if job[0] == 0:
                raise RuntimeError("PDAL failed")
            time.sleep(0.05)

        classified = mock.patch.object(pipeline, "has_class2", return_value=True)

        tiles = [f"{i}.laz" for i in range(8)]
        with (
            tempfile.TemporaryDirectory() as work,
            classified,
            mock.patch.object(pipeline, "point_count", return_value=10**12),
            mock.patch.object(pipeline, "available_memory", return_value=1),
            mock.patch.object(pipeline, "_grid_tile", side_effect=grid),
            mock.patch.object(pipeline, "side_by_side") as merge,
            self.assertRaises(RuntimeError),
        ):
            pipeline.run_pdal_per_tile(
                tiles,
                tiles,
                *(os.path.join(work, f"{n}.tif") for n in "abcde"),
                work,
                workers=8,
            )
        # One at a time (no memory for more): the first fails, and at most
        # the one the pool had already picked up runs after it, not all eight.
        self.assertLessEqual(len(started), 2)
        merge.assert_not_called()

    def test_as_many_tiles_at_a_time_as_the_largest_fits_in_memory_with(self):
        import pipeline

        per_point = pipeline.GRID_BYTES_PER_POINT
        self.assertGreater(per_point["smrf"], 2 * per_point["class2"])
        share = pipeline.GRID_MEMORY_SHARE

        def room_for(jobs, points, ground):
            return int((jobs + 0.5) * points * per_point[ground] / share)

        # The classified tile is the larger in points, the unclassified one
        # in memory: room for three of it.
        tiles = {"classified.laz": 60_000_000, "unclassified.laz": 50_000_000}
        memory = room_for(3, 50_000_000, "smrf")
        self.assertGreater(memory, room_for(5, 60_000_000, "class2"))
        self.assertEqual(self.grid(tiles, memory)[1], 3)
        # No room for one: still one, as before.
        self.assertEqual(self.grid(tiles, 1)[1], 1)
        # Small tiles are counted as the measured tile, not by their points.
        small = {"classified.laz": 1000, "unclassified.laz": 1000}
        measured = pipeline.GRID_MEASURED_POINTS
        self.assertEqual(self.grid(small, room_for(2, measured, "smrf"))[1], 2)
        self.assertEqual(self.grid(small, 2**36)[1], 8)


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestHasClass2(unittest.TestCase):
    """Red if a cloud is read whole when its first part already has ground,
    if the search stops at a part with none (an unclassified start, ground
    further in), or if the last, short part is left unread."""

    def probe(self, total, classes_of_part):
        """has_class2 on a made-up cloud of `total` points; `classes_of_part`
        maps a part's start to the classes PDAL would find in it. Returns
        (the answer, the (start, count) of each part read)."""
        import json
        from unittest import mock

        import pipeline

        read = []

        def run(command, **_):
            start = int(next(a for a in command if "las.start" in a).split("=")[1])
            count = int(next(a for a in command if "las.count" in a).split("=")[1])
            read.append((start, count))
            stats = {"statistic": [{"values": classes_of_part.get(start, [1])}]}
            return mock.Mock(stdout=json.dumps({"stats": stats}))

        with (
            mock.patch.object(pipeline, "point_count", return_value=total),
            mock.patch.object(pipeline.subprocess, "run", side_effect=run),
        ):
            return pipeline.has_class2("a.laz"), read

    def test_it_stops_at_the_first_part_with_ground(self):
        import pipeline

        # A Category 1 tile's 57.6 M points, answered from its first part.
        found, read = self.probe(57_600_000, {0: [1, 2, 5]})
        self.assertTrue(found)
        self.assertEqual(read, [(0, pipeline.CLASS_PROBE_POINTS)])
        self.assertLessEqual(read[0][1], 2_000_000)

    def test_ground_further_in_is_found(self):
        import pipeline

        part = pipeline.CLASS_PROBE_POINTS
        found, read = self.probe(2 * part + 7, {2 * part: [2.0]})
        self.assertTrue(found)
        self.assertEqual(read, [(0, part), (part, part), (2 * part, 7)])

    def test_a_cloud_with_none_is_read_to_its_end(self):
        import pipeline

        part = pipeline.CLASS_PROBE_POINTS
        found, read = self.probe(2 * part + 7, {})
        self.assertFalse(found)
        self.assertEqual(len(read), 3)
        self.assertEqual(self.probe(0, {}), (False, []))


if __name__ == "__main__":
    unittest.main()
