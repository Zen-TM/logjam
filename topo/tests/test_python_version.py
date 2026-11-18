"""The suite runs on the Python mise.toml pins, as CI and the worker image do.

On another Python, `make setup`'s packages are not there (shapely, numpy < 2),
and a dozen tests fail in ways that read as regressions. `make topo-test` runs
the suite on the pinned one.

Mutation that turns it red: change `python` in mise.toml to another version.
"""

import re
import sys
import unittest
from pathlib import Path

MISE = Path(__file__).resolve().parents[2] / "mise.toml"


class PythonVersion(unittest.TestCase):
    def test_runs_on_the_pinned_python(self):
        pin = re.search(r'^python\s*=\s*"([\d.]+)"', MISE.read_text(), re.M)
        self.assertIsNotNone(pin, f"no python pin read from {MISE}")
        want = tuple(int(part) for part in pin.group(1).split("."))
        have = sys.version_info[: len(want)]
        self.assertEqual(
            have,
            want,
            f"topo's tests run on Python {pin.group(1)} (mise.toml), not "
            f"{sys.version.split()[0]}: run `make topo-test` from the repo root.",
        )


if __name__ == "__main__":
    unittest.main()
