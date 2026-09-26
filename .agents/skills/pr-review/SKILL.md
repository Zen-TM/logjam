---
name: pr-review
description: Use when reviewing a pull request, a branch or uncommitted changes in this repo, whether your own work before opening a PR or someone else's. Covers handing the review to a fresh-context reviewer, which AGENTS.md rules and ADRs to check (privacy boundaries, 404-not-403, expand/contract migrations, lists that must agree, setup-neutrality, installed Logjam GPS builds), what not to flag, and the findings format.
---

# Reviewing a change

This skill checks a change against Logjam's written rules. It is not a
generic bug hunt: in Claude Code, run `/code-review` alongside it for that.

## If you wrote the change, do not review it

The session that wrote the code shares its assumptions. Hand the review to
one fresh-context reviewer: a subagent, or a new session where your tool has
none. Give it:

- **What to review:** the branch since it left `origin/main`, plus any
  uncommitted work. There need not be a PR yet.
- **The PR or issue number**, if there is one.
- **Optionally, facts it cannot get from the repo:** what is deliberately
  deferred, a decision the maintainer already made. Not what the code does or
  why it is correct; the reviewer reads that from the diff.

When the list comes back: fix `blocking` and `should-fix`; where the reviewer
misread a rule, answer with the rule's text instead of complying; pass every
`question` to the human.

## Before reading the diff

Read the rules fresh on every run; they change, and this skill does not copy
them.

- Root `AGENTS.md`, and the `AGENTS.md` of every package the diff touches.
- Any ADR those files link from a rule the diff touches
  (`docs/decisions/README.md` is the index).
- The linked issue, if any.

Reading beyond the diff is expected, but bounded: the callers and sibling
entry points of what changed, and the other half of any list or declaration
it edits. You may check the branch out locally to grep; do not run the PR's
code without asking.

## What to look for

Each point names where its rule lives. The rule's text there wins over
anything here.

- **Privacy and security boundaries.** Root `AGENTS.md` → Context (privacy
  rules) and Testing (mandatory boundary tests); `api/AGENTS.md` → Hard rules.
  Ask: can a new endpoint, delta row, log line or error message expose place
  data, a user field label, an email, or owner-private trip data to someone
  who should not see it? Does a boundary change come with its test?
- **404, not 403.** Root `AGENTS.md` → Places, sharing, sync. No access to a
  resource must look like it does not exist; a sharee attempting an
  owner-only action is the one 403.
- **Expand/contract migrations.** `api/AGENTS.md` → Migrations, ADR 0020. The
  old image runs against the new schema mid-deploy: a migration that drops,
  renames or narrows something that image still reads is blocking, even when
  CI's migration jobs pass.
- **Installed Logjam GPS builds.** ADR 0014. A phone in the field runs an
  older build: a changed endpoint or sync shape it uses must still serve it.
  Until a version-bump policy ADR joins the index (0014 lists it as a gap), a
  break is `blocking` unless the maintainer has signed it off.
- **Lists that must agree.** Root `AGENTS.md` → Testing, ADR 0060. A diff that
  adds to one of a pair (a type, an enum, a layer list, a store registry)
  without the other, or adds a new pair without one declaration and a test.
- **Setup-neutrality.** Root `AGENTS.md` → How we work. Nothing committed names
  a personal machine, mirror, alias, account or home-dir path.
- **Duplication the diff introduces.** A new helper, type or pattern that
  re-implements one already in the repo.
- **Package conventions.** Anything in a touched package's `AGENTS.md`, and a
  clear break from the pattern in the neighbouring files.
- **The linked issue.** The diff does what the issue asks and does not
  contradict it. A feature, schema change or convention shift with no issue is
  a `question` (root `AGENTS.md` → How we work: issue-first).

## What not to flag

- Anything a CI job in `.github/workflows/` already gates: lint, types, tests
  passing, contrast, migration validity, secrets.
- Style, naming and missing tests, unless a written rule or the neighbouring
  files say otherwise. Tests are required where root `AGENTS.md` → Testing
  requires them.
- Debt the diff only passes near, and "while you're here" refactors.
- The PR's title, body and commit messages. Review the code.

## Verify every finding

Before reporting, re-read the code at the line, and quote the rule it breaks:
the `AGENTS.md` line or the ADR. A finding with no written rule behind it is
a `question` at most, or it is dropped.

## Output

A list in chat, nothing posted to GitHub unless asked. First line is the
verdict: `Ready` or `N blocking, M should-fix, K questions`. Then one entry
per finding, written for the author's agent to act on:

```
<blocking|should-fix|question> · path:line · what is wrong · rule (AGENTS.md section or ADR) · the fix
```

- **blocking:** breaks a written rule that has a guard test or an ADR, or a
  privacy boundary.
- **should-fix:** breaks a written convention, or introduces duplication.
- **question:** the reviewer is unsure, or the answer is the human's to give.
