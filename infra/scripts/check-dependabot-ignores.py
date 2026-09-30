#!/usr/bin/env python3
"""Every Dependabot `ignore` rule names the open issue that tracks it.

    check-dependabot-ignores.py [path]     check .github/dependabot.yml
    check-dependabot-ignores.py --self-test

An ignore rule is a deliberate hold, and Dependabot never reminds anyone about
one: the update just stops being proposed. So each rule must sit under a
comment naming its tracking issue (`Tracked in #155`), and at least one issue it
names must be open. Closing the last of them then means lifting the rule, and a
rule whose issues are all closed fails here instead of quietly outliving them.

A comment directly above a rule covers that rule. The comment above the
`ignore:` key covers the rules that have none of their own. YAML comments do
not survive a parse, so this reads the file line by line.

Issue state comes from `gh api` (GH_TOKEN, GITHUB_REPOSITORY). A lookup that
fails (no network, no token) only warns: the check FAILS CLOSED on a rule with
no issue named, and FAILS OPEN on not being able to ask GitHub, so an outage
cannot turn CI red on an unrelated pull request.

Mutations that turn the self-test red: dropping the walk over the comment above
`ignore:` fails "ref above ignore covers rules without their own"; letting a
rule inherit the block's refs when it has its own fails "a rule's own comment
beats the block's"; treating a closed issue as open fails "all closed".
"""

import json
import os
import re
import subprocess
import sys

DEFAULT_PATH = ".github/dependabot.yml"
REF = re.compile(r"#(\d+)")


def parse(text):
    """Return [(line number, directory, dependency name, {issue numbers})]."""
    lines = text.splitlines()
    rules = []
    directory = None
    in_ignore = False
    block_refs = set()
    for n, line in enumerate(lines):
        stripped = line.strip()
        indent = len(line) - len(line.lstrip())
        if stripped.startswith("- package-ecosystem:"):
            directory, in_ignore = None, False
        elif stripped.startswith("directory:") and not in_ignore:
            directory = stripped.split(":", 1)[1].strip().strip("\"'")
        elif stripped == "ignore:" and indent == 4:
            in_ignore = True
            block_refs = comment_block_refs(lines, n)
        elif in_ignore and stripped and not stripped.startswith("#") and indent <= 4:
            in_ignore = False
        elif in_ignore and stripped.startswith("- dependency-name:"):
            name = stripped.split(":", 1)[1].strip().strip("\"'")
            refs = comment_block_refs(lines, n) or block_refs
            rules.append((n + 1, directory, name, refs))
    return rules


def comment_block_refs(lines, n):
    """Issue numbers in the run of comment lines directly above line n."""
    refs = set()
    i = n - 1
    while i >= 0 and lines[i].strip().startswith("#"):
        refs |= set(REF.findall(lines[i]))
        i -= 1
    return {int(r) for r in refs}


def problems(rules, lookup):
    """Return (errors, warnings). lookup(n) -> ('open'|'closed'|'pr', None) or
    (None, reason) when GitHub could not be asked."""
    errors, warnings = [], []
    for line, directory, name, refs in rules:
        where = f"line {line}: ignore of {name!r} in {directory}"
        if not refs:
            errors.append(
                f"{where} names no tracking issue. Add a comment "
                "`Tracked in #NNN` above it."
            )
            continue
        states = {ref: lookup(ref) for ref in sorted(refs)}
        unknown = [f"#{r} ({why})" for r, (s, why) in states.items() if s is None]
        if unknown:
            warnings.append(f"{where}: could not look up {', '.join(unknown)}")
        if unknown or any(s == "open" for s, _ in states.values()):
            continue
        listed = ", ".join(f"#{r}" for r in states)
        if any(s == "pr" for s, _ in states.values()):
            errors.append(
                f"{where}: {listed} has no open issue (a pull request is not an issue)."
            )
        else:
            errors.append(
                f"{where}: tracked only by closed {listed}. Lift the ignore, "
                "or reopen the issue if the hold still applies."
            )
    return errors, warnings


