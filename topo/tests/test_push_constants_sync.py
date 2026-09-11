"""Cross-language drift guard for the push notification constants.

`api/src/services/push.ts` and `topo/push_send.py` each keep their own copy of
two things: the notification-type -> static title map, and the allowlist of
payload keys a push may carry. Nothing failed when they diverged, and the
divergence is not visible from either side.

It is not hypothetical. The places rework renamed `canyon_shared` to
`place_shared` and `canyonId` to `placeId` on the TS side; the Python sender
would have kept the old names, and `build_push_messages` RAISES on a
non-allowlisted key — so every push of that type from the Python worker would
have thrown, for a rename in a file the worker does not import. The plan noted
that no guard covered these constants; this is that guard.

Modelled on test_layer_sync.py, which closes the same class for TOPO_LAYERS —
the other structurally unavoidable cross-LANGUAGE mirror.

The two sides are deliberately NOT required to be equal:
  * TITLES: every type Python knows must exist in TS with the SAME title. TS may
    know types Python never sends (Python only sends what the worker raises).
  * KEYS: every key Python allows must be allowed by TS. A key TS allows and
    Python does not is a message Python would refuse to build, so that
    direction is checked too — the allowlists must match exactly, because the
    payload is built by the API and sent by either.

Pure text parsing — no GDAL/PDAL, no worker import.
"""
import ast
import os
import re
import unittest

_HERE = os.path.dirname(__file__)
_PUSH_TS = os.path.join(_HERE, "..", "..", "api", "src", "services", "push.ts")
_PUSH_PY = os.path.join(_HERE, "..", "push_send.py")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _ts_titles():
    """`{ type_name: "Title" }` from push.ts's title map."""
    src = _read(_PUSH_TS)
    block = re.search(
        r"PUSH_TITLES[^=]*=\s*\{(.*?)\n\};", src, re.S
    ) or re.search(
        r"const\s+\w*TITLES\w*[^=]*=\s*\{(.*?)\n\};", src, re.S
    )
    assert block, "no title map found in push.ts"
    return dict(re.findall(r'^\s*(\w+):\s*"([^"]+)"', block.group(1), re.M))


def _ts_allowed_keys():
    src = _read(_PUSH_TS)
    block = re.search(r"ALLOWED_DATA_KEYS\s*=\s*new Set\(\[(.*?)\]\)", src, re.S)
    assert block, "ALLOWED_DATA_KEYS not found in push.ts"
    return set(re.findall(r'"([^"]+)"', block.group(1)))


def _py_module():
    """push_send.py's constants, without importing it (it pulls in firebase)."""
    tree = ast.parse(_read(_PUSH_PY))
    out = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in (
                "PUSH_TITLES",
                "ALLOWED_DATA_KEYS",
            ):
                out[target.id] = ast.literal_eval(node.value)
    return out


class PushConstantsSync(unittest.TestCase):
    def setUp(self):
        self.ts_titles = _ts_titles()
        self.ts_keys = _ts_allowed_keys()
        py = _py_module()
        self.py_titles = py.get("PUSH_TITLES", {})
        self.py_keys = set(py.get("ALLOWED_DATA_KEYS", set()))

    def test_parsed_something(self):
        # A regex that silently matches nothing would make every other
        # assertion here vacuously true.
        self.assertGreater(len(self.ts_titles), 3)
        self.assertGreater(len(self.ts_keys), 3)
        self.assertGreater(len(self.py_titles), 3)
        self.assertGreater(len(self.py_keys), 3)

    def test_python_knows_no_type_the_api_does_not(self):
        unknown = sorted(set(self.py_titles) - set(self.ts_titles))
        self.assertEqual(
            unknown,
            [],
            "push_send.py sends notification types the API no longer raises: "
            f"{unknown}",
        )

    def test_titles_agree_where_both_sides_know_the_type(self):
        for kind, title in sorted(self.py_titles.items()):
            self.assertEqual(
                title,
                self.ts_titles[kind],
                f"the title for {kind!r} differs between push.ts and push_send.py",
            )

    def test_payload_key_allowlists_match_exactly(self):
        # build_push_messages RAISES on a non-allowlisted key, so a key the API
        # puts in a payload and Python does not allow is a hard failure at send
        # time — for a rename in a file the worker never imports.
        self.assertEqual(
            sorted(self.py_keys),
            sorted(self.ts_keys),
            "the push payload key allowlists have drifted",
        )


if __name__ == "__main__":
    unittest.main()
