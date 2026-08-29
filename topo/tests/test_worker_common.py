"""The worker helpers that are still duplicated must stay identical.

`worker.py` and `export_worker.py` share three helpers via `worker_common.py`.
Two more cannot be shared and stay duplicated:

  - `update_status` — MUST differ: `topo_jobs` has an `updated_at` column and
    `topo_export_jobs` does not, so one shared version would break every export
    status flip (STP-008). Not checked here.
  - `delete_s3_prefix_best_effort` — reads each module's own `BUCKET`, `s3` and
    `log` globals, so sharing it means threading three arguments through for no
    behavioural gain. It IS meant to stay identical, so it gets this guard
    instead of a "keep both copies in sync" comment — the comment had already
    failed silently once (three drifted spots by 2026-08-29).

Docstrings are excluded: each copy names its own job type ("reaped-job" vs
"reaped-export"), which is deliberate.
"""
import ast
import os
import unittest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# Function name -> why it may not live in worker_common.py.
DUPLICATED_BUT_MUST_MATCH = {
    "delete_s3_prefix_best_effort": "reads each worker's own BUCKET/s3/log globals",
}


def _body_without_docstring(path, name):
    tree = ast.parse(open(path, encoding="utf-8").read())
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            body = node.body
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                body = body[1:]
            return "\n".join(ast.dump(stmt) for stmt in body)
    return None


class TestDuplicatedWorkerHelpers(unittest.TestCase):
    def test_duplicated_helpers_have_not_drifted(self):
        for name, why in DUPLICATED_BUT_MUST_MATCH.items():
            a = _body_without_docstring(os.path.join(_ROOT, "worker.py"), name)
            b = _body_without_docstring(os.path.join(_ROOT, "export_worker.py"), name)
            self.assertIsNotNone(a, f"{name} missing from worker.py")
            self.assertIsNotNone(b, f"{name} missing from export_worker.py")
            self.assertEqual(
                a, b,
                f"{name} has drifted between worker.py and export_worker.py "
                f"(it stays duplicated because it {why}) — re-sync the two "
                f"copies, or move it into worker_common.py if it no longer "
                f"needs those globals.",
            )

    def test_shared_helpers_are_not_redefined_locally(self):
        """A copy pasted back into a worker would shadow the shared one."""
        shared = {"compose_database_url", "create_notification", "get_user_email"}
        for filename in ("worker.py", "export_worker.py"):
            tree = ast.parse(open(os.path.join(_ROOT, filename), encoding="utf-8").read())
            local = {
                node.name
                for node in tree.body
                if isinstance(node, ast.FunctionDef) and node.name in shared
            }
            self.assertEqual(
                local, set(),
                f"{filename} redefines {sorted(local)}, shadowing worker_common.py",
            )


if __name__ == "__main__":
    unittest.main()