def gh_lookup(number):
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not repo:
        return None, "GITHUB_REPOSITORY is not set"
    try:
        out = subprocess.run(
            ["gh", "api", f"repos/{repo}/issues/{number}"],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        ).stdout
        data = json.loads(out)
    except (OSError, subprocess.SubprocessError, ValueError) as err:
        return None, str(err).splitlines()[0] if str(err) else type(err).__name__
    if "pull_request" in data:
        return "pr", None
    return data.get("state", "open"), None


FIXTURE = """\
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/a"
    # Held. Tracked in #10.
    ignore:
      - dependency-name: "one"
        update-types: ["version-update:semver-major"]
      - dependency-name: "two"
        update-types: ["version-update:semver-major"]
      # Tracked in #12 and #13.
      - dependency-name: "own"
        update-types: ["version-update:semver-major"]

  - package-ecosystem: "npm"
    directory: "/b"
    ignore:
      - dependency-name: "untracked"
        update-types: ["version-update:semver-major"]
      # Tracked in #11.
      - dependency-name: "tracked-own"
        update-types: ["version-update:semver-major"]
      - dependency-name: "spill"
        update-types: ["version-update:semver-major"]

  - package-ecosystem: "npm"
    directory: "/c"
    groups:
      npm:
        patterns:
          - "*"
"""


def self_test():
    fails = 0

    def check(desc, ok):
        nonlocal fails
        print(("ok   — " if ok else "FAIL — ") + desc)
        fails += 0 if ok else 1

    rules = parse(FIXTURE)
    by_name = {name: refs for _, _, name, refs in rules}
    check(
        "finds every rule and nothing else",
        sorted(by_name)
        == sorted(["one", "two", "own", "untracked", "tracked-own", "spill"]),
    )
    check(
        "ref above ignore covers rules without their own",
        by_name["one"] == {10} and by_name["two"] == {10},
    )
    check("a rule's own comment beats the block's", by_name["own"] == {12, 13})
    check("ref above a rule covers that rule", by_name["tracked-own"] == {11})
    check("a rule with no ref has none", by_name["untracked"] == set())
    check("a rule's comment does not spill onto later rules", by_name["spill"] == set())
    check("directory is read", {d for _, d, _, _ in rules} == {"/a", "/b"})

    def lookup(states):
        return lambda n: states.get(n, (None, "unknown"))

    open_ = ("open", None)
    all_open = {10: open_, 11: open_, 12: open_, 13: open_}
    errs, warns = problems(rules, lookup(all_open))
    check(
        "only the rules with no issue are errors",
        len(errs) == 2
        and any("untracked" in e for e in errs)
        and any("spill" in e for e in errs)
        and not warns,
    )
    errs, _ = problems(rules, lookup({**all_open, 10: ("closed", None)}))
    check("all closed", sum("only by closed #10" in e for e in errs) == 2)
    errs, _ = problems(
        rules, lookup({**all_open, 12: ("closed", None), 13: open_})
    )
    check("one open issue is enough", len(errs) == 2)
    errs, _ = problems(rules, lookup({**all_open, 10: ("pr", None)}))
    check("a pull request is not an issue", sum("pull request" in e for e in errs) == 2)
    errs, warns = problems(rules, lookup({}))
    check("a failed lookup warns, never fails", len(errs) == 2 and len(warns) == 4)
    check(
        "the real file parses",
        not os.path.exists(DEFAULT_PATH) or len(parse(open(DEFAULT_PATH).read())) > 0,
    )
    return fails


def main(argv):
    if argv[:1] == ["--self-test"]:
        return 1 if self_test() else 0
    path = argv[0] if argv else DEFAULT_PATH
    rules = parse(open(path).read())
    errors, warnings = problems(rules, gh_lookup)
    for w in warnings:
        print(f"::warning::{w}")
    for e in errors:
        print(f"::error::{e}")
    if not errors:
        print(f"{len(rules)} ignore rules, each under an open tracking issue.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
