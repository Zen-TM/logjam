"""Cross-language guard for the flow network layer's schema.

`build_flow_network.py` writes the GeoPackage and `api/src/services/flowNetwork.ts`
reads it with hand-written SQL. The API's own tests read the committed fixture,
so a column renamed in the script and a rebuilt layer uploaded by hand would
fail every lookup with a 503 while every suite stayed green. This test reads
both files as text: every table and column the reader's SQL names must be one
the writer declares.

Modelled on test_push_constants_sync.py. Pure text parsing: no GDAL import.
"""

import ast
import os
import re
import unittest

_HERE = os.path.dirname(__file__)
_WRITER = os.path.join(_HERE, "..", "build_flow_network.py")
_READER = os.path.join(_HERE, "..", "..", "api", "src", "services", "flowNetwork.ts")

# What the SQL may name besides the layer's own tables and columns.
_SQL_WORDS = {
    "select", "from", "join", "on", "where", "and", "or", "as", "with",
    "recursive", "union", "all", "limit", "order", "by", "asc", "desc",
    "not", "null", "is", "in",
}  # fmt: skip
# The GeoPackage R-tree's own columns, as GDAL writes it.
_RTREE_COLUMNS = {"id", "minx", "maxx", "miny", "maxy"}
# SQLite's json_each, the reader's table aliases and its recursive CTE.
_READER_OWN = {"json_each", "value", "f", "b", "r", "j", "up"}


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _writer():
    """The schema constants of build_flow_network.py, field names only."""
    tree = ast.parse(_read(_WRITER))
    consts = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name):
                consts[target.id] = node.value

    def text(name):
        value = consts[name]
        assert isinstance(value, ast.Constant), name
        return value.value

    def fields(name):
        value = consts[name]
        if isinstance(value, ast.BinOp):  # A + B
            return fields(value.left.id) + fields_of(value.right)
        return fields_of(value)

    def fields_of(value):
        return [element.elts[0].value for element in value.elts]

    return {
        "layer": text("LAYER"),
        "basins": text("BASINS_LAYER"),
        "fid": text("FID"),
        "geom": text("GEOMETRY"),
        "segment": fields("SEGMENT_FIELDS"),
        "merged": fields("MERGED_FIELDS"),
        "basin": fields("BASIN_FIELDS"),
        "copied": [element.value for element in consts["COPIED_FIELDS"].elts],
    }


def _reader_sql():
    """Every SQL template the reader prepares."""
    return re.findall(r"db\.prepare\(\s*`([^`]*)`", _read(_READER))


class FlowNetworkSchemaTest(unittest.TestCase):
    def setUp(self):
        self.w = _writer()
        self.sql = _reader_sql()

    def test_finds_the_readers_sql(self):
        # Without this the test below passes on nothing.
        self.assertGreaterEqual(len(self.sql), 4)

    # Mutation: rename a column in SEGMENT_FIELDS (say stream_order to
    # strahler), or the geometry or fid column, and the reader names a
    # column the writer no longer writes.
    def test_the_reader_names_only_what_the_writer_writes(self):
        w = self.w
        known = (
            {w["layer"], w["basins"], w["fid"], w["geom"]}
            | {f"rtree_{w['layer']}_{w['geom']}", f"rtree_{w['basins']}_{w['geom']}"}
            | set(w["merged"])
            | set(w["basin"])
            | _RTREE_COLUMNS
            | _SQL_WORDS
            | _READER_OWN
        )
        for sql in self.sql:
            words = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", sql))
            self.assertEqual(words - known, set(), sql)

    # Mutation: drop a field the merge copies from SEGMENT_FIELDS, and the
    # merge reads a field each basin's part never had.
    def test_the_merge_copies_only_what_each_part_has(self):
        self.assertLessEqual(set(self.w["copied"]), set(self.w["segment"]))
        self.assertEqual(self.w["merged"][: len(self.w["segment"])], self.w["segment"])


if __name__ == "__main__":
    unittest.main()
