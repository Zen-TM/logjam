"""Cross-language drift guards for the constants topo/ mirrors from
`shared/src/topoSettings.ts` (listed below), so they cannot drift silently.

Pure text parsing — no GDAL/PDAL, no worker import. Runs on the dev host via
`python -m unittest discover -s tests`.
"""

import ast
import os
import re
import unittest

_HERE = os.path.dirname(__file__)
_TOPO_SETTINGS = os.path.join(_HERE, "..", "..", "shared", "src", "topoSettings.ts")

# One TOPO_LAYERS entry, on one line or several (the formatter then adds a
# trailing comma):
#   { name: "x", label: "...", format: "raster", surveyPick: "density" }
_TS_ENTRY = re.compile(
    r'\{\s*name:\s*"(?P<name>[^"]+)"\s*,\s*'
    r'label:\s*"[^"]+"\s*,\s*'
    r'format:\s*"(?P<format>[^"]+)"\s*,\s*'
    r'surveyPick:\s*"(?P<surveyPick>[^"]+)"\s*,?\s*\}'
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


# ---------------------------------------------------------------------------
# Cross-language constant mirrors:
#   pipeline.py OSM_STYLE_META                 ↔ topoSettings.ts OSM_POINT_ICON
#   build_svtm_formation.py SVTM_FORMATION_MU  ↔ topoSettings.ts SVTM_FORMATIONS
# ---------------------------------------------------------------------------

_PIPELINE = os.path.join(_HERE, "..", "pipeline.py")
_SVTM_BUILDER = os.path.join(_HERE, "..", "build_svtm_formation.py")


def _balanced_block(src, anchor, opener="{", closer="}"):
    """Return the text of the first balanced {...} / [...] after `anchor`."""
    at = src.find(anchor)
    if at < 0:
        raise AssertionError(
            f"Could not locate {anchor!r} — update test_layer_sync.py."
        )
    # Anchor on the assignment, not the first opener: a TS type annotation
    # (`Record<K, { ... }>`, `string[]`) sits between the two.
    assign = re.compile(r"=\s*" + re.escape(opener)).search(src, at)
    if not assign:
        raise AssertionError(
            f"No assignment after {anchor!r} — update test_layer_sync.py."
        )
    start = assign.end() - 1
    depth = 0
    for i in range(start, len(src)):
        if src[i] == opener:
            depth += 1
        elif src[i] == closer:
            depth -= 1
            if depth == 0:
                return src[start : i + 1]
    raise AssertionError(f"Unbalanced {opener}{closer} after {anchor!r}.")


def _parse_py_dict(path, name):
    """literal_eval the Python dict literal assigned to `name` in `path`."""
    return ast.literal_eval(_balanced_block(_read(path), name))


_TS_POINT_ICON = re.compile(
    r'(?P<name>\w+)\s*:\s*\{\s*file:\s*"(?P<file>[^"]+)"\s*,\s*'
    r"sizeZ18:\s*(?P<size>\d+)\s*\}"
)


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


# ---------------------------------------------------------------------------
# pipeline.py's three hand-synced mirrors, each carrying a "must match" or
# "keep in lockstep" comment and nothing enforcing it.
#   pipeline.py COMPOSITE_LAYER_ORDER       ↔ topoSettings.ts TOPO_LAYERS (order)
#   pipeline.py CONTOUR_WIDTH_UNITS_PER_PX  ↔ topoSettings.ts CONTOUR_WIDTH_UNITS_PER_PX
#   pipeline.py SVTM_FORMATION_MU           ↔ build_svtm_formation.py SVTM_FORMATION_MU
# ---------------------------------------------------------------------------


def _py_list(path, anchor):
    """literal_eval the Python list literal assigned at `anchor` in `path`."""
    return ast.literal_eval(_balanced_block(_read(path), anchor, "[", "]"))


def _py_int(path, name):
    """The integer right-hand side of `name = <int>` in `path`."""
    match = re.search(rf"^{name}\s*=\s*(\d+)\s*$", _read(path), re.MULTILINE)
    if not match:
        raise AssertionError(
            f"Could not locate {name} = <int> in {path} — "
            "update test_layer_sync.py to match the current declaration."
        )
    return int(match.group(1))


def _ts_number(name):
    """The integer right-hand side of `export const name = <int>`."""
    match = re.search(
        r"export const " + name + r"\s*=\s*(\d+)",
        _read(_TOPO_SETTINGS),
    )
    if not match:
        raise AssertionError(
            f"Could not locate export const {name} in topoSettings.ts — "
            "update test_layer_sync.py to match the current declaration."
        )
    return int(match.group(1))


class TestPipelineMirrorSync(unittest.TestCase):
    """pipeline.py's mirrors of the TS settings and of the SVTM builder."""

    def test_composite_layer_order_matches_the_ts_list(self):
        # An ORDER, not a set: tile_compose.py stacks these bottom→top for the
        # bake, so a reordering changes which layer wins where they overlap.
        self.assertEqual(
            _py_list(_PIPELINE, "COMPOSITE_LAYER_ORDER ="),
            list(_parse_ts_layers()),
            "pipeline.py COMPOSITE_LAYER_ORDER drifted from TOPO_LAYERS "
            "(shared/src/topoSettings.ts) — names or their order.",
        )

    def test_contour_width_units_match_the_ts_constant(self):
        # The divisor that makes a baked contour the same thickness as the one
        # the user tunes on the live map.
        self.assertEqual(
            _py_int(_PIPELINE, "CONTOUR_WIDTH_UNITS_PER_PX"),
            _ts_number("CONTOUR_WIDTH_UNITS_PER_PX"),
            "pipeline.py CONTOUR_WIDTH_UNITS_PER_PX drifted from "
            "topoSettings.ts CONTOUR_WIDTH_UNITS_PER_PX.",
        )

    def test_svtm_formation_mu_matches_the_builder(self):
        # Same names, same μ: pipeline.py weights vegetation with its own copy
        # while the builder writes the raster, so a μ edited in one place only
        # would weight the same forest two ways on two runs.
        self.assertEqual(
            _parse_py_dict(_PIPELINE, "SVTM_FORMATION_MU: Dict[str, float] ="),
            _parse_py_dict(_SVTM_BUILDER, "SVTM_FORMATION_MU: Dict[str, float] ="),
            "pipeline.py SVTM_FORMATION_MU drifted from "
            "build_svtm_formation.py SVTM_FORMATION_MU.",
        )

    def test_svtm_not_classified_comes_first_here(self):
        # pipeline.py indexes its copy POSITIONALLY into a 256-entry lookup
        # (_build_svtm_mu_lookup), so its order is load-bearing: raster
        # value 0 is "Not classified". The builder's copy is a name→μ map and
        # re-pins index 0 itself, which is why only this one is asserted.
        # Mutation: sort the dict, or move "Not classified" down.
        entries = _parse_py_dict(_PIPELINE, "SVTM_FORMATION_MU: Dict[str, float] =")
        self.assertEqual(next(iter(entries)), "Not classified")
        self.assertEqual(entries["Not classified"], 1.0)


if __name__ == "__main__":
    unittest.main()
