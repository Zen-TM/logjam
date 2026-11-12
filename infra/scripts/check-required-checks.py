#!/usr/bin/env python3
"""Every check the main ruleset requires is reported on every pull request.

The ruleset (infra/terraform/envs/github/rulesets.tf, required_checks) names
check contexts as strings; nothing else ties them to the jobs that report
them. A context no job reports, or one whose workflow does not start on every
pull request (a `paths:` filter), never reports at all, and with strict
required checks and no bypass actors every PR waits on it forever.

A job reports its `name:` if it has one, else its id. A matrix job reports
"<name> (<values>)", or one bare name when its `if:` skips it, so it cannot
back a required context and is not counted.

Also: every workflow that scopes its jobs with infra/scripts/ci-scope.sh must
start on every pull request; it skips inside instead.

Mutations that turn this red: rename a required job (or its `name:`); add a
`paths:` filter to rollback-compat.yml's pull_request trigger; turn
terraform-ci.yml's `validate` back into a matrix.

Usage: check-required-checks.py   (from anywhere in the repo; needs PyYAML)
"""

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
RULESETS = ROOT / "infra" / "terraform" / "envs" / "github" / "rulesets.tf"
FILTERS = {"paths", "paths-ignore", "branches-ignore"}


def required_checks():
    block = re.search(r"required_checks\s*=\s*\[(.*?)\]", RULESETS.read_text(), re.S)
    return re.findall(r'"([^"]+)"', block.group(1)) if block else []


def starts_on_every_pr(doc):
    # PyYAML reads the `on:` key as boolean True.
    on = doc.get("on", doc.get(True)) or {}
    if isinstance(on, (str, list)):
        return "pull_request" in on
    if "pull_request" not in on:
        return False
    trigger = on["pull_request"] or {}
    return not (FILTERS & set(trigger))


def main():
    failures, reported = [], set()
    for path in sorted(WORKFLOWS.glob("*.yml")):
        text = path.read_text()
        doc = yaml.safe_load(text) or {}
        every_pr = starts_on_every_pr(doc)
        if "ci-scope.sh scope" in text and not every_pr:
            failures.append(
                f"{path.name} scopes with ci-scope.sh, so it must start on every PR (no paths: filter)"
            )
        if not every_pr:
            continue
        for job_id, job in (doc.get("jobs") or {}).items():
            if (job.get("strategy") or {}).get("matrix"):
                continue
            reported.add(job.get("name", job_id))

    required = required_checks()
    if not required:
        failures.append(
            f"no required_checks list found in {RULESETS.relative_to(ROOT)}"
        )
    for context in required:
        if context not in reported:
            failures.append(
                f"required check {context!r} is not reported on every PR: no non-matrix job "
                "with that id or name: in a workflow that starts on every pull request"
            )

    for f in failures:
        print(f"FAIL — {f}")
    if failures:
        return 1
    print(
        f"ok   — all {len(required)} required checks are reported on every pull request"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
