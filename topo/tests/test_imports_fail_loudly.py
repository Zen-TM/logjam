"""A test module whose import breaks must fail, not skip.

Twelve modules here once wrapped their imports in `try: ... except Exception`
and skipped every class when the import failed. That was meant for a host
without GDAL, which `_native_stub` already covers, but it also swallowed a
renamed or deleted function: the module's tests, guards among them, stopped
running and the suite stayed green. A skip for a missing native library is
asked of `_native_stub.is_stubbed`, by name.

Mutation: wrap any test module's imports in a module-level `try`.
"""

import ast
import unittest
from pathlib import Path

TESTS = Path(__file__).parent


def guarded_imports(source: str) -> list[int]:
    """Lines of module-level `try` statements with an import in their body."""
    return [
        node.lineno
        for node in ast.parse(source).body
        if isinstance(node, ast.Try)
        and any(isinstance(inner, (ast.Import, ast.ImportFrom)) for inner in node.body)
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
        self.assertEqual(guarded_imports("import pipeline\n"), [])


if __name__ == "__main__":
    unittest.main()
