---
name: authoring-skills
description: Use when creating, editing, splitting or reviewing a skill under .agents/skills/ in this repo, or adding or changing a rule in any AGENTS.md. Covers the trigger description, size budget and reference files, the four pruning tests, committed versus personal `.local` skills, and whether guidance belongs in AGENTS.md, a skill or an ADR. Use instead of generic skill-writing advice here.
---

# Authoring skills and AGENTS.md

Everything an agent reads from this repo is either an `AGENTS.md` (loaded by
path, every time) or a skill (loaded when its description matches the task).
Both cost context on every load, so every line must change what an agent does.

## First: does it belong in a skill?

| The guidance is… | It goes in |
|---|---|
| something an agent gets wrong on essentially any task, or in one package | `AGENTS.md`: root, or that package's file |
| needed only for one recurring task (allowlist a host, write an ADR) | a skill |
| the reasoning behind a rule: context, alternatives, what broke | an ADR in `docs/decisions/`; the rule's one line links to it |
| about one contributor's machine, aliases, accounts or access | a personal `.local` skill, never a committed file |

A nested `AGENTS.md` loads by path, which is more reliable than a description
match. If you keep wanting a skill to "always" apply, it is an `AGENTS.md` rule.
Editing an `AGENTS.md`? Read [references/agents-md.md](references/agents-md.md) first.

## Before writing

1. **Capture intent.** Write down the task the skill serves, requests that
   should load it and near-misses that should not, and what a good run
   produces. These become the cases in Test before committing.
2. **Interview and research.** Ask whoever does the task what goes wrong and
   what they would tell a newcomer. Read the code, ADRs, commits and past
   transcripts it touches. Each line you write traces to a mistake found
   here; a line that traces to none is a guess.

## Layout

```
.agents/skills/<name>/SKILL.md                committed, one per task
.agents/skills/<name>/references/<topic>.md   read on demand
.agents/skills/<name>/scripts/                run, not read
.agents/skills/<name>.local/SKILL.md          personal, gitignored
```

`.claude/skills` is a symlink to `.agents/skills`: create and edit under
`.agents/skills/` only. Claude Code, Codex and Antigravity all read this tree.

## Frontmatter

```yaml
---
name: <same as the directory>
description: Use when <the task, in the words someone asking for it would use>. Covers <what is inside>.
---
```

The description is the trigger. It is the only part an agent sees before
deciding to load the skill, so:

- **Name the task, not the topic.** "Use when adding an external host the
  frontend fetches from" loads at the right moment; "Frontend security" loads
  for any question near the word security.
- **Say when.** Lead with "Use when…", then list the files, commands or error
  messages that signal the task.
- **Keep it narrow.** One task per skill. A skill that bundles topology,
  procedures and one-liners loads all of it for a question about any one.
- **Under ~80 words.** Every description sits in every session's context.

## Size budget and progressive disclosure

`SKILL.md` loads whole, every time the skill triggers. What goes in it:

- **In:** the steps and rules needed on *every* run of the task, and the
  conditions that send the reader to a reference file.
