#!/usr/bin/env python3
"""The Node major is declared once, in mise.toml, and every pin agrees.

    check-node-version.py [root]     check the repo
    check-node-version.py --self-test

The toolchain Node is repeated in every workflow's `node-version`, in
`api/Dockerfile`'s image, and in the `@types/node` pins of api/frontend/mobile.
A pin left behind breaks far from the cause (the frontend tests on Node 26's
shadowed localStorage, or an api image on a version its types never saw), so
all of them must equal mise.toml's major.

The Lambda is the exception: its types must match its own runtime, not the
toolchain, because AWS decides when a runtime exists. That pair is checked
against `lambda_cognito_email.tf` instead.

A Node Lambda is any directory under `infra/lambda` with a `package.json`, so a
new one is checked without being listed here. It is also installed by
`make setup`, built by the plan, apply and drift workflows and watched by
Dependabot: each of those files must name its directory.

Mutations that turn the self-test red: a workflow pin behind mise, the api
image behind mise, an @types/node pin ahead of mise, and the Lambda's types
disagreeing with its runtime, the Lambda's esbuild target disagreeing with its
runtime, a setup-node step with no node-version, a Lambda directory one of
those files does not name, and a pin class that matches nothing (a regex
that stops matching must not pass the check by checking nothing).
"""

import re
import sys
from pathlib import Path

WORKFLOW_PIN = re.compile(r"^\s*node-version:\s*\"?([^\"\s]+)\"?\s*(?:#.*)?$")
DOCKER_PIN = re.compile(r"^\s*FROM\s+(?:--\S+\s+)*node:(\S+)")
SETUP_NODE = re.compile(r"uses:\s*actions/setup-node@")
ESBUILD_TARGET = re.compile(r'target:\s*"node(\d+)"')
TYPES_PIN = re.compile(r'"@types/node"\s*:\s*"([^"]+)"')
MISE_PIN = re.compile(r'^\s*node\s*=\s*"([^"]+)"', re.MULTILINE)
RUNTIME = re.compile(r'runtime\s*=\s*"nodejs(\d+)\.x"')

ROOT = Path(__file__).resolve().parents[2]
# Every file that names each Node Lambda's directory.
REGISTERED_IN = (
    "Makefile",
    ".github/dependabot.yml",
    ".github/workflows/terraform-plan.yml",
    ".github/workflows/terraform-apply.yml",
    ".github/workflows/terraform-drift.yml",
)


def lambdas(root):
    """The pre sign-up function takes its runtime from the email sender's
    (cognito_signup_cap.tf), so one runtime check covers every Lambda."""
    return sorted(p.parent.name for p in (root / "infra/lambda").glob("*/package.json"))


def major(value):
    match = re.search(r"\d+", value)
    return match.group(0) if match else None


def find(paths, pattern):
    """(path, line number, matched value) for every line a pattern hits."""
    found = []
    for path in paths:
        for number, line in enumerate(path.read_text().splitlines(), 1):
            match = pattern.search(line)
            if match:
                found.append((path, number, match.group(1)))
    return found


def pins(root):
    mise = MISE_PIN.search((root / "mise.toml").read_text())
    names = lambdas(root)
    runtime = RUNTIME.search(
        (root / "infra/terraform/envs/prod/lambda_cognito_email.tf").read_text()
    )
    lambda_types = find(
        [root / f"infra/lambda/{name}/package.json" for name in names], TYPES_PIN
    )
    workflows = sorted((root / ".github/workflows").glob("*.yml"))
    unpinned = [
        path
        for path in workflows
        if len(SETUP_NODE.findall(path.read_text())) != len(find([path], WORKFLOW_PIN))
    ]
    target = find(
        [root / f"infra/lambda/{name}/build.mjs" for name in names], ESBUILD_TARGET
    )
    return {
        "lambdas": names,
        "unregistered": [
            (path, name)
            for path in REGISTERED_IN
            for name in names
            if not re.search(
                rf"infra/lambda/{re.escape(name)}(?![\w-])", (root / path).read_text()
            )
        ],
        "unpinned": unpinned,
        "lambda_target": [value for _, _, value in target],
        "mise": major(mise.group(1)) if mise else None,
        "workflows": find(workflows, WORKFLOW_PIN),
        "docker": find([root / "api/Dockerfile"], DOCKER_PIN),
        "types": find(
            [
                root / package / "package.json"
                for package in ("api", "frontend", "mobile")
            ],
            TYPES_PIN,
        ),
        "lambda_types": [
            (path, number, major(value)) for path, number, value in lambda_types
        ],
        "lambda_runtime": runtime.group(1) if runtime else None,
    }


