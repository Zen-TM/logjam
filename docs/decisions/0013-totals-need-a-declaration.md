# 0013. Totals need a declaration

- **Date:** 2026-09-25
- **Status:** Accepted
- **Supersedes:** —

## Context

An aggregate screen can read a number's SHAPE — bounded on both sides with a small span is a rating, open-ended is a quantity (`shared/src/logbookStats.ts`) — but no property of a definition says whether a quantity ACCUMULATES.

`min`/`max` don't, and neither does which entity it hangs off: summing a place attribute over trips produced "1996 longest pitch" and "48 capacity", and the obvious correction (a trip's own answers are the ones it spends) produced "1530 rope length" one commit later. Both directions shipped and both were wrong.

## Decision

A TOTAL needs a declaration, not a heuristic. Until a definition carries an explicit "adds up each trip" flag, an average and a highest are the honest pair — they are never wrong for either kind.

The same rule in miniature: a tally over ONE distinct value is a constant, not a distribution.

## Consequences

- **Positive:** average and highest are never wrong for either kind of quantity (cumulative or state/capacity).
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

- Inferring accumulation from number shape (`min`/`max`): rejected; bounds do not indicate whether a quantity accumulates.
- Summing place attributes over trips: rejected; produced nonsense sums like "1996 longest pitch" and "48 capacity".
- Summing trip-level attributes over trips: rejected; produced nonsense sums like "1530 rope length".
- Treating a tally over one distinct value as a distribution: rejected; it is a constant, not a distribution.
