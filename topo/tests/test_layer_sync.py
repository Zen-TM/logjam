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
import ast
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


# ---------------------------------------------------------------------------
# STP-004: three more cross-language constant mirrors, same treatment.
#   worker.py VECTOR_STYLE_DEFAULTS   ↔ topoSettings.ts VECTOR_STYLE_DEFAULTS
#   pipeline.py OSM_STYLE_META        ↔ topoSettings.ts OSM_POINT_ICON
#   build_svtm_formation.py SVTM_FORMATION_MU ↔ topoSettings.ts SVTM_FORMATIONS
# Each was documented with a "must match" comment and nothing enforcing it.
# ---------------------------------------------------------------------------

_PIPELINE = os.path.join(_HERE, "..", "pipeline.py")
_SVTM_BUILDER = os.path.join(_HERE, "..", "build_svtm_formation.py")


def _balanced_block(src, anchor, opener="{", closer="}"):
    """Return the text of the first balanced {...} / [...] after `anchor`."""
    at = src.find(anchor)
    if at < 0:
        raise AssertionError(f"Could not locate {anchor!r} — update test_layer_sync.py.")
    # Anchor on the assignment, not the first opener: a TS type annotation
    # (`Record<K, { ... }>`, `string[]`) sits between the two.
    assign = re.compile(r"=\s*" + re.escape(opener)).search(src, at)
    if not assign:
        raise AssertionError(f"No assignment after {anchor!r} — update test_layer_sync.py.")
    start = assign.end() - 1
    depth = 0
    for i in range(start, len(src)):
        if src[i] == opener:
            depth += 1
        elif src[i] == closer:
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
    raise AssertionError(f"Unbalanced {opener}{closer} after {anchor!r}.")


def _parse_py_dict(path, name):
    """literal_eval the Python dict literal assigned to `name` in `path`."""
    return ast.literal_eval(_balanced_block(_read(path), name))


_TS_FEATURE_STYLE = re.compile(
    r"(?P<name>\w+)\s*:\s*\{\s*enabled:\s*(?P<enabled>true|false)\s*,\s*"
    r'colour:\s*"(?P<colour>[^"]+)"\s*,\s*widthZ18:\s*(?P<width>\d+)\s*\}'
)
_TS_POINT_ICON = re.compile(
    r'(?P<name>\w+)\s*:\s*\{\s*file:\s*"(?P<file>[^"]+)"\s*,\s*'
    r"sizeZ18:\s*(?P<size>\d+)\s*\}"
)


def _parse_ts_vector_style_defaults():
    block = _balanced_block(
        _read(_TOPO_SETTINGS),
        "export const VECTOR_STYLE_DEFAULTS",
    )
    contours = {}
    for field in ("majorColour", "minorColour"):
        m = re.search(field + r'\s*:\s*"([^"]+)"', block)
        assert m, f"contours.{field} missing from TS VECTOR_STYLE_DEFAULTS"
        contours[field] = m.group(1).lower()
    for field in ("majorWidthM", "minorWidthM"):
        m = re.search(field + r"\s*:\s*(\d+)", block)
        assert m, f"contours.{field} missing from TS VECTOR_STYLE_DEFAULTS"
        contours[field] = int(m.group(1))
    features = {
        m.group("name"): (
            m.group("enabled") == "true",
            m.group("colour").lower(),
            int(m.group("width")),
        )
        for m in _TS_FEATURE_STYLE.finditer(block)
    }
    if not features:
        raise AssertionError(
            "Parsed zero feature styles from TS VECTOR_STYLE_DEFAULTS — entry "
            "shape changed; update _TS_FEATURE_STYLE in test_layer_sync.py."
        )
    label_scale = re.search(r"labelScale\s*:\s*(\d+)", block)
    assert label_scale, "labelScale missing from TS VECTOR_STYLE_DEFAULTS"
    return contours, features, int(label_scale.group(1))


