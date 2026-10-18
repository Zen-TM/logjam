#!/usr/bin/env python3
"""rollback-compat.yml must boot the live release exactly as ci.yml's
api-integration job boots this one: same services, same env, same wait
steps. Otherwise a variable added to api-integration only (with the code
that needs it) makes the next migration PR's rollback-compat boot that code
without it and go red for a reason unrelated to the PR.

topo-e2e boots the same API, so its services must equal api-integration's and
its env carry every variable of api-integration's, less what only that suite
needs (API_ONLY_ENV).

Mutation that turns this red: add a variable to either job's env block.

Usage: rollback-compat-mirrors-ci.py   (from anywhere in the repo; needs PyYAML)
"""

import sys
from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
# rollback-compat's own additions, which api-integration has no use for.
OWN_ENV = {"PROD_API_URL", "LIVE_DIR"}
# api-integration's env that topo-e2e leaves out on purpose: no RunTask (so no
# ECS_*) and no suite hammering the rate limiter.
API_ONLY_ENV = {
    "API_URL",
    "ECS_SUBNETS",
    "ECS_SECURITY_GROUPS",
    "RATE_LIMIT_GLOBAL_MAX",
    "RATE_LIMIT_USER_PATCH_MAX",
}
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

    topo = job("ci.yml", "topo-e2e")
    if ci["services"] != topo["services"]:
        failures.append("topo-e2e services differ from api-integration's")
    for key in sorted(set(ci["env"]) - API_ONLY_ENV):
        if ci["env"][key] != topo["env"].get(key):
            failures.append(
                f"env {key}: api-integration {ci['env'][key]!r}, "
                f"topo-e2e {topo['env'].get(key)!r}"
            )

    for f in failures:
        print(f"FAIL — {f}")
    if failures:
        print(
            "rollback-compat.yml and topo-e2e must mirror ci.yml's api-integration job."
        )
        return 1
    print(
        "ok   — rollback-compat.yml and topo-e2e mirror api-integration's services, env and wait steps"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
