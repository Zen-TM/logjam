# 0061. A new format assertion on a request path is run against the seed and the fixtures, with a test

- **Date:** 2026-08-21
- **Status:** Accepted
- **Supersedes:** —

## Context

`parsePushOp` (`api/src/routes/sync.ts`) tightened entity ids to strict UUIDv4;
`api/prisma/seed.ts` kept hand-minting version-nibble-0 ids, so no seeded place
could sync any edit from mobile (found 2026-08-21) — invisibly, because the
local mirror still updated, the UI looked correct, and only the outbox row held
the 400.

The seed is the one input nobody re-reads after writing it, and an
envelope-level 400 makes the field being edited irrelevant, so the fault
presents as a bug in whatever feature you just built.

## Decision

A new format assertion on a request path must be run against the seed and the
fixtures, with a test. Seeded ids now come from `seedId()` in
`api/prisma/seedIds.ts`; guard is `api/src/lib/seedIds.unit.test.ts`.

## Consequences

- **Positive:** Not recorded.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

Not recorded.