def problems(found):
    errors = []
    mise = found["mise"]
    if mise is None:
        return ["mise.toml: no node pin"]
    for path, number, value in found["workflows"] + found["docker"] + found["types"]:
        if major(value) != mise:
            errors.append(f"{path}:{number}: {value} != mise.toml's node {mise}")
    for name in ("workflows", "docker", "types"):
        if not found[name]:
            errors.append(f"no {name} pin found: its pattern matches nothing")
    if found["lambda_runtime"] is None:
        errors.append("lambda_cognito_email.tf: no nodejsNN.x runtime")
        return errors
    for path in found["unpinned"]:
        errors.append(f"{path}: a setup-node step has no node-version")
    if not found["lambdas"]:
        errors.append("no Lambda found under infra/lambda: its pattern matches nothing")
    for path, name in found["unregistered"]:
        errors.append(
            f"{path}: does not name infra/lambda/{name} (make setup installs every "
            "Node Lambda, plan, apply and drift build it, Dependabot watches it)"
        )
    if found["lambda_target"] != [found["lambda_runtime"]] * len(found["lambdas"]):
        errors.append(
            f"build.mjs esbuild target node{found['lambda_target']} != Lambda "
            f"runtime nodejs{found['lambda_runtime']}.x"
        )
    if len(found["lambda_types"]) != len(found["lambdas"]):
        errors.append("a Lambda has no @types/node pin")
    for path, number, value in found["lambda_types"]:
        if value != found["lambda_runtime"]:
            errors.append(
                f"{path}:{number}: @types/node {value} != Lambda runtime "
                f"nodejs{found['lambda_runtime']}.x"
            )
    return errors


def self_test():
    base = {
        "lambdas": ["a", "b"],
        "unregistered": [],
        "unpinned": [],
        "lambda_target": ["22", "22"],
        "mise": "26",
        "workflows": [(Path("ci.yml"), 1, "26")],
        "docker": [(Path("api/Dockerfile"), 1, "26-slim")],
        "types": [(Path("frontend/package.json"), 1, "^26.6.5")],
        "lambda_types": [(Path("package.json"), 1, "22")] * 2,
        "lambda_runtime": "22",
    }
    cases = [
        ("all pins agree", "pass", {}),
        ("a workflow behind mise", "fail", {"workflows": [(Path("ci.yml"), 1, "22")]}),
        (
            "the api image behind mise",
            "fail",
            {"docker": [(Path("api/Dockerfile"), 1, "25-slim")]},
        ),
        (
            "types ahead of mise",
            "fail",
            {"types": [(Path("frontend/package.json"), 1, "^24.19.1")]},
        ),
        (
            "the Lambda's types ahead of its runtime",
            "fail",
            {
                "lambda_types": [
                    (Path("package.json"), 1, "22"),
                    (Path("package.json"), 1, "26"),
                ]
            },
        ),
        (
            "a Lambda with no @types/node pin",
            "fail",
            {"lambda_types": [(Path("package.json"), 1, "22")]},
        ),
        ("a setup-node with no pin", "fail", {"unpinned": [Path("ci.yml")]}),
        (
            "the esbuild target ahead of the runtime",
            "fail",
            {"lambda_target": ["22", "26"]},
        ),
        ("a Lambda with no esbuild target", "fail", {"lambda_target": ["22"]}),
        (
            "a Lambda the Makefile does not name",
            "fail",
            {"unregistered": [("Makefile", "b")]},
        ),
        (
            "no Lambda found",
            "fail",
            {"lambdas": [], "lambda_target": [], "lambda_types": []},
        ),
        ("no mise pin", "fail", {"mise": None}),
        ("no workflow pins found", "fail", {"workflows": []}),
        ("no api image pin found", "fail", {"docker": []}),
        ("no @types/node pins found", "fail", {"types": []}),
        ("no Lambda runtime found", "fail", {"lambda_runtime": None}),
    ]
    failures = 0
    for description, want, overrides in cases:
        found = {**base, **overrides}
        got = "pass" if not problems(found) else "fail"
        if got == want:
            print(f"ok   — {description}")
        else:
            print(f"FAIL — {description}: want {want}, got {got}")
            failures = 1
    return failures


def main(root):
    found = pins(root)
    errors = problems(found)
    for error in errors:
        print(f"::error::{error}")
    if errors:
        return 1
    print(
        f"Node {found['mise']} for every toolchain; the Lambda is "
        f"nodejs{found['lambda_runtime']}.x with @types/node "
        f"{found['lambda_types'][0][2]}."
    )
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        sys.exit(self_test())
    sys.exit(main(Path(sys.argv[1]) if sys.argv[1:] else ROOT))
