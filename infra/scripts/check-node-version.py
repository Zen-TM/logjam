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

Mutations that turn the self-test red: a workflow pin behind mise, the api
image behind mise, an @types/node pin ahead of mise, and the Lambda's types
disagreeing with its runtime, and a pin class that matches nothing (a regex
that stops matching must not pass the check by checking nothing).
"""

import re
import sys
from pathlib import Path

WORKFLOW_PIN = re.compile(r"^\s*node-version:\s*\"?([^\"\s]+)\"?\s*(?:#.*)?$")
DOCKER_PIN = re.compile(r"^\s*FROM\s+node:(\S+)")
TYPES_PIN = re.compile(r'"@types/node"\s*:\s*"([^"]+)"')
MISE_PIN = re.compile(r'^\s*node\s*=\s*"([^"]+)"', re.M)
RUNTIME = re.compile(r'runtime\s*=\s*"nodejs(\d+)\.x"')

ROOT = Path(__file__).resolve().parents[2]


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
    runtime = RUNTIME.search(
        (root / "infra/terraform/envs/prod/lambda_cognito_email.tf").read_text()
    )
    lambda_types = find(
        [root / "infra/lambda/cognito-email-sender/package.json"], TYPES_PIN
    )
    return {
        "mise": major(mise.group(1)) if mise else None,
        "workflows": find(
            sorted((root / ".github/workflows").glob("*.yml")), WORKFLOW_PIN
        ),
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
    if not found["lambda_types"]:
        errors.append("the Lambda has no @types/node pin")
    for path, number, value in found["lambda_types"]:
        if value != found["lambda_runtime"]:
            errors.append(
                f"{path}:{number}: @types/node {value} != Lambda runtime "
                f"nodejs{found['lambda_runtime']}.x"
            )
    return errors


def self_test():
    base = {
        "mise": "26",
        "workflows": [(Path("ci.yml"), 1, "26")],
        "docker": [(Path("api/Dockerfile"), 1, "26-slim")],
        "types": [(Path("frontend/package.json"), 1, "^26.6.5")],
        "lambda_types": [(Path("package.json"), 1, "22")],
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
            {"lambda_types": [(Path("package.json"), 1, "26")]},
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
