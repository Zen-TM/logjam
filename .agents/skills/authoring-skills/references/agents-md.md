# Editing an AGENTS.md

Read when adding, changing, moving or removing a rule in any `AGENTS.md`.

Agents follow what these files say, including rules that do not apply to the
task in hand, and every line loads on every task in its directory. A line that
does not prevent a mistake costs attention and adds work.

## What earns a line

All three:

1. **Evidence or blast radius.** A mistake happened without it (an ADR, a
   commit, an incident, an agent getting it wrong), or getting it wrong once
   would be severe: a privacy leak, prod damage, lost data.
2. **Not inferable.** An agent reading the code it is already touching would
   not work it out. What neighbouring files show, what a linter or type check
   enforces, and generic good practice fail this.
3. **Most sessions there need it.** Root holds what essentially every task
   can get wrong; a package file, what most sessions in that package must
   follow. A rule for one feature belongs in that feature's code: a comment,
   a guard's failure message, its ADR. The agent working on it finds it there.

A line is a rule a change must follow, not a fact about the product. "App
lock defaults off" describes a feature; "nothing automatic wakes the radio
behind a dark screen" constrains every change.

**Prefer the guard's failure message.** When a test fails loudly on the
mistake, put the instruction in its assertion message (what to do, and the
ADR) and leave no line: the agent reads it exactly when it matters. Run the
test green, then red under the mutation, before you drop the line.

## Which file

- **Root:** privacy, environments and prod safety, how we work, decisions, comments,
  testing policy.
- **Package or area** (`api/`, `frontend/`, `mobile/`, `shared/`, `topo/`,
  `infra/`): its rules and how its suites run. A rule stated at the root is not
  repeated.
- **Deeper than a package** needs a reason the package file cannot serve;
  raise it with the maintainer first.
- `CLAUDE.md` beside each `AGENTS.md` is exactly `@AGENTS.md`. Never write to it.

## Writing the line

- One imperative line, with the why in a clause: "Log through `logger`, never a
  raw error: Prisma renders place names into its messages." The full
  reasoning is an ADR (the `writing-adrs` skill), which the line links.
- Cite the guard test when there is one. A rule kept without one says so, and
  the gap is raised with the maintainer.
- Name the declaring file or symbol, not a copy of its values.
- File it under the section for what it governs. There is no catch-all
  section; a rule that fits no section probably fails the scope test.
- No capitals for emphasis: the why in the clause does that job.

## Changing or removing a rule

An `AGENTS.md` change is an ordinary PR. Nobody is asked to save rules in the
middle of other work.

- Show the evidence in the PR as a disposition table: every changed line, what
  happened to it (kept, moved to where, cut) and why.
- Cutting a line whose ADR exists loses nothing. A line whose reasoning has no
  ADR yet gets one before the line goes, if the reasoning is worth keeping.
- A rule whose reasoning is an accepted ADR changes through a new ADR that
  supersedes it.

## Testing a change

For more than a wording fix, measure it:

1. Pick 4–6 real tasks from `git log origin/main` that touch the rules you
   changed. Phrase each as its issue would have been, without the fix.
2. For each, check out the commit before the fix in a scratch worktree, put
   the old or the new agent files over it, and ask your agent CLI for a plan,
   invoked as the skill's `scripts/trigger-rate.sh` invokes it: read-only, project
   settings only (or your own memory and skills leak in), stdin closed (or in
   a loop it reads the remaining tasks as part of its prompt). Run each task
   3 times per version.
3. Compare the plans: rules broken, rules followed that did not apply to the
   task, and the tool calls and tokens each run used.

Report what you find, including no measurable change.
