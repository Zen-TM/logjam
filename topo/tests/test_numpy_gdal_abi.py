"""The image's NumPy must be one the apt GDAL bindings were built against.

The worker image takes GDAL's Python bindings from apt (`python3-gdal`) and
exposes them to the venv with `--system-site-packages`. Those bindings are
compiled against the system NumPy 1.x, so a venv NumPy 2.x shadows it and
`from osgeo import gdal_array` raises `ImportError: numpy.core.multiarray
failed to import`. The first line of pipeline.py that reads a raster into an
array (`compute_data_footprint`) then kills the job after every PDAL tile has
already been processed. The unit tests stub GDAL, so nothing else catches it.

Two guards, both pure text so they run on a host without GDAL:

* `requirements.txt` caps NumPy below 2. Mutation that turns this red:
  raising the cap to `<3.0` (what Dependabot did in #137).
* the Dockerfile imports `gdal_array` at build time, so a pairing that still
  slips through fails the image build, not a user's job. Mutation: deleting
  that RUN line.
"""

import os
import re
import unittest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _read(name):
    with open(os.path.join(_ROOT, name), encoding="utf-8") as fh:
        return fh.read()


class NumpyGdalAbiTest(unittest.TestCase):
    def test_requirements_cap_numpy_below_2(self):
        specs = [
            line.strip()
            for line in _read("requirements.txt").splitlines()
            if re.match(r"\s*numpy\b", line, re.IGNORECASE)
        ]
        self.assertEqual(len(specs), 1, specs)
        self.assertRegex(
            specs[0],
            r"<\s*2(\.0)?\s*(,|$)",
            "numpy must stay <2 while the image uses apt python3-gdal "
            "(built against NumPy 1.x); see this test's docstring",
        )

    def test_dockerfile_imports_gdal_array_at_build_time(self):
        self.assertRegex(
            _read("Dockerfile"),
            r"(?m)^RUN\b.*\bgdal_array\b",
            "the Dockerfile must import osgeo.gdal_array in a RUN so a "
            "NumPy/GDAL mismatch fails the image build",
        )


if __name__ == "__main__":
    unittest.main()
