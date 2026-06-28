"""Runtime instrumentation in pipeline.py: Benchmark metrics capture (always on,
independent of --benchmark logging) and the atomic progress-file writer.

Pure-Python (time/json/os); pipeline's native deps are stubbed by _native_stub.
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

try:
    import pipeline  # noqa: E402
    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc


@unittest.skipUnless(_IMPORT_OK, f"pipeline import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestBenchmarkMetrics(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_captures_timings_even_when_logging_disabled(self):
        # enabled=False silences [BENCH] logs but MUST still record phases.
        bench = pipeline.Benchmark(enabled=False)
        with bench.step("PDAL", key="pdal"):
            pass
        with bench.step("Render", key="render"):
            pass
        bench.set_tile_counts(4, 1500)
        bench.set_zoom(12, 18)
        path = os.path.join(self.tmp, "metrics.json")
        bench.write_metrics(path)

        m = json.loads(open(path).read())
        self.assertEqual(m["schemaVersion"], 1)
        self.assertIn("pdal", m["phases"])
        self.assertIn("render", m["phases"])
        self.assertEqual(m["inputTileCount"], 4)
        self.assertEqual(m["outputTileCount"], 1500)
        self.assertEqual(m["zoomMin"], 12)
        self.assertEqual(m["zoomMax"], 18)
        self.assertIsInstance(m["wallSeconds"], (int, float))

    def test_same_key_accumulates(self):
        bench = pipeline.Benchmark(enabled=False)
        with bench.step("footprint A", key="footprint"):
            pass
        with bench.step("footprint B", key="footprint"):
            pass
        path = os.path.join(self.tmp, "metrics.json")
        bench.write_metrics(path)
        m = json.loads(open(path).read())
        # One accumulated entry, not two.
        self.assertEqual(list(m["phases"].keys()), ["footprint"])

    def test_step_without_key_is_untracked_in_phases(self):
        bench = pipeline.Benchmark(enabled=False)
        with bench.step("no key"):
            pass
        path = os.path.join(self.tmp, "metrics.json")
        bench.write_metrics(path)
        self.assertEqual(json.loads(open(path).read())["phases"], {})


@unittest.skipUnless(_IMPORT_OK, f"pipeline import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestWriteProgress(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._orig = pipeline._PROGRESS_PATH

    def tearDown(self):
        pipeline._PROGRESS_PATH = self._orig

    def test_writes_done_total_phase_ts(self):
        path = os.path.join(self.tmp, "progress.json")
        pipeline._PROGRESS_PATH = path
        pipeline._write_progress(50, 100, "render")
        p = json.loads(open(path).read())
        self.assertEqual(p["done"], 50)
        self.assertEqual(p["total"], 100)
        self.assertEqual(p["phase"], "render")
        self.assertIsInstance(p["ts"], (int, float))

    def test_noop_when_path_unset(self):
        pipeline._PROGRESS_PATH = None
        path = os.path.join(self.tmp, "progress.json")
        pipeline._write_progress(1, 2, "pdal")
        self.assertFalse(os.path.exists(path))


if __name__ == "__main__":
    unittest.main()
