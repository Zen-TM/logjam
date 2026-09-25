# Editing an AGENTS.md

Read when adding, changing or moving a rule in any `AGENTS.md`.

## Which file

- **Root `AGENTS.md`:** rules for every change in the repo (privacy, prod
  safety, testing policy, comment policy, conventions that cross packages).
- **Package `AGENTS.md`** (`api/`, `frontend/`, `mobile/`, `shared/`, `topo/`):
  the mechanics of that package: how its tests run, its canonical examples,
  its hard rules. A rule stated at the root is not repeated here; the package
  file gives only the how.
- **Deeper than a package** needs a reason the package file cannot serve.
  Raise it with the maintainer before creating one.
- `CLAUDE.md` beside each `AGENTS.md` is exactly `@AGENTS.md`. Never write to it.

## A new rule

- **One line of rule, plus its guard.** A convention cites the test that fails
  when it is broken (`path/to/file.test.ts`, the `describe` name if the file
  is large). An invariant with no executable check is a comment; write the
  test in the same change.
- **No guard possible, or the entry needs a paragraph of why?** The reasoning
  is an ADR: copy `docs/decisions/0000-template.md`, add it to
  `docs/decisions/README.md`, and leave one line in `AGENTS.md` that links it.
- **Name the source, not its contents.** Point at the declaring file or symbol
  (`SYSTEM_PLACE_TYPES` in `shared/src/placeTypes.ts`), not a copy of its values.
- Apply the four pruning tests in [SKILL.md](SKILL.md) to the entry and to the
  section it lands in.

## Changing or removing a rule

- Entries are not silently deleted. If a rule looks stale, check its guard
  test and the code it names; if it is wrong, say so to the maintainer with the
  evidence before removing it.
- Moving narrative out to an ADR is not deleting: the rule line stays and links
  to the ADR.
- A rule whose reasoning is recorded in an accepted ADR changes by a new ADR
  that supersedes it, then the line is updated.
