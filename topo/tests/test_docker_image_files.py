"""Every local module the workers import must be COPYed into the image (STP-006).

`push_send.py` (added 2026-07-23) was never added to the Dockerfile's COPY
list, so any freshly built image raised ModuleNotFoundError at worker.py's
lazy `from push_send import send_push` — which fires AFTER the `complete`
status flip has committed, taking the self-clean path that deletes the
finished job's S3 outputs. The exact same defect had already happened once
(743b1a3, "copy email_send.py into worker image").

Two hand-kept lists that must agree — the modules the entrypoints import and
the Dockerfile COPY list — so per CLAUDE.md they get a deriving test rather
than a comment. This walks the import graph from the two ENTRYPOINT targets
and fails if anything reachable is missing from the image.

Pure AST + text parsing: no imports of the modules themselves, so it runs on
the dev host with no GDAL/PDAL/psycopg2 (`python -m unittest discover -s tests`).
"""
import ast
import os
import re
import unittest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_DOCKERFILE = os.path.join(_ROOT, "Dockerfile")

# The two commands the ECS task defs run (see the Dockerfile entrypoint note).
_ENTRYPOINTS = ("worker.py", "export_worker.py")


def _local_module_path(name):
    """Return the path of local module `name`, or None if it isn't ours."""
    module = os.path.join(_ROOT, name + ".py")
    if os.path.isfile(module):
        return module
    package = os.path.join(_ROOT, name, "__init__.py")
    if os.path.isfile(package):
        return package
    return None


def _imported_names(path):
    """Top-level names imported by `path`, including function-local imports."""
    with open(path, encoding="utf-8") as fh:
        tree = ast.parse(fh.read(), filename=path)
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                names.add(node.module.split(".")[0])
    return names


def _reachable_files():
    """Every local .py file reachable from the entrypoints, repo-relative."""
    queue = [os.path.join(_ROOT, e) for e in _ENTRYPOINTS]
    seen = set()
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        # A package pulls in its whole directory (the Dockerfile copies dirs).
        if os.path.basename(path) == "__init__.py":
            directory = os.path.dirname(path)
            for entry in sorted(os.listdir(directory)):
                if entry.endswith(".py"):
                    queue.append(os.path.join(directory, entry))
        for name in _imported_names(path):
            local = _local_module_path(name)
            if local:
                queue.append(local)
    return {os.path.relpath(p, _ROOT) for p in seen}


def _copied_sources():
    """COPY source arguments from the Dockerfile (dirs keep their slash)."""
    with open(_DOCKERFILE, encoding="utf-8") as fh:
        body = fh.read()
    return {
        m.group(1)
        for m in re.finditer(r"^COPY\s+(\S+)\s+\S+\s*$", body, re.MULTILINE)
    }


def _is_copied(relpath, sources):
    return relpath in sources or any(
        src.endswith("/") and relpath.startswith(src) for src in sources
    )


class TestDockerImageFiles(unittest.TestCase):
    def test_every_imported_local_module_is_copied(self):
        sources = _copied_sources()
        missing = sorted(
            rel for rel in _reachable_files() if not _is_copied(rel, sources)
        )
        self.assertEqual(
            missing,
            [],
            "module(s) imported by the topo workers but never COPYed into the "
            "image — a fresh build raises ModuleNotFoundError at runtime: "
            f"{missing}. Add a COPY line to topo/Dockerfile.",
        )

    def test_walk_actually_reaches_the_lazy_imports(self):
        # Guards the guard: push_send/email_send are imported inside function
        # bodies, which a top-level-only scan would miss entirely.
        reachable = _reachable_files()
        self.assertIn("push_send.py", reachable)
        self.assertIn("email_send.py", reachable)
        self.assertIn("pipeline.py", reachable)


if __name__ == "__main__":
    unittest.main()
