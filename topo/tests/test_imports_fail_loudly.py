"""A test module whose import breaks must fail, not skip.

A `try` around a test module's imports swallows a renamed or deleted
function as it would a missing library: the module's tests, guards among
them, are skipped and the suite stays green. A host without GDAL needs no
such `try` (`_native_stub` stands in for it), and a skip for a missing native
library is asked of `_native_stub.is_stubbed`, by name.

Mutation: wrap any test module's imports in a `try`.
"""

import ast
import unittest
from pathlib import Path

TESTS = Path(__file__).parent


def guarded_imports(source: str) -> list[int]:
    """Lines of the `try` statements, wherever they sit, with an import
    anywhere inside them."""
    return [
        node.lineno
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Try)
        and any(
            isinstance(inner, (ast.Import, ast.ImportFrom)) for inner in ast.walk(node)
        )
    ]


class TestImportsFailLoudly(unittest.TestCase):
    def test_no_test_module_wraps_its_imports_in_a_try(self):
        modules = sorted(TESTS.glob("test_*.py"))
        self.assertGreaterEqual(len(modules), 30)
        found = {
            module.name: lines
            for module in modules
            if (lines := guarded_imports(module.read_text()))
        }
        self.assertEqual(found, {})

    def test_the_scan_sees_a_guarded_import(self):
        guarded = "try:\n    import pipeline\nexcept Exception:\n    OK = False\n"
        self.assertEqual(guarded_imports(guarded), [1])
        nested = "if True:\n    try:\n        pass\n    except Exception:\n        import x\n"
        self.assertEqual(guarded_imports(nested), [2])
        self.assertEqual(guarded_imports("import pipeline\n"), [])
        self.assertEqual(guarded_imports("try:\n    f()\nfinally:\n    g()\n"), [])


if __name__ == "__main__":
    unittest.main()
