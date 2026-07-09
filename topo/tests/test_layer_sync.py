"""Cross-language drift guard for the canonical topo-layer list (ARCH-010).

`shared/src/topoSettings.ts → TOPO_LAYERS` is the single source of truth; the
TS side all derives from it, but `topo/worker.py` keeps a hand-synced Python
mirror (ALL_LAYERS / RASTER_LAYERS / VECTOR_LAYERS) — the only structurally
unavoidable copy. Nothing previously failed when the two diverged. The
2026-06-11 consent-version prod incident was exactly this class of bug
(a constant duplicated across packages drifting silently); this test closes it
for the one remaining cross-LANGUAGE mirror.

Pure text parsing — no GDAL/PDAL, no worker import. Runs on the dev host via
`python -m unittest discover -s tests`.
"""
import os
import re
import unittest

_HERE = os.path.dirname(__file__)
_TOPO_SETTINGS = os.path.join(
    _HERE, "..", "..", "shared", "src", "topoSettings.ts"
)
_WORKER = os.path.join(_HERE, "..", "worker.py")

# One TOPO_LAYERS entry:
#   { name: "x", label: "...", format: "raster", surveyPick: "density" }
_TS_ENTRY = re.compile(
    r'\{\s*name:\s*"(?P<name>[^"]+)"\s*,\s*'
    r'label:\s*"[^"]+"\s*,\s*'
    r'format:\s*"(?P<format>[^"]+)"\s*,\s*'
    r'surveyPick:\s*"(?P<surveyPick>[^"]+)"\s*\}'
)


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _parse_ts_layers():
    """Return {name: format} parsed from the TOPO_LAYERS literal."""
    src = _read(_TOPO_SETTINGS)
    match = re.search(
        r"export const TOPO_LAYERS\s*=\s*\[(?P<body>.*?)\]\s*as const",
        src,
        re.DOTALL,
    )
    if not match:
        raise AssertionError(
            "Could not locate the TOPO_LAYERS array in topoSettings.ts — "
            "the regex in test_layer_sync.py needs updating to match the "
            "current literal."
        )
    layers = {
        m.group("name"): m.group("format")
        for m in _TS_ENTRY.finditer(match.group("body"))
    }
    if not layers:
        raise AssertionError(
            "Parsed zero entries from the TOPO_LAYERS literal — entry shape "
            "changed; update _TS_ENTRY in test_layer_sync.py."
        )
    return layers


def _parse_ts_survey_pick():
    """Return {name: surveyPick} parsed from the TOPO_LAYERS literal."""
    src = _read(_TOPO_SETTINGS)
    match = re.search(
        r"export const TOPO_LAYERS\s*=\s*\[(?P<body>.*?)\]\s*as const",
        src,
        re.DOTALL,
    )
    if not match:
        raise AssertionError(
            "Could not locate the TOPO_LAYERS array in topoSettings.ts."
        )
    picks = {
        m.group("name"): m.group("surveyPick")
        for m in _TS_ENTRY.finditer(match.group("body"))
    }
    if not picks:
        raise AssertionError(
            "Parsed zero surveyPick values from TOPO_LAYERS — entry shape "
            "changed; update _TS_ENTRY in test_layer_sync.py."
        )
    return picks


def _parse_py_frozenset(name):
    """Return the set of quoted string members of `name = frozenset({...})`."""
    src = _read(_WORKER)
    match = re.search(
        name + r"\s*:\s*frozenset\[str\]\s*=\s*frozenset\(\{(?P<body>.*?)\}\)",
        src,
        re.DOTALL,
    )
    if not match:
        raise AssertionError(
            f"Could not locate {name} frozenset in worker.py — "
            "update test_layer_sync.py to match the current declaration."
        )
    return set(re.findall(r'"([^"]+)"', match.group("body")))


def _parse_py_survey_pick():
    """Return {name: surveyPick} parsed from worker.py LAYER_SURVEY_PICK dict."""
    src = _read(_WORKER)
    match = re.search(
        r"LAYER_SURVEY_PICK\s*:\s*dict\[str,\s*str\]\s*=\s*\{(?P<body>.*?)\}",
        src,
        re.DOTALL,
    )
    if not match:
        raise AssertionError(
            "Could not locate LAYER_SURVEY_PICK dict in worker.py — "
            "update test_layer_sync.py to match the current declaration."
        )
    return dict(re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', match.group("body")))


class TestTopoLayerSync(unittest.TestCase):
    """worker.py's Python mirror must match the canonical TS list exactly."""

    @classmethod
    def setUpClass(cls):
        cls.ts = _parse_ts_layers()
        cls.ts_names = set(cls.ts)
        cls.ts_raster = {n for n, f in cls.ts.items() if f == "raster"}
        cls.ts_vector = {n for n, f in cls.ts.items() if f == "vector"}

    def test_all_layers_matches(self):
        self.assertEqual(
            _parse_py_frozenset("ALL_LAYERS"),
            self.ts_names,
            "worker.py ALL_LAYERS drifted from shared TOPO_LAYERS names",
        )

    def test_raster_layers_matches(self):
        self.assertEqual(
            _parse_py_frozenset("RASTER_LAYERS"),
            self.ts_raster,
            "worker.py RASTER_LAYERS drifted from TOPO_LAYERS format=raster",
        )

    def test_vector_layers_matches(self):
        self.assertEqual(
            _parse_py_frozenset("VECTOR_LAYERS"),
            self.ts_vector,
            "worker.py VECTOR_LAYERS drifted from TOPO_LAYERS format=vector",
        )

    def test_every_layer_has_a_format_bucket(self):
        # Guards against a TS format value other than raster/vector slipping in
        # without a matching Python bucket.
        self.assertEqual(self.ts_raster | self.ts_vector, self.ts_names)

    def test_survey_pick_matches(self):
        self.assertEqual(
            _parse_py_survey_pick(),
            _parse_ts_survey_pick(),
            "worker.py LAYER_SURVEY_PICK drifted from TOPO_LAYERS surveyPick",
        )

    def test_survey_pick_values_are_known(self):
        # Every surveyPick must be one the pipeline knows how to act on.
        self.assertLessEqual(
            set(_parse_ts_survey_pick().values()),
            {"density", "recency", "none"},
        )


if __name__ == "__main__":
    unittest.main()
