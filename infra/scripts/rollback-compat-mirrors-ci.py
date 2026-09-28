#!/usr/bin/env python3
"""rollback-compat.yml must boot the live release exactly as ci.yml's
api-integration job boots this one: same services, same env, same wait
steps. Otherwise a variable added to api-integration only (with the code
that needs it) makes the next migration PR's rollback-compat boot that code
without it and go red for a reason unrelated to the PR.

Mutation that turns this red: add a variable to either job's env block.

Usage: rollback-compat-mirrors-ci.py   (from anywhere in the repo; needs PyYAML)
"""

import sys
from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
# rollback-compat's own additions, which api-integration has no use for.
OWN_ENV = {"PROD_API_URL", "LIVE_DIR"}
WAIT_STEPS = ["Wait for MiniStack and create buckets", "Wait for API"]


def job(file, name):
    return yaml.safe_load((WORKFLOWS / file).read_text())["jobs"][name]


def step_runs(j):
    return {s["name"]: s.get("run") for s in j["steps"] if "name" in s}


def main():
    ci = job("ci.yml", "api-integration")
    rc = job("rollback-compat.yml", "rollback-compat")
    failures = []

    if ci["services"] != rc["services"]:
        failures.append("services differ")

    rc_env = {k: v for k, v in rc["env"].items() if k not in OWN_ENV}
    for key in sorted(set(ci["env"]) | set(rc_env)):
        if ci["env"].get(key) != rc_env.get(key):
            failures.append(
                f"env {key}: ci.yml {ci['env'].get(key)!r}, "
                f"rollback-compat.yml {rc_env.get(key)!r}"
            )

    ci_runs, rc_runs = step_runs(ci), step_runs(rc)
    for name in WAIT_STEPS:
        if ci_runs.get(name) is None or ci_runs.get(name) != rc_runs.get(name):
            failures.append(f"step {name!r} differs or is missing")

    for f in failures:
        print(f"FAIL — {f}")
    if failures:
        print("rollback-compat.yml must mirror ci.yml's api-integration job.")
        return 1
    print(
        "ok   — rollback-compat.yml mirrors api-integration's services, env and wait steps"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
