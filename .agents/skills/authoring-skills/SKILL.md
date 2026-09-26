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
| needed on every change of a kind (testing, errors, doc voice) | `AGENTS.md`: root for the rule, the package file for its mechanics |
| needed only for one recurring task (allowlist a host, write an ADR) | a skill |
| the reasoning behind a rule: context, alternatives, what broke | an ADR in `docs/decisions/`; the rule's one line links to it |
| about one contributor's machine, aliases, accounts or access | a personal `.local` skill, never a committed file |

A nested `AGENTS.md` loads by path, which is more reliable than a description
match. If you keep wanting a skill to "always" apply, it is an `AGENTS.md` rule.
Editing an `AGENTS.md`? Read [references/agents-md.md](references/agents-md.md) first.

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
- **Out, to `references/<topic>.md`:** anything needed only on *some* runs: a
  variant (one provider, one platform), a long checklist for a rare case,
  background a step depends on. Link it with the condition for reading it
  ("Editing an `AGENTS.md`? Read …"), never a bare "see also".
- **Out entirely:** whatever fails the pruning tests below.

Most skills in this repo land well under ~120 lines. That number is a guide,
not a limit: going over it is a prompt to check that every line is needed on
every run, not a failure. A reference file over ~300 lines gets a contents
list at the top.

### Tested commands

A task's commands belong in the Makefile or a package script when they are run
routinely; the skill names the target. A command that is diagnostic or
situational (inspect a state, recover from a failure) and has no such home can
live in `references/commands.md`, and each entry says:

- what it answers or fixes, in the words of the symptom;
- the command, with placeholders for anything that varies (`<task-id>`);
- that it has been run, and what it returned when it worked.

A command you have not run does not go in. Once one is run often, promote it
to a Makefile target and point at that instead.

A multi-step procedure that must be exact goes in `scripts/`. A script runs
without being read into context, which a pasted command list cannot do.

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

## Committed skills are setup-neutral

A committed skill is true for any contributor on any machine and OS. It never
names a personal host, mirror, sync tool, shell alias, AWS profile, home-dir
path or account. Write "the dev database", not the box it runs on.

Anything that is true only for you goes in `.agents/skills/<name>.local/`,
which `/.agents/skills/*.local/` in `.gitignore` keeps out of the repo. The
maintainer's own setup follows the same rule.

## Test before committing

1. **Trigger test.** From the repo root, in a fresh session:
   - `claude -p "<a realistic request for the task>"` must name or use the skill.
   - `claude -p "<a nearby but unrelated request>"` must not.

   Paste both requests and outcomes in the PR. A miss means the description
   names the topic instead of the task; rewrite it and rerun.
2. **Setup check.** `git grep -il -e "$HOME" -e '/Users/[a-z]' .agents/skills` is empty,
   and reread for machine, tool or account names.
3. **Commands run.** Every command the skill names exists and does what the
   skill says. Run the cheap ones.
4. **Self-check.** Every line of `SKILL.md` is needed on every run; the rest is
   in `references/` or gone.