def _parse_ts_point_icons():
    block = _balanced_block(_read(_TOPO_SETTINGS), "export const OSM_POINT_ICON")
    icons = {
        m.group("name"): (m.group("file"), int(m.group("size")))
        for m in _TS_POINT_ICON.finditer(block)
    }
    if not icons:
        raise AssertionError(
            "Parsed zero entries from OSM_POINT_ICON — entry shape changed; "
            "update _TS_POINT_ICON in test_layer_sync.py."
        )
    return icons


def _parse_ts_svtm_formations():
    block = _balanced_block(
        _read(_TOPO_SETTINGS), "export const SVTM_FORMATIONS", "[", "]"
    )
    names = re.findall(r'"([^"]+)"', block)
    if not names:
        raise AssertionError("Parsed zero entries from SVTM_FORMATIONS.")
    return names


class TestVectorStyleDefaultsSync(unittest.TestCase):
    """worker.py's NULL-vector_style fallback must match the TS defaults."""

    @classmethod
    def setUpClass(cls):
        cls.py = _parse_py_dict(_WORKER, "VECTOR_STYLE_DEFAULTS: dict =")
        cls.ts_contours, cls.ts_features, cls.ts_label_scale = (
            _parse_ts_vector_style_defaults()
        )

    def test_contours_match(self):
        py_contours = {
            k: (v.lower() if isinstance(v, str) else v)
            for k, v in self.py["contours"].items()
        }
        self.assertEqual(
            py_contours,
            self.ts_contours,
            "worker.py VECTOR_STYLE_DEFAULTS.contours drifted from topoSettings.ts",
        )

    def test_features_match(self):
        py_features = {
            k: (v["enabled"], v["colour"].lower(), v["widthZ18"])
            for k, v in self.py["features"].items()
        }
        self.assertEqual(
            py_features,
            self.ts_features,
            "worker.py VECTOR_STYLE_DEFAULTS.features drifted from topoSettings.ts",
        )

    def test_label_scale_matches(self):
        self.assertEqual(self.py["labelScale"], self.ts_label_scale)


class TestOsmPointIconSync(unittest.TestCase):
    """pipeline.py OSM_STYLE_META is the source of truth; TS mirrors it."""

    @classmethod
    def setUpClass(cls):
        cls.py = _parse_py_dict(_PIPELINE, "OSM_STYLE_META =")

    def test_icon_file_and_size_match(self):
        py_icons = {
            name: (meta["icon"], meta["size_z18"])
            for name, meta in self.py.items()
            if meta.get("point")
        }
        self.assertEqual(
            py_icons,
            _parse_ts_point_icons(),
            "topoSettings.ts OSM_POINT_ICON drifted from pipeline.py OSM_STYLE_META",
        )

    def test_every_point_feature_has_an_icon(self):
        missing = [
            name
            for name, meta in self.py.items()
            if meta.get("point") and not meta.get("icon")
        ]
        self.assertEqual(missing, [], "point feature(s) with no icon in OSM_STYLE_META")


class TestSvtmFormationSync(unittest.TestCase):
    """TS formation list must match the builder's μ table keys."""

    @classmethod
    def setUpClass(cls):
        cls.py_keys = set(
            _parse_py_dict(_SVTM_BUILDER, "SVTM_FORMATION_MU: Dict[str, float] =")
        )
        cls.ts = _parse_ts_svtm_formations()

    def test_names_match(self):
        self.assertEqual(
            set(self.ts),
            self.py_keys,
            "topoSettings.ts SVTM_FORMATIONS drifted from "
            "build_svtm_formation.py SVTM_FORMATION_MU keys",
        )

    def test_not_classified_is_index_zero(self):
        # build_svtm_formation.py pins "Not classified" to raster index 0
        # (the nodata default); the TS list is indexed by that raster value.
        self.assertEqual(self.ts[0], "Not classified")

    def test_no_duplicate_formations(self):
        self.assertEqual(len(self.ts), len(set(self.ts)))


if __name__ == "__main__":
    unittest.main()
