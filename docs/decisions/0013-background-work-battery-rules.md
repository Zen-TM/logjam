# 0013. Nothing automatic runs or wakes the radio behind a dark screen

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

- **Update 2026-10-10: a map download the user started may run behind another
  app.** It is not automatic work: the user tapped Save and wants the maps
  before they lose signal, and on Android 14+ a download that stops when the
  screen locks never finishes (the process is frozen about 10 s after the app
  leaves the screen). So the region queue
  (`mobile/src/offline/regionDownloadQueue.ts`) keeps a `dataSync` foreground
  service up (`mobile/modules/logjam-download-service`) under a notification
  for as long as it has work in hand, and no longer. What still bounds it: a
  run is capped at `MAX_REGION_TILES`; the CPU lock lapses 3 minutes after the
  last progress update; a tile that runs out of retries behind another app
  parks the job until the user is back (`exhaustedTileOutcome`); and a job
  waiting for a connection restarts at most `MAX_BACKGROUND_RESUMES` times and
  waits at most `BACKGROUND_WAIT_MS`, after which the service goes down
  (`downloadNotice`, `mayResumeOnReconnect`). Guards:
  `regionDownloadGroups.test.ts`, `regionTilePlanning.test.ts`. This is an
  exception for work the user started and can see, not for retries, polls or
  sync. Everything else above stands.

## Consequences

- **Positive:** the headless task does constant work per fix.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

- Putting `canRunNow` in front of the backoff retry: do NOT — a
  metered-disallowed link would decline, nothing would re-arm it, and the sync
  status would promise a retry forever.
- For the 2026-10-10 download exception: keeping downloads foreground-only and
  holding the screen awake instead. Rejected because it fixes the screen lock
  and not switching apps, and a lit screen costs more than the service does.
- For the same exception: `react-native-notify-kit`, the community fork of
  Notifee, for the foreground service. Rejected for a local module of about
  150 lines: Notifee itself was archived in April 2026, and the fork would be
  a notifications library taken on for one service.
