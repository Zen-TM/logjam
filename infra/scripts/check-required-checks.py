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

Also, because a hung step otherwise holds a runner for six hours, and a deploy
or apply that hangs holds its never-cancelled concurrency group and so every
later deploy: every job has `timeout-minutes`, except a job that calls a
reusable workflow (`uses:` at job level), which cannot carry one; the jobs of
the called workflow do, and are checked here too. And every `curl` in a
workflow or a local action that downloads from a literal URL (not localhost)
carries `-f` (an error page is not saved as the download) and `--retry`
(a download outage of a few seconds is not a red PR); the gitleaks and
actionlint versions downloaded in ci.yml are the ones mise.toml pins.

Mutations that turn this red: delete one job's `timeout-minutes`; remove
`--retry` or the `-f` from one download in any workflow; change the gitleaks
version in ci.yml or mise.toml but not the other; rename a required job (or its
`name:`); add a `paths:` filter to rollback-compat.yml's pull_request trigger;
turn terraform-ci.yml's `validate` back into a matrix.

Usage: check-required-checks.py   (from anywhere in the repo; needs PyYAML)
"""

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
ACTIONS = ROOT / ".github" / "actions"
MISE = ROOT / "mise.toml"
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


# `curl ... https://host/...` up to the end of its command; line continuations
# are joined first. A localhost URL is a health poll, not a download.
CURL = re.compile(r"\bcurl\b([^\n|;&]*)")
DOWNLOAD_URL = re.compile(r"https?://(?!localhost|127\.0\.0\.1)")
FAIL_FLAG = re.compile(r"(?:^|\s)(?:--fail\b|-[A-Za-z]*f[A-Za-z]*(?=\s))")


def downloads(script):
    for match in CURL.finditer(script.replace("\\\n", " ")):
        if DOWNLOAD_URL.search(match.group(1)):
            yield match.group(0).strip()


def run_scripts(doc):
    """Every `run:` of every job step, and of a composite action's steps."""
    jobs = (doc.get("jobs") or {}).values()
    steps = [s for j in jobs for s in j.get("steps") or []]
    steps += (doc.get("runs") or {}).get("steps") or []
    return [s["run"] for s in steps if "run" in s]


def mise_version(tool):
    match = re.search(rf'^{tool}\s*=\s*"([^"]+)"', MISE.read_text(), re.M)
    return match.group(1) if match else None


def check_hygiene(failures):
    found = 0
    for path in sorted(WORKFLOWS.glob("*.yml")) + sorted(
        ACTIONS.glob("**/action.y*ml")
    ):
        doc = yaml.safe_load(path.read_text()) or {}
        name = path.relative_to(ROOT / ".github")
        for job_id, job in (doc.get("jobs") or {}).items():
            if "uses" not in job and "timeout-minutes" not in job:
                failures.append(
                    f"{name} job {job_id!r} has no timeout-minutes. Add one at about 2 to 3 times "
                    "its longest green run (gh run list, then gh run view --json jobs): a hung "
                    "step otherwise holds the runner for six hours, and a deploy's "
                    "concurrency group, which never cancels, for every later deploy."
                )
        for script in run_scripts(doc):
            for command in downloads(script):
                found += 1
                if not FAIL_FLAG.search(command) or "--retry " not in command + " ":
                    failures.append(
                        f"{name}: download without -f and --retry: {command[:90]}... Use "
                        "`curl -fsSL --retry 5 --retry-delay 10 --retry-all-errors`, so an "
                        "error page is not kept as the file and a short outage is retried."
                    )
    if found < 4:
        failures.append(
            f"found only {found} downloading curl commands, expected at least 4: "
            "did the scan stop matching?"
        )

    ci = (WORKFLOWS / "ci.yml").read_text()
    for tool, repo in (
        ("gitleaks", "gitleaks/gitleaks"),
        ("actionlint", "rhysd/actionlint"),
    ):
        pinned = re.findall(rf"{repo}/releases/download/v([\d.]+)/", ci)
        if not pinned or set(pinned) != {mise_version(tool)}:
            failures.append(
                f"{tool}: ci.yml downloads {sorted(set(pinned)) or 'nothing'} but mise.toml pins "
                f"{mise_version(tool)!r}. Make them one version, and replace the sha256 in "
                "ci.yml's install step with that release's (its checksums file lists it)."
            )


def main():
    failures, reported = [], set()
    check_hygiene(failures)
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
        f"ok   — all {len(required)} required checks are reported on every pull request; "
        "every job has a timeout and every download retries"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
