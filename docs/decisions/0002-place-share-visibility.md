# 0002. Place share visibility

- **Date:** 2026-07-04
- **Status:** Accepted
- **Supersedes:** —

## Context

Place sharing must establish strict visibility boundaries between place owners and
recipients:
- Sharing must distinguish place-level records from per-trip logs and personal media.
- An anti-oracle is needed: a 403 status code on a resource with no access confirms to an
  attacker that a place ID exists. Every place-id surface must route through access helpers;
  previously, two surfaces (media attach, bulk CSV merge target) did not until closed by
  `024f410` on 2026-07-04.
- Derived cardinality: withholding the trip `list` while shipping its `_count` is not a
  boundary. A test asserting the `list` is withheld will pass while its count leaks.
- Schema changes: a hand-kept `select` or allowlist drifts silently when a column is added to
  `model Place` in `schema.prisma`. The delta path once stripped by name only, so
  `importKey` and `importBatchId` leaked while `foreignFields` did not.

## Decision

- **Place share visibility (hybrid model):** `PlaceShare` recipients see the place record
  including place-level `notes` and place-level `media`. Per-trip `notes`, per-trip `media`,
  and the trip log list are owner-private. Single source of the access decision:
  `api/src/lib/placeAccess.ts` (`getPlaceRole` / `requirePlaceAccess` /
  `requirePlaceOwnerAccess` / `requirePlaceOwner`) — used by `api/src/routes/places.ts`
  (GET/PATCH/DELETE `/:id`, POST `/:id/copy`), `api/src/routes/sharing.ts` (POST `/:id/share`,
  GET `/:id/shares`), and `api/src/routes/tripLogs.ts` (GET `/`, GET `/:id`). Any new
  endpoint on shared places must derive its decision from these helpers, not inline
  owner/share checks. Guard: `api/src/__tests__/shareBoundary.test.ts` (the regression from the
  recipient side), `api/src/lib/placeAccess.unit.test.ts`.
- **404-not-403 anti-oracle:** no-access (`role === "none"`) on a place resource returns
  **404**, never 403, so the status can't confirm a place ID exists to someone who can't see it.
  Owner-only actions a *sharee* attempts return **403** (they legitimately see the place, just
  lack the permission). `requirePlaceAccess` (read) and `requirePlaceOwnerAccess` (owner-only
  mutations) bake this in, and every place-id surface routes through them — the two that did
  not (media attach, bulk CSV merge target) were closed by `024f410` on 2026-07-04.
- **Owner-private extends to derived cardinality, not just the rows:** A count/aggregate of
  owner-private data (trip tally, share fan-out) is itself owner-private — withholding the
  trip *list* while shipping its `_count` is not a boundary. A sharee-reachable payload must
  not carry `_count`/sum/exists over owner-private relations; scope it to the owned response
  (see `placeListInclude` in `api/src/routes/places.ts`,
  `api/src/routes/placesList.unit.test.ts`). A test that asserts the *list* is withheld will
  pass while its count leaks — assert the aggregate's absence too.
- **What a sharee may see is a DENYLIST plus a completeness guard, not a hand-kept `select`:**
  `OWNER_PRIVATE_PLACE_FIELDS` / `SHAREE_VISIBLE_PLACE_FIELDS` in `api/src/lib/placeVisibility.ts`
  name every column and why; `serializeSharedPlace` is the one filter and BOTH the REST and the
  delta path go through it — the delta path once stripped by name only, so `importKey` and
  `importBatchId` leaked while `foreignFields` did not. The guard
  (`placeVisibility.unit.test.ts`) parses `model Place` out of `schema.prisma`, so a new column
  fails the build until someone decides which side it is on. That is the point: an allowlist
  drifts silently when a column is added, a denylist drifts loudly.

## Consequences

- **Positive:** status codes cannot confirm existence of inaccessible places (404-not-403);
  derived cardinality (`_count`) cannot leak private trip or share stats; adding a column to
  `schema.prisma` fails the build loudly via `placeVisibility.unit.test.ts` until classified.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

- Inline owner/share checks instead of central helpers: rejected; all endpoints must derive
  decisions from `api/src/lib/placeAccess.ts`.
- Returning 403 on no-access (`role === "none"`): rejected to prevent ID enumeration.
- Hand-kept `select` or allowlists for sharee-visible fields: rejected because allowlists drift
  silently when new columns are added.
- Stripping by name only on the delta path: rejected after `importKey` and `importBatchId`
  leaked while `foreignFields` did not.
