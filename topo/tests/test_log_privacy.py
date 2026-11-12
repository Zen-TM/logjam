"""The topo job's logs never say where the user surveyed, nor an area
export's where they mean to go (root AGENTS.md, Privacy): no coordinate,
bbox, tile index, footprint id or survey name. Their stdout goes to
CloudWatch.

Four guards. A scan of every logging call and `print` in every Python module
the worker image ships (the Dockerfile's COPY list, which test_docker_image_files
already parses) for the names that hold such a value; the overlapping-survey pick run for real
under assertLogs, since its footprint id and survey labels are the values
most tempting to log; and pipeline.py's GDAL handler, which logs a message's
class and number, never its text (`TestGdalMessages`, whose mutations its
own docstring names); and a failed job's last line (`TestUncaughtFailure`,
likewise). Mutations of the first two that turn it red: `print(f"at {lat}")` or
`logging.getLogger().info(f"at {lat}")` in worker.py, `log.info(f"box {lon_min}")`
in renderers/tile_compose.py, renaming `log` to `logger` in a module (the scan's
floor of calls found), restoring pipeline.py's
`Coverage: lon …, lat …` line, putting `{footprint}` or a survey label back
in the overlapping-surveys log, logging a tile's `{z}/{x}/{y}`, restoring
the filename in the PDAL tile log, or logging an area export's `{rect}`.
"""

import ast
import os
from collections import Counter
import unittest
from unittest import mock

import _native_stub  # noqa: F401  (stubs osgeo when absent on the host)
import pipeline
from test_docker_image_files import _ROOT, _copied_sources

_LOG_LEVELS = {"debug", "info", "warning", "warn", "error", "exception", "critical"}


# Today's calls per module, rounded down: 59, 26, 15, 26.
_MIN_CALLS = {
    "pipeline.py": 50,
    "worker.py": 20,
    "export_worker.py": 12,
    "build_fire_history.py": 20,
}


def _shipped_modules():
    """Every .py file the Dockerfile copies into the worker image, repo-relative."""
    found = []
    for src in sorted(_copied_sources()):
        path = os.path.join(_ROOT, src)
        if src.endswith("/"):
            for dirpath, _, names in os.walk(path):
                found += [
                    os.path.relpath(os.path.join(dirpath, n), _ROOT)
                    for n in sorted(names)
                    if n.endswith(".py")
                ]
        elif src.endswith(".py"):
            found.append(src)
    return found


def _is_output_call(node):
    """`print(...)`, or `.debug/.info/...(...)` on any receiver: stdout and
    stderr reach CloudWatch the same as a logger does."""
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if isinstance(func, ast.Name):
        return func.id == "print"
    return isinstance(func, ast.Attribute) and func.attr in _LOG_LEVELS


# Names that hold where a place is, in those modules.
_PLACE_NAMES = {
    "lon", "lat", "lon_min", "lat_min", "lon_max", "lat_max",
    "west", "south", "east", "north", "bbox", "bbox_wgs84", "bounds",
    "coverage", "footprint", "tiles15", "z", "x", "y", "bx", "by", "tx", "ty",
    "survey_label", "terrain_win", "veg_win",
    # An area export's box, in MGA and around it, and its tile range.
    "rect", "around", "x0", "y0", "x1", "y1", "xmin", "ymin", "xmax", "ymax",
    # An ELVIS file's name holds its survey's area and its MGA tile; these
    # names hold one, or a list of them, in these modules.
    "laz", "las_files", "terrain_tiles", "veg_tiles", "path", "paths", "dem_files",
}  # fmt: skip


def _names(node):
    """The names an expression reads, leaving out a count (`len(...)` of a
    list of files says how many, not which) and `os.path`."""
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "len"
    ):
        return set()
    if isinstance(node, ast.Attribute) and getattr(node.value, "id", "") == "os":
        return set()
    found = set()
    if isinstance(node, ast.Name):
        found.add(node.id)
    elif isinstance(node, ast.Attribute):
        found.add(node.attr)
    for child in ast.iter_child_nodes(node):
        found |= _names(child)
    return found


class TestNoPlaceInLogCalls(unittest.TestCase):
    def test_no_output_call_names_a_place(self):
        found = []
        calls = Counter()
        modules = _shipped_modules()
        # A Dockerfile that stopped COPYing the workers would empty the scan.
        self.assertGreaterEqual(len(modules), 15, modules)
        for module in modules:
            path = os.path.join(_ROOT, module)
            with open(path) as f:
                tree = ast.parse(f.read())
            for node in ast.walk(tree):
                if not _is_output_call(node):
                    continue
                calls[module] += 1
                used = set()
                for arg in [*node.args, *(k.value for k in node.keywords)]:
                    used |= _names(arg)
                if used & _PLACE_NAMES:
                    found.append(
                        f"{module}:{node.lineno} {sorted(used & _PLACE_NAMES)}"
                    )
        # A matcher that stops matching, or a module that renames its logger,
        # reads 0 or far fewer than today's count (see _MIN_CALLS).
        for module, floor in _MIN_CALLS.items():
            self.assertGreaterEqual(
                calls[module],
                floor,
                f"the scan found {calls[module]} log/print calls in {module}, "
                f"expected at least {floor}: it no longer matches how the "
                "worker logs. Fix _is_output_call in topo/tests/test_log_privacy.py.",
            )
        self.assertEqual(
            found,
            [],
            "a log or print call in the worker image names a place (coordinate, "
            "bbox, tile index, footprint, survey or file name). Log a count or "
            "an id instead; this reaches CloudWatch.",
        )


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


