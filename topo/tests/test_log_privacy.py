"""The topo job's logs never say where the user surveyed (root AGENTS.md,
Privacy): no coordinate, bbox, tile index, footprint id or survey name.
Its stdout goes to CloudWatch.

Two guards. A scan of every `log.*()` call in the job's modules for the
names that hold such a value, and the overlapping-survey pick run for real
under assertLogs, since its footprint id and survey labels are the values
most tempting to log. Mutations that turn it red: restoring pipeline.py's
`Coverage: lon …, lat …` line, putting `{footprint}` or a survey label back
in the overlapping-surveys log, logging a tile's `{z}/{x}/{y}`, or restoring
the filename in the PDAL tile log.
"""

import ast
import os
import unittest
from unittest import mock

import _native_stub  # noqa: F401  (stubs osgeo when absent on the host)
import pipeline

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
# The modules a topo job runs: the worker, and the two pipelines it starts.
_MODULES = ("worker.py", "pipeline.py", "sharpen.py")
# Names that hold where a place is, in those modules.
_PLACE_NAMES = {
    "lon", "lat", "lon_min", "lat_min", "lon_max", "lat_max",
    "west", "south", "east", "north", "bbox", "bbox_wgs84", "bounds",
    "coverage", "footprint", "tiles15", "z", "x", "y", "bx", "by", "tx", "ty",
    "survey_label", "terrain_win", "veg_win",
    # An ELVIS file's name holds its survey's area and its MGA tile.
    "laz", "las_files", "terrain_tiles", "veg_tiles",
}  # fmt: skip


class TestNoPlaceInLogCalls(unittest.TestCase):
    def test_no_log_call_names_a_place(self):
        found = []
        for module in _MODULES:
            path = os.path.join(_ROOT, module)
            with open(path) as f:
                tree = ast.parse(f.read())
            for node in ast.walk(tree):
                if not (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "log"
                ):
                    continue
                used = set()
                for arg in [*node.args, *(k.value for k in node.keywords)]:
                    for n in ast.walk(arg):
                        if isinstance(n, ast.Name):
                            used.add(n.id)
                        elif isinstance(n, ast.Attribute):
                            used.add(n.attr)
                if used & _PLACE_NAMES:
                    found.append(
                        f"{module}:{node.lineno} {sorted(used & _PLACE_NAMES)}"
                    )
        self.assertEqual(found, [])


class TestOverlappingSurveysLog(unittest.TestCase):
    def test_names_neither_the_footprint_nor_the_survey(self):
        tiles = [
            "Katoomba201804-LID2-C3-AHD_2506258_56_0002_0002.laz",
            "Katoomba201904-LID1-C3-AHD_2506258_56_0002_0002.laz",
        ]
        with (
            mock.patch.object(pipeline, "_measure_tile_density", return_value=1.0),
            self.assertLogs(pipeline.log, "INFO") as logs,
        ):
            pipeline.select_surveys_by_layer(tiles)
        text = "\n".join(logs.output)
        self.assertIn("overlapping surveys", text)
        for place in ("2506258", "Katoomba", "201804", "201904"):
            self.assertNotIn(place, text)


if __name__ == "__main__":
    unittest.main()
