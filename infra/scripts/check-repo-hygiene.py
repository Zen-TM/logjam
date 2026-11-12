#!/usr/bin/env python3
"""The comment and guard-note rules of the root AGENTS.md, held by a check.

    check-repo-hygiene.py            check the repo (run from anywhere in it)
    check-repo-hygiene.py --self-test

Three rules, each a line of AGENTS.md that nothing else reads:

1. "Cite what a reader can open": a committed file names no audit code
   (SEC-001), no CLAUDE.md or CLAUDE.local.md, no private plan and no
   claude.ai link (CLAUDE.md only imports AGENTS.md, and the others cannot
   be opened by anyone else), and no tracked text names a home directory.
2. "An issue, only while open": a comment that cites #N cites an open issue
   or pull request. GitHub is asked for each number (once per run); a number
   GitHub does not know is not an issue here, and an unreachable API only
   warns, so the check still runs offline.
3. "A new guard test names the mutation": every test file an AGENTS.md names
   in backticks exists and carries a "Mutation that turns it red" note.

Applied migrations are exempt from the first two: Prisma checksums them, so
editing one for a comment would make every database that applied it disagree.

Mutations that turn the self-test red: an audit code, a CLAUDE.md citation
or a home path in a file; a `#N` citation of a closed issue; a named guard
that does not exist or has no mutation note; and a pattern that matches
nothing (a regex that stops matching must not pass by checking nothing).
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

AUDIT_CODE = re.compile(r"\b(?:SEC|PRIV|APIR|ARCH)-\d{3}\b")
PRIVATE_REF = re.compile(
    r"CLAUDE\.(?:local\.)?md|claude\.ai/|(?<![\w/-])private/(?:plans|scripts|runs)/"
)
HOME_PATH = re.compile(r"(?:/home|/Users|/mnt/[a-z]/Users)/(?!<)[A-Za-z][\w.-]*/")
# `#N` after a comment marker: not a colour ("#000"), an entity or an anchor.
COMMENT = re.compile(r"//|/\*|^\s*(?:\*|#|--)|\s#\s")
ISSUE_REF = re.compile(r"(?<![\w&/#\[\"'`-])#(\d{2,4})\b")
TEST_PATH = re.compile(
    r"\.test\.(?:ts|tsx|mjs)$|(?:^|/)test_\w+\.py$|(?:^|/)tests?/[\w.-]+\.sh$|\.sql$"
)
MUTATION_NOTE = re.compile(r"mutations?\b", re.IGNORECASE)

IMMUTABLE = ("api/prisma/migrations/",)
SKIP_SUFFIXES = (".md", ".json", ".lock", ".svg", ".csv", ".geojson", ".pem")
# A file that must name what it forbids, or holds fixtures that look like it.
SELF = "infra/scripts/check-repo-hygiene.py"
FIXTURES = {
    SELF: "names the patterns it forbids",
    "infra/scripts/check-dependabot-ignores.py": "its self-test fixture numbers issues",
}
# (path, token) -> why a match is legitimate. A token is the matched text.
ALLOWED = {
    (
        ".gitignore",
        "CLAUDE.local.md",
    ): "the ignore rule for the personal overrides file",
    (
        "frontend/src/components/feedback/ToastProvider.tsx",
        "#185",
    ): "React's error number",
    ("mobile/src/map/MapScreen.tsx", "#3617"): "maplibre-native's issue number",
    (
        "scripts/pr-closes-check.sh",
        "#12",
    ): "an example of prose the check must not count",
}


def scan_text(path, text):
    """Errors for one file: (line, message). `path` is repo-relative."""
    if path in FIXTURES:
        return []
    errors = []
    frozen = path.endswith(SKIP_SUFFIXES) or path.startswith(IMMUTABLE)
    for number, line in enumerate(text.splitlines(), 1):
        for match in HOME_PATH.finditer(line):
            if (path, match.group(0)) not in ALLOWED:
                message = (
                    f"names a home directory ({match.group(0)}): committed files "
                    "are setup-neutral. Use a <placeholder> or move it to CLAUDE.local.md."
                )
                errors.append((number, message))
        if frozen:
            continue
        for match in AUDIT_CODE.finditer(line):
            message = (
                f"cites audit code {match.group(0)}, which a reader cannot open. "
                "Say what the code cannot, or cite a test or an ADR."
            )
            errors.append((number, message))
        for match in PRIVATE_REF.finditer(line):
            if (path, match.group(0)) not in ALLOWED:
                message = (
                    f"cites {match.group(0)}, which a reader cannot open (CLAUDE.md "
                    "only imports AGENTS.md: cite AGENTS.md, or better, the guard "
                    "test or ADR)."
                )
                errors.append((number, message))
    return errors


def issue_refs(path, text):
    """(line, number) of every `#N` a comment in this file cites."""
    if path in FIXTURES or path.endswith(SKIP_SUFFIXES) or path.startswith(IMMUTABLE):
        return []
    found = []
    for number, line in enumerate(text.splitlines(), 1):
        marker = COMMENT.search(line)
        if not marker:
            continue
        for ref in ISSUE_REF.finditer(line, marker.start()):
            if (path, ref.group(0)) not in ALLOWED:
                found.append((number, int(ref.group(1))))
    return found


def closed_refs(refs, lookup):
    """Errors and warnings for `refs` ({path: [(line, n)]}). lookup(n) is
    'open', 'closed', 'unknown' (not an issue here) or None (GitHub unreachable)."""
    errors, warnings, state = [], [], {}
    for path, cited in sorted(refs.items()):
        for line, n in cited:
            if n not in state:
                state[n] = lookup(n)
            if state[n] == "closed":
                errors.append(
                    f"{path}:{line}: cites #{n}, which is closed. A comment cites an "
                    "issue only while it is open: say what the code cannot instead."
                )
    if None in state.values():
        warnings.append(
            "GitHub could not be asked about "
            + ", ".join(f"#{n}" for n, s in sorted(state.items()) if s is None)
            + ": the closed-issue check did not run for them."
        )
    return errors, warnings


def resolve(token, agents_path, tracked):
    """The tracked file a guard path names: as written from the repo root or
    from its AGENTS.md's directory, else the one file ending in it."""
    here = str(Path(agents_path).parent)
    exact = [
        p
        for p in tracked
        if p == token or p == (token if here == "." else f"{here}/{token}")
    ]
    return exact or [p for p in tracked if p.endswith("/" + token)]


