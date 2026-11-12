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

Also, so that two lists agree by construction: every job a pull request starts
is a required check or is in NOT_REQUIRED below with its reason (a new job is a
decision, not an accident), and a matrix job is needed by a required gate; every
script with a `--self-test` flag, every directory of `*.tftest.hcl` and every
package under infra/lambda with a `test` script is run by a workflow step; and
no test file commits a focused `.only`.

Mutations that turn this red: add a job to dco.yml, or remove "brain-postgres"
from required_checks or from the second copy of the list in guards.tftest.hcl; delete `ci-scope.sh --self-test`, a `terraform ... test`
or a Lambda's `npm test` step from the workflows; add `it.only(` to a test file;
delete one job's `timeout-minutes`; remove
`--retry` or the `-f` from one download in any workflow; change the gitleaks
version in ci.yml or mise.toml but not the other; rename a required job (or its
`name:`); add a `paths:` filter to rollback-compat.yml's pull_request trigger;
turn terraform-ci.yml's `validate` back into a matrix.

Usage: check-required-checks.py   (from anywhere in the repo; needs PyYAML)
"""

import re
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
ACTIONS = ROOT / ".github" / "actions"
MISE = ROOT / "mise.toml"
RULESETS = ROOT / "infra" / "terraform" / "envs" / "github" / "rulesets.tf"
GUARDS = (
    ROOT / "infra" / "terraform" / "envs" / "github" / "tests" / "guards.tftest.hcl"
)
FILTERS = {"paths", "paths-ignore", "branches-ignore"}

# Jobs a pull request starts that are not required checks, keyed
# "<workflow>:<job id>", each with why. Matrix jobs are not listed: they are
# reached through the gate job that needs them.
NOT_REQUIRED = {
    "ci.yml:changes": "scope job: decides which heavy jobs run (ci-scope.sh)",
    "mobile-emulator.yml:changes": "scope job",
    "rollback-compat.yml:changes": "scope job",
    "setup-smoke.yml:changes": "scope job",
    "terraform-ci.yml:changes": "scope job",
    "terraform-plan.yml:scope": "scope job",
    "mobile-emulator.yml:emulator": "not required until #723 promotes it, after 14 green nightlies",
    "ota-plan.yml:plan": "ota-hotfix.yml reads the plan's result itself before it publishes",
    "ota-plan.yml:smoke": "part of the OTA plan, as above",
    "ota-plan.yml:ota-plan": "the OTA plan's summary, as above",
    "expo-doctor.yml:nightly-issue": "runs on the nightly schedule only, to open an issue",
}


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


def steps_of(doc):
    """Every step of every job, and of a composite action."""
    jobs = (doc.get("jobs") or {}).values()
    steps = [s for j in jobs for s in j.get("steps") or []]
    return steps + ((doc.get("runs") or {}).get("steps") or [])


def run_scripts(doc):
    return [s["run"] for s in steps_of(doc) if "run" in s]


def pr_triggered(doc):
    on = doc.get("on", doc.get(True)) or {}
    return "pull_request" in on if isinstance(on, (str, list, dict)) else False


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


def git_files():
    return subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.split("\n")


def check_inventory(failures):
    """Everything that looks like a test is run by some workflow step."""
    steps = []
    for path in sorted(WORKFLOWS.glob("*.yml")) + sorted(
        ACTIONS.glob("**/action.y*ml")
    ):
        steps += steps_of(yaml.safe_load(path.read_text()) or {})
    runs = "\n".join(s["run"].replace("\\\n", " ") for s in steps if "run" in s)
    files = git_files()

    # A script that takes the flag, as a shell case or a quoted string.
    flag = re.compile(r"""--self-test\)|(["'])--self-test\1|=\s*--self-test\b""")
    scripts = [
        f
        for f in files
        if re.search(r"\.(sh|py|mjs|js)$", f) and flag.search((ROOT / f).read_text())
    ]
    if len(scripts) < 10:
        failures.append(
            f"found only {len(scripts)} scripts with --self-test, expected 10 or more: did the scan stop matching?"
        )
    for f in scripts:
        if not re.search(rf"(?<![\w/]){re.escape(f)} --self-test\b", runs):
            failures.append(
                f"{f} has a --self-test but no workflow step runs `{f} --self-test`. Add "
                "the step (infra-scripts in ci.yml is where the infra and script self-tests run)."
            )

    roots = sorted(
        {str(Path(f).parent.parent) for f in files if f.endswith(".tftest.hcl")}
    )
    if len(roots) < 2:
        failures.append(
            f"found only {len(roots)} directories with *.tftest.hcl, expected 2 or more"
        )
    for root in roots:
        if not re.search(rf"terraform -chdir={re.escape(root)} test\b", runs):
            failures.append(
                f"{root} has *.tftest.hcl files but no workflow step runs "
                f"`terraform -chdir={root} test`. Add one to terraform-ci.yml."
            )

    packages = [
        str(Path(f).parent)
        for f in files
        if re.fullmatch(r"infra/lambda/[^/]+/package\.json", f)
        and '"test"' in (ROOT / f).read_text()
    ]
    if len(packages) < 2:
        failures.append(
            f"found only {len(packages)} Lambda packages with a test script, expected 2 or more"
        )
    for pkg in packages:
        if not any(
            re.search(r"\bnpm (run )?test\b", s.get("run", ""))
            and (s.get("working-directory") == pkg or pkg in s.get("run", ""))
            for s in steps
        ):
            failures.append(
                f"{pkg} has a test script but no workflow step runs `npm test` in it. Add "
                "one to infra-scripts in ci.yml (no AWS is needed)."
            )

    # A committed `.only` runs one test and skips the rest of its run. Vitest
    # and Playwright refuse it when CI is set; this refuses it everywhere.
    only = re.compile(r"\b(it|test|describe)\.only\(")
    tests = [f for f in files if re.search(r"\.(test|spec)\.[cm]?[jt]sx?$", f)]
    if len(tests) < 100:
        failures.append(
            f"found only {len(tests)} test files, expected 100 or more: did the scan stop matching?"
        )
    for f in tests:
        if only.search((ROOT / f).read_text()):
            failures.append(
                f"{f} commits a focused test (.only), which skips every other test in the run. Remove it."
            )


def check_required(failures, docs):
    """Every job a PR starts is required, or named in NOT_REQUIRED with a reason."""
    required = set(required_checks())
    seen = set()
    for name, doc in docs.items():
        if not pr_triggered(doc):
            continue
        jobs = doc.get("jobs") or {}
        for job_id, job in jobs.items():
            key = f"{name}:{job_id}"
            if (job.get("strategy") or {}).get("matrix"):
                # Its own names carry the matrix values: a gate that needs it
                # must be required, or its failure merges.
                if not any(
                    job_id
                    in (
                        [g.get("needs")]
                        if isinstance(g.get("needs"), str)
                        else g.get("needs") or []
                    )
                    and g.get("name", gid) in required
                    for gid, g in jobs.items()
                ):
                    failures.append(
                        f"matrix job {key} is needed by no required check: add a gate job "
                        "that needs it (see brain-e2e-gate in ci.yml) and require the gate."
                    )
                continue
            seen.add(key)
            if job.get("name", job_id) in required and key in NOT_REQUIRED:
                failures.append(f"{key} is required now: remove it from NOT_REQUIRED.")
            elif job.get("name", job_id) not in required and key not in NOT_REQUIRED:
                failures.append(
                    f"{key} starts on pull requests and is not a required check. If a red "
                    "run must block a merge, add its name to required_checks in "
                    "infra/terraform/envs/github/rulesets.tf and to the list in "
                    "tests/guards.tftest.hcl; if not, add it to NOT_REQUIRED in "
                    "infra/scripts/check-required-checks.py with the reason."
                )
    for key in sorted(set(NOT_REQUIRED) - seen):
        failures.append(
            f"NOT_REQUIRED names {key}, which is not a job a pull request starts: remove the entry."
        )


def main():
    failures, reported = [], set()
    check_hygiene(failures)
    check_inventory(failures)
    check_required(
        failures,
        {
            p.name: yaml.safe_load(p.read_text()) or {}
            for p in sorted(WORKFLOWS.glob("*.yml"))
        },
    )
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
    block = re.search(r"for c in \[(.*?)\]", GUARDS.read_text(), re.S)
    guarded = re.findall(r'"([^"]+)"', block.group(1)) if block else []
    if set(guarded) != set(required):
        failures.append(
            f"the list in {GUARDS.relative_to(ROOT)} differs from required_checks in rulesets.tf "
            f"(only in one: {sorted(set(guarded) ^ set(required))}): change both together."
        )
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
        "every job has a timeout, every download retries, every job is required or named, "
        "and every test is run"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
