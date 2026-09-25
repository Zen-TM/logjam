# 0060. Two lists that must agree are one declaration plus a test; an invariant needs an executable check

- **Date:** 2026-08-13
- **Status:** Accepted
- **Supersedes:** —

## Context

The 2026-08-13 mobile audit found that every hand-kept parallel list in
`mobile/` had drifted — schema vs migration, tables vs wipe, entities vs update
targets — one of them fatally: `ADDED_COLUMNS` vs `CREATE TABLE` killed delta
sync on every fresh install.

The same audit found documented rules whose code had diverged: `networkPolicy.ts`'s
header stated the rule its own code broke, and three more documented rules had
silently-diverging code.

## Decision

- **Two lists that must agree = one declaration + a test.** Derive the second
  list from the first, and add the test that fails when something joins one and
  not the other.
- **An invariant in an agent file needs an executable check, or it is a
  comment.** When you write a rule down, write the test too, and cite it in the
  entry.

## Consequences

- **Positive:** Not recorded.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

Not recorded.