def guard_errors(agents, tracked, text_of):
    """Errors for every test file an AGENTS.md names: it must exist, once, and
    carry a mutation note. `agents` is {path: text}. Returns (errors, resolved)."""
    errors, resolved = [], set()
    for agents_path, text in sorted(agents.items()):
        for token in sorted(set(re.findall(r"`([^`\s*]+)`", text))):
            if not TEST_PATH.search(token):
                continue
            found = resolve(token, agents_path, tracked)
            if len(found) != 1:
                errors.append(
                    f"{agents_path}: names `{token}`, which "
                    + ("matches no tracked file" if not found else "is ambiguous")
                    + ". Fix the path in the AGENTS.md line, or restore the guard."
                )
                continue
            resolved.add(found[0])
            if (found[0], "guard") in ALLOWED:
                continue
            if not MUTATION_NOTE.search(text_of(found[0])):
                errors.append(
                    f"{found[0]}: named as a guard in {agents_path} but has no "
                    '"Mutation that turns it red:" note. Add the line that says what '
                    "to break to turn it red, after running it."
                )
    return errors, resolved


def make_lookup():
    repo = os.environ.get("GITHUB_REPOSITORY")
    cache = {}

    def lookup(n):
        if n in cache:
            return cache[n]
        cache[n] = None
        if not repo:
            return None
        try:
            done = subprocess.run(
                ["gh", "api", f"repos/{repo}/issues/{n}"],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if done.returncode == 0:
            try:
                cache[n] = json.loads(done.stdout).get("state", "open")
            except ValueError:
                pass
        elif "404" in done.stderr:
            cache[n] = "unknown"
        return cache[n]

    return lookup


def self_test():
    fails = 0

    def check(desc, ok):
        nonlocal fails
        print(("ok   — " if ok else "FAIL — ") + desc)
        fails += 0 if ok else 1

    def kinds(path, text):
        return [m for _, m in scan_text(path, text)]

    check("a clean file passes", kinds("a.ts", "// says what the code cannot\n") == [])
    check("an audit code", len(kinds("a.ts", "// the SEC-001 shape\n")) == 1)
    check("CH-001 is test data, not an audit code", kinds("a.ts", "CH-001\n") == [])
    check("a CLAUDE.md citation", len(kinds("a.ts", "// (api/CLAUDE.md)\n")) == 1)
    check("CLAUDE.local.md", len(kinds("a.ts", "// see CLAUDE.local.md\n")) == 1)
    check("a claude.ai link", len(kinds("a.py", "# https://claude.ai/chat/1\n")) == 1)
    check("a private plan", len(kinds("a.sh", "# see private/plans/x.md\n")) == 1)
    check("a home path", len(kinds("a.py", 'p = "/home/someone/x"\n')) == 1)
    check(
        "a home path in markdown too", len(kinds("a.md", "at /Users/someone/x\n")) == 1
    )
    check("a <placeholder> home path passes", kinds("a.md", "/Users/<name>/x\n") == [])
    check("prose in markdown is not checked", kinds("a.md", "see CLAUDE.md\n") == [])
    check(
        "an applied migration may keep its comment",
        kinds("api/prisma/migrations/1/migration.sql", "-- ARCH-001\n") == [],
    )
    check(
        "an allow-listed token passes",
        kinds(".gitignore", "CLAUDE.local.md\n") == [],
    )

    def refs(text, path="a.ts"):
        return [n for _, n in issue_refs(path, text)]

    check("a cited issue", refs("// matters (issue #567).\n") == [567])
    check("a trailing comment", refs("const a = 1; // from #602\n") == [602])
    check("a yaml comment", refs("# Tracked in #155.\n", "a.yml") == [155])
    check("a colour is not an issue", refs('// "#333" and #fff\n') == [])
    check("code outside a comment is not an issue", refs("const a = `#123`;\n") == [])
    check("an anchor is not an issue", refs("// see page#123\n") == [])
    check("a fixture's numbers are not read", refs("# #10\n", SELF) == [])
    check(
        "an allow-listed number",
        refs("// React #185\n", "frontend/src/components/feedback/ToastProvider.tsx")
        == [],
    )

    states = {1: "open", 2: "closed", 3: "unknown"}
    errors, warnings = closed_refs(
        {"a.ts": [(1, 1), (2, 2), (3, 3), (4, 2)]}, states.get
    )
    check(
        "only the closed issue is an error, at each site",
        len(errors) == 2 and "#2" in errors[0],
    )
    check("no warning when GitHub answered", warnings == [])
    errors, warnings = closed_refs({"a.ts": [(1, 1)]}, lambda n: None)
    check(
        "an unreachable GitHub warns and does not fail",
        not errors and len(warnings) == 1,
    )

    tracked = ["api/src/a.test.ts", "topo/tests/test_b.py", "infra/brain/tests/e2e.sh"]
    files = {
        "api/src/a.test.ts": "// Mutation that turns it red: x\n",
        "topo/tests/test_b.py": "# a note on nothing\n",
        "infra/brain/tests/e2e.sh": "# Mutations: y\n",
    }
    agents = {
        "AGENTS.md": "Guard: `api/src/a.test.ts`, `infra/brain/tests/e2e.sh`.",
        "topo/AGENTS.md": "Guard: `tests/test_b.py`.",
    }
    errors, resolved = guard_errors(agents, tracked, files.get)
    check(
        "a guard with no note is an error, resolved from its AGENTS.md's directory",
        len(errors) == 1 and "topo/tests/test_b.py" in errors[0] and len(resolved) == 3,
    )
    errors, _ = guard_errors(
        {"AGENTS.md": "Guard: `src/missing.test.ts`."}, tracked, files.get
    )
    check(
        "a missing guard is an error",
        len(errors) == 1 and "no tracked file" in errors[0],
    )
    errors, _ = guard_errors(
        {"AGENTS.md": "`tests/e2e.sh`"}, tracked + ["x/tests/e2e.sh"], files.get
    )
    check(
        "a path that ends two files is ambiguous",
        len(errors) == 1 and "ambiguous" in errors[0],
    )
    errors, resolved = guard_errors({"AGENTS.md": "no paths here"}, tracked, files.get)
    check("no named guards resolves nothing", not errors and not resolved)
    return fails


def main():
    tracked = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files"], capture_output=True, text=True, check=True
    ).stdout.split("\n")
    tracked = [p for p in tracked if p and (ROOT / p).is_file()]
    texts = {}

    def text_of(path):
        if path not in texts:
            try:
                texts[path] = (ROOT / path).read_text()
            except (UnicodeDecodeError, OSError):
                texts[path] = ""
        return texts[path]

    errors, refs, scanned = [], {}, 0
    for path in tracked:
        text = text_of(path)
        if not text:
            continue
        scanned += 1
        errors += [f"{path}:{n}: {msg}" for n, msg in scan_text(path, text)]
        found = issue_refs(path, text)
        if found:
            refs[path] = found
    agents = {p: text_of(p) for p in tracked if p.endswith("AGENTS.md")}
    guard_errs, resolved = guard_errors(agents, tracked, text_of)
    errors += guard_errs
    cited, closed_warnings = closed_refs(refs, make_lookup())
    errors += cited

    # A pattern that stops matching must not pass by checking nothing.
    if scanned < 500:
        errors.append(f"read only {scanned} tracked text files, expected 500 or more")
    if len(resolved) < 25:
        errors.append(
            f"resolved only {len(resolved)} named guards, expected 25 or more"
        )
    if sum(len(v) for v in refs.values()) < 10:
        errors.append(
            "found fewer than 10 issue citations: did ISSUE_REF stop matching?"
        )

    for warning in closed_warnings:
        print(f"::warning::{warning}")
    for error in errors:
        print(f"::error::{error}")
    if errors:
        return 1
    print(
        f"{scanned} files read, {len(resolved)} named guards resolved, "
        f"{sum(len(v) for v in refs.values())} issue citations checked."
    )
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if sys.argv[1:] == ["--self-test"] else main())
