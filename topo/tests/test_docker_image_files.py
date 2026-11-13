"""Every local module the workers import must be COPYed into the image.

If an imported module is missing from the Dockerfile's COPY list, lazy
imports (such as `push_send` or `email_send` in worker.py) raise
ModuleNotFoundError at runtime after the status flip has committed.

Two hand-kept lists that must agree — the modules the entrypoints import and
the Dockerfile COPY list — get a deriving test rather than a comment.
This walks the import graph from the ECS task commands and fails if
anything reachable is missing from the image.

Pure AST + text parsing: no imports of the modules themselves, so it runs on
the dev host with no GDAL/PDAL/psycopg2 (`python -m unittest discover -s tests`).
"""

import ast
import os
import re
import unittest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_DOCKERFILE = os.path.join(_ROOT, "Dockerfile")

# The commands the ECS task defs run, and the script a RunTask command override
# runs (see the Dockerfile entrypoint note).
_ENTRYPOINTS = (
    "worker.py",
    # worker.py runs it as a subprocess, as it runs pipeline.py.
    "sharpen.py",
    "export_worker.py",
    "build_place_registry.py",
    "build_gauges.py",
    "build_fire_history.py",
    "build_coverage.py",
    "build_nsw_dem.py",
)


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
        m.group(1) for m in re.finditer(r"^COPY\s+(\S+)\s+\S+\s*$", body, re.MULTILINE)
    }


def _is_copied(relpath, sources):
    return relpath in sources or any(
        src.endswith("/") and relpath.startswith(src) for src in sources
    )


# Packages that only build or fetch: none belongs in the image (a `-dev` suffix
# is checked on its own).
_BUILD_ONLY_PACKAGES = frozenset(
    {
        "build-essential",
        "g++",
        "gcc",
        "make",
        "pkg-config",
        "software-properties-common",
        "gpg-agent",
        "python3-pip",
        "curl",
        "wget",
        "unzip",
    }
)


def _dockerfile_lines():
    """Instructions with comment lines dropped and `\\` continuations joined."""
    with open(_DOCKERFILE, encoding="utf-8") as fh:
        raw = [ln.rstrip("\n") for ln in fh if not ln.lstrip().startswith("#")]
    joined, current = [], ""
    for ln in raw:
        if ln.endswith("\\"):
            current += ln[:-1] + " "
        else:
            joined.append(" ".join((current + ln).split()))
            current = ""
    return joined


def _final_stage():
    """The Dockerfile's instructions after its last FROM: the shipped image."""
    lines = _dockerfile_lines()
    last_from = max(i for i, ln in enumerate(lines) if ln.startswith("FROM "))
    return lines[last_from:]


def _final_stage_apt_packages():
    packages = set()
    for ln in _final_stage():
        if "apt-get install" not in ln:
            continue
        words = ln.split("apt-get install", 1)[1].split("&&", 1)[0].split()
        packages.update(w for w in words if not w.startswith("-"))
    return packages


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

    # Mutation: turn the last line back into `ENTRYPOINT [...]` and a RunTask
    # command override (the slope build) or `docker compose run topo python3 ...`
    # hands its command to worker.py as arguments, which ignores them.
    def test_the_image_starts_the_worker_as_a_cmd(self):
        with open(_DOCKERFILE, encoding="utf-8") as fh:
            lines = [ln.strip() for ln in fh if not ln.lstrip().startswith("#")]
        self.assertEqual([ln for ln in lines if ln.startswith("ENTRYPOINT")], [])
        cmds = [ln for ln in lines if ln.startswith("CMD")]
        self.assertEqual(cmds[-1], 'CMD ["python3", "/app/worker.py"]')

    # Mutation: add `build-essential` (or `libgdal-dev`) to the last stage's
    # apt-get install and the image ships a compiler (or GDAL's headers) again.
    def test_the_last_stage_installs_runtime_packages_only(self):
        installed = _final_stage_apt_packages()
        # Floor: a parse that found nothing would pass the check below.
        for needed in ("python3", "gdal-bin", "python3-gdal", "pdal"):
            self.assertIn(needed, installed)
        build_only = sorted(
            p for p in installed if p.endswith("-dev") or p in _BUILD_ONLY_PACKAGES
        )
        self.assertEqual(
            build_only,
            [],
            "the last stage is the image a Fargate task pulls before the worker "
            "starts; build in an earlier stage and COPY --from the result",
        )

    # Mutation: drop `--no-install-recommends` from one apt-get install, or its
    # `rm -rf /var/lib/apt/lists/*`, and the layer carries recommended packages
    # or the package lists.
    def test_every_apt_step_is_lean_and_cleans_its_lists(self):
        steps = [ln for ln in _final_stage() if "apt-get install" in ln]
        self.assertGreaterEqual(len(steps), 2)
        for step in steps:
            self.assertIn("--no-install-recommends", step)
            self.assertIn("rm -rf /var/lib/apt/lists/*", step)

    def test_walk_actually_reaches_the_lazy_imports(self):
        # Guards the guard: push_send/email_send are imported inside function
        # bodies, which a top-level-only scan would miss entirely.
        reachable = _reachable_files()
        self.assertIn("push_send.py", reachable)
        self.assertIn("email_send.py", reachable)
        self.assertIn("pipeline.py", reachable)


if __name__ == "__main__":
    unittest.main()
