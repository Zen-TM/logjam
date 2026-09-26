---
name: pr-review
description: Use when reviewing a pull request, a branch or uncommitted changes in this repo, whether your own work before opening a PR or someone else's. Covers orchestrating fresh-context reviewer subagents, checking the change against every AGENTS.md rule and ADR that governs it, hunting bugs, checking it does what its issue asks, validating each finding, and the output format.
---

# Reviewing a change

The goal: once this review is clean and CI is green, the change is ready to
merge, and the only question left for the maintainer is whether they want
what it does.

## Who does what

The session that runs this skill **orchestrates**: it gathers the inputs,
launches every pass and every validation as its own fresh subagent, and
assembles the output. It judges nothing itself, so it may be the session that
wrote the change. A subagent does its job directly and launches none of its
own. Write each
subagent's prompt from the inputs below, not from memory of writing the code.

In a tool without subagents, a session that wrote the change does not run the
review: start a new session and run this skill there, doing each pass and
validation in turn.

## 1. Gather

- **The change:** the branch since it left its base (usually `origin/main`;
  for a stacked branch, the branch below it), plus any uncommitted work, or
  the PR number. There need not be a PR yet.
- **The intent:** the PR title and body and the linked issue. If you wrote the
  change, add facts the repo cannot give: what is deliberately deferred, a
  decision the maintainer already made. Not what the code does or why it is
  correct; the passes read that from the diff.
- **The rule files:** the paths of root `AGENTS.md` and of the `AGENTS.md` in
  every directory holding a changed file, and in its parents.

You may check the branch out locally to read and grep. Do not run the PR's
code without asking.

## 2. Review in independent passes

Launch four subagents in parallel, however small the change: passes that
share a context are not independent. Give each the change, the intent and the
rule files; each reads what it needs fresh and returns findings, each with a
severity from Output and the reason (the rule, or the bug).

1. **Rules.** Every rule that applies to the changed files, from the rule
   files, from any committed skill in `.agents/skills/` (not a `*.local/` one) whose description covers the
   change, and from the ADRs that apply: scan the titles in
   `docs/decisions/README.md`, grep `docs/decisions/` for the changed paths
   and symbols, and read the Decision of each Accepted match (a Superseded
   ADR no longer binds). A rule in a package's `AGENTS.md` applies only under
   that package. Follow a rule out of the diff where it points: the callers
   and sibling entry points of what changed, and the other half of any list
   the change edits.
2. **Bugs in the diff.** From the diff alone: logic that is wrong whatever
   the input.
3. **Bugs in context.** Problems the changed code introduces that need the
   surrounding code to see: security holes, wrong logic, a caller the change
   breaks, lost data on an error path, a race.
4. **Intent.** The change does what its PR and issue say, all of it, and
   nothing unrelated. Tests are present where root `AGENTS.md` → Testing
   requires them. A change that root `AGENTS.md` → How we work says needs an
   issue, arriving without one, is a `question`.

## 3. Validate every finding

First merge findings that share a `path:line` and a cause; that is
bookkeeping, not judgement. Then launch one fresh subagent per finding,
however small, with the finding, the change and the intent. It re-reads the
code and confirms the issue is real; for a rule finding, it quotes the rule
and confirms it is scoped to that file. It may lower a finding's severity,
never raise it. Drop what does not survive; a finding that is plausible but
unconfirmed is a `question` at most. False positives cost the author more
than a miss costs the review.

## Not findings

- Whether a job in `.github/workflows/` passes; do not run it to check. A
  rule no job can see (a missing test, a new entry a checking script does not
  list) is still a finding.
- Problems that were there before the change.
- Style, naming and quality opinions no written rule backs, unless the change
  clearly breaks the pattern of the neighbouring files.
- Debt the change only passes near; "while you're here" refactors.
  Duplication the change introduces is a finding.
- A rule the code explicitly silences, with a comment saying why.
- The PR's title, body and commit messages, other than as a statement of
  intent or where a rule requires something in them.

## Output

A list in chat, nothing posted to GitHub unless asked. First line is the
verdict: `Ready` only when there are no findings, otherwise
`N blocking, M should-fix, K questions`. Then one entry
per finding, written for the author's agent to act on:

```
<blocking|should-fix|question> · path:line · what is wrong · why (the rule, or the bug) · the fix
```

- **blocking:** a bug; a privacy or security boundary; a written rule that
  has a guard test or an ADR; the change does not do what it claims.
- **should-fix:** breaks a written convention, or introduces duplication.
- **question:** the reviewer is unsure, or the answer is the human's to give.

If you wrote the change, act on the list: fix `blocking` and `should-fix`;
where a finding misreads a rule, answer with the rule's text instead of
complying; pass every `question` to the human.

With no findings, say what was checked: `Ready. Checked rules, bugs and
intent.`