class TestGdalMessages(unittest.TestCase):
    """GDAL prints warnings to stderr with the file they're about ("Skipping
    <file>", from BuildVRT). pipeline.py replaces that output on import.
    Mutations that turn it red: the handler logs GDAL's message, it is not
    pushed (so GDAL prints its own), or it logs past GDAL's cap of 1000."""

    leak = "/tmp/w/Katoomba201804-LID2-AHD_2506258_56_0002_0002_2m.tif"

    def test_logs_class_and_number_not_the_message(self):
        with self.assertLogs(pipeline.log, "WARNING") as logs:
            pipeline._gdal_message(
                2, 1, f"heterogeneous band numbers. Skipping {self.leak}"
            )
        text = "\n".join(logs.output)
        self.assertIn("number 1", text)
        for part in ("Katoomba", "2506258", "Skipping"):
            self.assertNotIn(part, text)

    def test_stops_at_gdals_cap(self):
        with (
            mock.patch.object(pipeline, "_gdal_messages", 0),
            self.assertLogs(pipeline.log, "WARNING") as logs,
        ):
            for _ in range(pipeline._GDAL_MESSAGES_MAX + 5):
                pipeline._gdal_message(2, 1, "")
        self.assertEqual(len(logs.output), pipeline._GDAL_MESSAGES_MAX)
        self.assertIn("limit reached", logs.output[-1])

    def test_the_handler_is_pushed(self):
        if _native_stub.is_stubbed("osgeo"):
            pipeline.gdal.PushErrorHandler.assert_any_call(pipeline._gdal_message)
            return
        # The real thing, in the worker image: a warning BuildVRT really gives
        # reaches the log, and nothing reaches stderr.
        import tempfile

        gdal = pipeline.gdal
        with tempfile.TemporaryDirectory() as tmp:
            a, b = (
                os.path.join(tmp, "a.tif"),
                os.path.join(tmp, os.path.basename(self.leak)),
            )
            for path, bands, kind in ((a, 1, gdal.GDT_Float32), (b, 3, gdal.GDT_Byte)):
                ds = gdal.GetDriverByName("GTiff").Create(path, 4, 4, bands, kind)
                ds.SetGeoTransform((0, 1, 0, 4, 0, -1))
                ds = None
            with tempfile.TemporaryFile() as err:
                saved = os.dup(2)
                os.dup2(err.fileno(), 2)
                try:
                    with self.assertLogs(pipeline.log, "WARNING"):
                        gdal.BuildVRT(os.path.join(tmp, "v.vrt"), [a, b])
                finally:
                    os.dup2(saved, 2)
                    os.close(saved)
                err.seek(0)
                self.assertEqual(err.read(), b"")


class TestUncaughtFailure(unittest.TestCase):
    """A vegetation pass that fails leaves pipeline.py as its type and code
    locations, never Python's traceback, whose message can quote an ELVIS
    file ("`pdal info --summary` failed for <file>"). Mutations that turn it
    red: main lets the exception escape, or prints it."""

    def test_main_reports_no_message(self):
        import contextlib
        import io
        import sys
        import tempfile

        leak = "Katoomba201804-LID2-C3-AHD_2506258_56_0002_0002.laz"
        err = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp:
            zip_path = os.path.join(tmp, "in.zip")
            open(zip_path, "w").close()
            argv = ["pipeline.py", zip_path, "--work-dir", tmp, "--output", tmp]
            with (
                mock.patch.object(
                    pipeline,
                    "extract_elvis_zip",
                    side_effect=RuntimeError(f"pdal info failed for {leak}"),
                ),
                mock.patch.object(sys, "argv", argv),
                contextlib.redirect_stderr(err),
                self.assertRaises(SystemExit) as ctx,
            ):
                pipeline.main()
        self.assertEqual(ctx.exception.code, 1)
        self.assertIn("RuntimeError at", err.getvalue())
        self.assertIn("pipeline.py:", err.getvalue())
        for part in ("Katoomba", "2506258", "pdal info"):
            self.assertNotIn(part, err.getvalue())


if __name__ == "__main__":
    unittest.main()
