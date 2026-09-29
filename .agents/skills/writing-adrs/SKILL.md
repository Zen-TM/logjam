---
name: writing-adrs
description: Use when asked to write a new architecture decision record (ADR) in docs/decisions/, including one that supersedes an accepted ADR, or a dated update to one, or when someone accepts an offer to write one. Covers the number, title, status, each section of 0000-template.md, the index row and superseding. Not for deciding whether a change needs an ADR (root AGENTS.md → Decisions), nor for finding, reading, summarising or proofreading existing ADRs.
---

# Writing an ADR

Start from `docs/decisions/0000-template.md`. `docs/decisions/README.md`
holds the index and the supersede rule. An ADR ships in the same PR as the
change it explains, so a reviewer reads the reasoning beside the diff.

## Number, title, status

- **Number:** the highest in `docs/decisions/` plus one. Never reuse or fill
  a number. If another branch takes the same number first, renumber yours when
  you rebase, and fix every link to it.
- **Title and filename:** the title states the decision, so the index reads
  as a list of rules: "A PlaceLink grants no visibility", not "Place links".
  The filename is `NNNN-` plus a short kebab-case form of the title.
- **Date:** the day the decision was made.
- **Status:** `Accepted`. Merging the PR accepts it, so `Draft` is not used.

## The sections

The agent who finds this ADR later is changing code and greps `docs/decisions/`
for the paths and symbols involved. Name them in the ADR, or it is never found.

- **Context:** what forced the choice: the constraint or the failure, with
  the paths, symbols, dates and incident that pin it down. Leave out how the
  bug was found and anything that belongs under Alternatives. Keep history
  only when it stops someone repeating it.
- **Decision:** a rule that a later change could break and a reviewer could
  check. A description of the feature or an account of the fix is not a
  decision. Name the guard test that enforces it. If there is none, say so.
- **Consequences:** always name the cost. A choice between real alternatives
  gives something up, usually what the rejected option had going for it. Also
  name the work it leaves for later: 0009's key must be backed up, and
  rotating it needs a new build.
- **Alternatives considered:** each option that was really rejected and why.
  The first to list is the obvious one the next contributor would reach for.
  If you know an option was built and then removed, say so, so it is not
  built again.

Never write "Not recorded" in a new ADR, and never invent an alternative or a
consequence to fill a section. If you cannot name a real rejected option, the
change probably fails Decisions criterion 1. Stop and tell whoever asked
rather than write the ADR. The template's "Not recorded" is only for
backfilling a decision made long ago, whose date comes from `git log`.

## Index and links

- Add a row to the table in `docs/decisions/README.md`: number, title as in
  the H1, date, status.
- If most sessions in a directory must follow the rule, it also gets one line
  in that directory's `AGENTS.md`, linking the ADR. If a guard test fails
  loudly on the mistake, put the pointer in its assertion message instead.
  Before adding either, read
  `.agents/skills/authoring-skills/references/agents-md.md`.

## Superseding

An accepted ADR is never edited to say something else. When a decision
changes:

1. Write a new ADR that states the whole current decision, so a reader never
   has to merge two files. Set its `Supersedes` to the old one, and say in
   Context what changed.
2. In the old ADR, change only the status line, to `Superseded by [NNNN](…)`.
   Update its index row to match.
3. Search for every citation of the old number or file
   (`git grep -n -e 'decisions/NNNN' -e '\[NNNN\]'`), in `AGENTS.md` lines,
   comments and guard-test messages, and point each one at the new ADR.

## Updating an accepted ADR

When the decision still stands and only an exception is added or a fact has
gone stale, do not supersede. Add a bullet under Decision,
`**Update YYYY-MM-DD: <what changes>.**`, that ends "Everything else above
stands", or correct the stale line in place and mark it "(updated
YYYY-MM-DD)". For an exception, list the option you rejected under
Alternatives. Leave the title, status and index row alone. If the update would
change what the decision chooses, or a reader would need both texts to know
the rule, supersede instead.