- **Out, to `references/<topic>.md`:** detail needed only on *some* runs
  (below). Link it with the condition for reading it ("Editing an
  `AGENTS.md`? Read …"), never a bare "see also".
- **Out entirely:** whatever fails the pruning tests below.

Most skills in this repo land well under ~120 lines. That number is a guide,
not a limit: going over it is a prompt to check that every line is needed on
every run, not a failure. A reference file over ~300 lines gets a contents
list at the top.

### What earns a reference file

All three must hold:

1. **An agent gets it wrong without it.** Best evidence is a mistake that has
   happened more than once. A capable agent missing one local fact is the
   usual case; a guess that it might struggle is not.
2. **Only some runs need it.** Otherwise it belongs in `SKILL.md`.
3. **Nothing else holds it.** If a Makefile target, test, schema or ADR does,
   point there.

Shapes that pass: **traps** (symptom → cause → fix, for recurring mistakes
that come from missing local knowledge, with the right command only when the
command itself was the trap); **variants** (one file per platform or case, so
only the relevant one is read); **a sub-task's checklist** for a case the main
task hits only sometimes; **worked examples** where the task is judgement and
the rules alone leave room for error (a before/after rewrite).

Shapes that fail: "just in case" material, anything an agent works out
unaided (most commands), copies of docs or config, reasoning and history
(an ADR), tutorials.

An exact multi-step procedure goes in `scripts/` instead: a script runs
without being read into context.

## Point at the source; do not restate it

A skill says which command, file or test to use and why. It does not copy what
those contain.

- **Commands:** name the Makefile target or package script (`make shared`,
  `npm run test:unit`), not the shell it runs.
- **Values that change:** ids, ARNs, bucket names, port lists, line counts.
  Give the lookup (`terraform output`, `git grep`, the file that declares it).
- **Rules with a guard:** name the guard test. The test is the rule; the skill
  says when it matters.
- **Machine artefacts** (CI workflows, issue forms, PR template, `schema.prisma`)
  are the source of truth. Link them; a paraphrase drifts silently.

## The four pruning tests

Apply to every line, when writing and when editing:

1. **Does it change agent behaviour?** If not, cut it.
2. **Can it be shorter?** Shorten it.
3. **Is it drift-prone?** Replace the fact with the command that looks it up.
4. **Is it a generic tutorial?** Cut it. Assume fluency in TypeScript, React,
   Python, SQL, git.

History ("we used to…", "found on…") fails test 1 unless it stops a repeat
mistake; if it does, it is an ADR's Context, not skill text.

Say why in a clause rather than in capitals. An agent that knows why a step
matters applies it to cases the text did not foresee; one told MUST follows
it where it does not fit.

## Committed skills are setup-neutral

A committed skill is true for any contributor on any machine and OS. It never
names a personal host, mirror, sync tool, shell alias, AWS profile, home-dir
path or account. Write "the dev database", not the box it runs on.

Anything that is true only for you goes in `.agents/skills/<name>.local/`,
which `/.agents/skills/*.local/` in `.gitignore` keeps out of the repo. The
maintainer's own setup follows the same rule.

## Test before committing

1. **Trigger rate.** Write about five requests that should load the skill,
   phrased the way someone would ask: with file names, an error message,
   casual wording, some that never name the topic. Add about five near-misses
   that share its words but need something else. From the repo root:

   ```
   .agents/skills/authoring-skills/scripts/trigger-rate.sh [--harness claude|codex|agy|grok] <name> cases.tsv
   ```

   It runs each request 3 times in a fresh, read-only session of the agent
   CLI you use (Claude Code by default; one is enough, and the PR names it).
   Codex, Antigravity and Grok have no skill-load event, so there a run
   counts when the agent opens the `SKILL.md`. Every request that should
   trigger does so at least 2 times in 3, and every near-miss 0 times. A
   missed request means the description names the topic instead of the task;
   a firing near-miss means it is too broad. Rewrite, rerun, and paste the
   table in the PR. One-step requests an agent handles unaided rarely load
   any skill, so test with substantive ones.
2. **With and without.** Give 2–3 realistic tasks to the same CLI, read-only,
   3 runs each, invoked as `trigger-rate.sh` invokes it: once with the skill
   ("Use the <name> skill. …"), once in a worktree of the base branch, which
   lacks the skill or holds its previous version. Read the transcripts, not
   just the answers. The skill earns its place when the runs with it avoid a
   mistake or wasted steps that the runs without it make; if they agree, cut
   what made no difference. If every run with it writes the same helper,
   bundle that helper in `scripts/`.
3. **Setup check.** `git grep --untracked -il -e "$HOME" -e '/Users/[a-z]' .agents/skills` is empty,
   and reread for machine, tool or account names.
4. **Everything named exists.** Every command, file, test and ADR the skill
   names is committed (in this change or before) or created by a committed
   command or setup step, and does what the skill says. Never cite one that is
   only planned, or that exists only on your machine. Run the cheap commands.
5. **Self-check.** Every line of `SKILL.md` is needed on every run; the rest is
   in `references/` or gone.
