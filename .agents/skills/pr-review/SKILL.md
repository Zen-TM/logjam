---
name: pr-review
description: Use when reviewing a pull request, a branch or uncommitted changes in this repo, whether your own work before opening a PR or someone else's. Covers handing the review to fresh-context reviewers, checking the change against every AGENTS.md rule and ADR that governs it, hunting bugs, checking it does what its issue asks, validating each finding, and the output format.
---

# Reviewing a change

The goal: once this review is clean and CI is green, the change is ready to
merge, and the only question left for the maintainer is whether they want
what it does.

## If you wrote the change, do not review it

The session that wrote the code shares its assumptions. Hand the review to a
fresh-context reviewer: a subagent, or a new session where your tool has none.
Give it:

- **What to review:** the branch since it left `origin/main`, plus any
  uncommitted work, or the PR number. There need not be a PR yet.
- **Optionally, facts it cannot get from the repo:** what is deliberately
  deferred, a decision the maintainer already made. Not what the code does or
  why it is correct; the reviewer reads that from the diff.

When the list comes back: fix `blocking` and `should-fix`; where the reviewer
misread a rule, answer with the rule's text instead of complying; pass every
`question` to the human.

## 1. Gather

- **The change:** the diff, and the commits in it.
- **The intent:** the PR title and body, the linked issue, the author's
  message.
- **The rules, read fresh every run:** root `AGENTS.md`; the `AGENTS.md` of
  every directory holding a changed file, and of its parents; every ADR in
  `docs/decisions/` those files link from a rule the change touches.

You may check the branch out locally to read and grep. Do not run the PR's
code without asking.

## 2. Review in independent passes

Run the passes as parallel subagents where your tool can, otherwise one after
another. Give each the change, the intent and the list of rule files; each
returns findings with the reason it flagged them (the rule, or the bug).

1. **Rules.** Every rule and ADR decision that applies to the changed files.
   A rule in a package's `AGENTS.md` applies only under that package. Follow a
   rule out of the diff where it points: the callers and sibling entry points
   of what changed, and the other half of any list the change edits.
2. **Bugs in the diff.** From the diff alone: code that will not compile or
   parse, and logic that is wrong whatever the input.
3. **Bugs in context.** Problems the changed code introduces that need the
   surrounding code to see: security holes, wrong logic, a caller the change
   breaks, lost data on an error path, a race.
4. **Intent.** The change does what its PR and issue say, all of it, and
   nothing unrelated. Tests are present where root `AGENTS.md` → Testing
   requires them. A change that root `AGENTS.md` → How we work says needs an
   issue, arriving without one, is a `question`.

## 3. Validate every finding

Check each finding in a fresh subagent where your tool can, otherwise
yourself: re-read the code and confirm the issue is real. For a rule finding,
quote the rule and confirm it is scoped to that file. Drop what does not
survive; a finding that is plausible but unconfirmed is a `question` at most.
False positives cost the author more than a miss costs the review.

## Not findings

- Anything a CI job in `.github/workflows/` gates: lint, types, tests
  passing, contrast, migration validity, secrets. Do not run them to check.
- Problems that were there before the change.
- Style, naming and quality opinions no written rule backs, unless the change
  clearly breaks the pattern of the neighbouring files.
- Debt the change only passes near; "while you're here" refactors.
  Duplication the change introduces is a finding.
- A rule the code explicitly silences, with a comment saying why.
- The PR's title, body and commit messages, other than as a statement of
  intent.

## Output

A list in chat, nothing posted to GitHub unless asked. First line is the
verdict: `Ready` or `N blocking, M should-fix, K questions`. Then one entry
per finding, written for the author's agent to act on:

```
<blocking|should-fix|question> · path:line · what is wrong · why (the rule, or the bug) · the fix
```

- **blocking:** a bug; a privacy or security boundary; a written rule that
  has a guard test or an ADR; the change does not do what it claims.
- **should-fix:** breaks a written convention, or introduces duplication.
- **question:** the reviewer is unsure, or the answer is the human's to give.

With no findings, say what was checked: `Ready. Checked rules, bugs and
intent.`
