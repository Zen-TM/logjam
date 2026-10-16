#!/usr/bin/env python3
"""Which Terraform roots carry an S3 backend, and which must never.

    check-terraform-backends.py [repo root]     check infra/terraform/envs/*
    check-terraform-backends.py --self-test

`envs/prod` and `envs/github` apply against real AWS and real GitHub settings,
so their state has to live in the remote S3 bucket from `terraform/bootstrap`
(shared between the laptop, the plan workflow and the apply workflow, locked).
`envs/local` is the opposite promise: its state is disposable and stays a local,
gitignored file, because `make reset` wipes it alongside the MiniStack volume.

Getting this wrong is quiet and expensive in both directions. A `local` root
that grows the prod backend writes throwaway dev resources into the same state
file prod applies from — the next prod plan then proposes destroying whatever
the laptop made. A `prod` root that loses its backend applies from a state file
that exists on one machine only, with no lock and no history. Neither is a
`fmt` problem and neither shows up in a plan until it is too late.

Mutations that turn the self-test red: letting the expected set default to
"whatever is on disk" fails "prod keeps its backend"; reading only
`versions.tf` fails "a backend in any .tf counts"; a missing root counts as
clean instead of as a missing root fails "a vanished root is a failure".
"""

import os
import re
import sys

# The roots that MUST bind to the remote backend. Everything else under
# infra/terraform/envs/ must not have one at all.
S3_BACKENDS = {"prod", "github"}
ANY_BACKEND = re.compile(r'^\s*backend\s+"(\w+)"', re.MULTILINE)
ENVS = os.path.join("infra", "terraform", "envs")


def backends_in(text):
    """The backend types a root's .tf files declare, e.g. {"s3"}."""
    return set(ANY_BACKEND.findall(text))


def roots(repo):
    """{root name: its first backend type, or None} for every root under envs/."""
    base = os.path.join(repo, ENVS)
    found = {}
    for name in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        path = os.path.join(base, name)
        if not os.path.isdir(path):
            continue
        declared = set()
        for entry in sorted(os.listdir(path)):
            if entry.endswith(".tf"):
                with open(os.path.join(path, entry), encoding="utf-8") as fh:
                    declared |= backends_in(fh.read())
        found[name] = declared
    return found


def problems(found):
    """Errors for a {root: {backend types}} mapping."""
    errors = []
    for name in sorted(S3_BACKENDS):
        if name not in found:
            errors.append(
                f"{ENVS}/{name} is gone — update check-terraform-backends.py, "
                "or restore the root. Its state must stay in the remote bucket."
            )
        elif "s3" not in found[name]:
            errors.append(
                f'{ENVS}/{name} declares no `backend "s3"`. Prod and GitHub '
                "settings apply from a shared, locked state file, never from a "
                "file on one machine (infra/AGENTS.md)."
            )
    for name, declared in sorted(found.items()):
        if name not in S3_BACKENDS and declared:
            errors.append(
                f"{ENVS}/{name} declares {sorted(declared)} backend(s). A local "
                "root's state is disposable and gitignored: binding it to the "
                "prod bucket means the next prod plan proposes destroying "
                "whatever the laptop made (infra/terraform/envs/local/versions.tf)."
            )
    return errors


def self_test():
    fails = 0

    def check(desc, ok):
        nonlocal fails
        print(("ok   — " if ok else "FAIL — ") + desc)
        fails += 0 if ok else 1

    real = {"prod": {"s3"}, "github": {"s3"}, "local": set()}
    check("the real shape is clean", problems(real) == [])
    check(
        "prod keeps its backend",
        problems({**real, "prod": set()})
        and "prod" in problems({**real, "prod": set()})[0],
    )
    check(
        "github keeps its backend",
        any("github" in e for e in problems({**real, "github": set()})),
    )
    check(
        "local must not grow one",
        any("local" in e for e in problems({**real, "local": {"s3"}})),
    )
    check(
        "a non-s3 backend there is caught too",
        any("local" in e for e in problems({**real, "local": {"gcs"}})),
    )
    check(
        "a vanished root is a failure",
        any("prod is gone" in e for e in problems({"github": {"s3"}, "local": set()})),
    )
    check(
        "a backend in any .tf counts",
        backends_in('terraform {\n  backend "s3" {\n  }\n}') == {"s3"},
    )
    check(
        "a comment about a backend is not one",
        backends_in('# No backend "s3" here.') == set(),
    )
    return fails


def main(argv):
    if argv[:1] == ["--self-test"]:
        return 1 if self_test() else 0
    repo = argv[0] if argv else "."
    found = roots(repo)
    errors = problems(found)
    for e in errors:
        print(f"::error::{e}")
    if not errors:
        names = ", ".join(sorted(found))
        print(f"backends as declared: {names}.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
