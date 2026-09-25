# 0043. Nothing automatic runs or wakes the radio behind a dark screen

- **Date:** 2026-08-17
- **Status:** Accepted
- **Supersedes:** —

## Context

The 2026-08-17 battery pass (a flat phone is a navigation failure) found work
running in the background that only mattered when someone was looking.

## Decision

**A backgrounded recorder appends points and nothing else.** Track stats are
display-only, so they are recomputed while the app is in front of someone and on
return to the foreground (`refreshTrackStats` / `refreshActiveTrackStats`),
never in the headless task — it was a full read of the series plus O(points) of
arithmetic per fix, all night, getting worse the longer the trip ran.
`appendTrackPoints` therefore carries `pointCount` in its own transaction.
Guarded by `trackRecorder.test.ts` ("a backgrounded recorder only writes
points").

**The `/users/me` cache is a privacy boundary, not just a battery one**
(`api/apiFetch.ts`): 60 s, invalidated by any non-GET to that path and by
`wipeAllLocalData`, which is what both sign-out (`App.tsx`) and a different user
signing in (`useAuth.ts`) go through. `GET /users/me` also PROVISIONS the row on
first sign-in, so a hit on the wrong side of an account change would skip
creating the new account. Pinned by `api/apiFetch.test.ts`.

**Nothing automatic may wake the radio from the background.** The sync backoff
ladder only arms in the foreground (`syncEngine.ts`; `syncEngine.test.ts` pins
it) — the foreground edge and the offline→online edge already recover it, and a
ladder behind a dark screen is a wakeup every few minutes for a whole trip.

## Consequences

- **Positive:** the headless task does constant work per fix.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

- Putting `canRunNow` in front of the backoff retry: do NOT — a
  metered-disallowed link would decline, nothing would re-arm it, and the sync
  status would promise a retry forever.
