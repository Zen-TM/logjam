# 0003. A PlaceLink grants no visibility

- **Date:** 2026-09-25
- **Status:** Accepted
- **Supersedes:** —

## Context

Linking places (such as the old canyon↔waypoint join) previously required complex
visibility logic to determine whether a user was permitted to see both sides of a link.
A 219-line visibility-diffing module was necessary to calculate and reconcile visibility
across linked entities.

## Decision

- **A `PlaceLink` grants NO visibility.**
- It is symmetric, stored once under the canonical (low id, high id) pair, and
  owner-private — which is why `where: { ownerId }` IS the both-endpoints-are-visible
  filter, and why the 219-line visibility-diffing module the old canyon↔waypoint join
  needed could be deleted outright.
- A route still reaches a sharee through `Route.placeId`, which is a FOREIGN KEY and a
  different thing.
- Guard: `api/src/__tests__/placeLinks.test.ts` (a sharee's link list is empty, §7.3,
  and the create→link→flush→delta round trip, §7.18).

## Consequences

- **Positive:** `where: { ownerId }` is the complete filter for both endpoints being
  visible; the 219-line visibility-diffing module is deleted outright.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

- Visibility-diffing module for linked entities: deleted; the 219-line
  visibility-diffing module needed by the old canyon↔waypoint join was deleted outright
  by making `PlaceLink` owner-private.
