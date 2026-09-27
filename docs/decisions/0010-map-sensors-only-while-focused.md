# 0010. Map sensors run only while the map is focused and foregrounded; the heading lives outside React state

- **Date:** 2026-08-17
- **Status:** Accepted
- **Supersedes:** —

## Context

Battery is a field constraint — a flat phone is a navigation failure. The
2026-08-17 pass: every rule below is a rule because the code broke it. Both
rules here are inside `MapScreen`'s effects, which nothing can reach without a
renderer in the test setup — the honest statement is that they are guarded by
the agent file and by review, not by CI.

## Decision

**A sensor runs only while the map tab is FOCUSED and the app is in the
FOREGROUND.** `MapScreen` mounts once per process and in practice never
unmounts, so nothing else ever stops one: a single locate-me tap used to leave a
3 s GPS watcher and the compass running for the life of the process, on other
tabs and with the phone asleep in a pack. Both watchers are owned by effects
keyed on `sensorsActive = mapFocused && appActive` — never by imperative
start/stop helpers, which is how the old code ended up with four "am I already
starting" flags that disagreed about whether the dot was on. The user's
*intention* (`dotWanted`) is separate state from the subscription handle;
anything asking "is the dot on" must read the intention. The RECORDER is exempt
and must stay exempt: it is a foreground service and running in the background
is its whole job. **No executable check.**

**The compass heading never goes back into a screen's state.** It lives in
`map/heading.ts` behind `publishHeading`/`useLiveHeading` and is read by exactly
two memoised components (`UserLocationMarker`, `LiveCompassStrip`). A component
that only needs part of the heading subscribes to part of it:
`useHasLiveHeading` (course-up draws the arrow at a constant, so the value is not
on screen) and `useQuantisedLiveHeading` (the tape moves 2.2 px per degree and
rebuilds ~30 native views per render, so a quarter-degree snapshot is half a
pixel and `useSyncExternalStore` bails out of most renders). The sensor itself
is gated on `userCoord`, not `dotWanted` — the arrow does not mount until there
is a fix, and indoors that can be never.

Course-up also draws the arrow VIEWPORT-aligned and pointing straight up
(`lockUpright`), because in that mode the camera's rotation is a native ramp and
`iconRotate` is a per-tick prop — two animators on one angle, which reads as the
arrow twitching against a gliding map. Course-up additionally offsets the camera
target FORWARD along the heading so the user sits three quarters down the screen
(`povCameraCenter`, applied in `setCameraStop`).

Anything else wanting the heading subscribes; it does not lift it back up.
**No executable check.**

## Consequences

- **Positive:** no sensor runs on other tabs or with the screen off.
- **Negative:** neither rule has an executable check.
- **Neutral:** Not recorded.

## Alternatives considered

- Imperative start/stop helpers: rejected; they produced four disagreeing
  "am I already starting" flags.
- The heading in `MapScreen`'s `useState`: rejected — every sample re-rendered
  the whole map. MLRN memoises none of its layer components and re-commits props
  per layer per render, and the Protomaps band alone is ~71 layers (more with
  saved regions).
- MapLibre's camera padding for the course-up offset: cannot be used, because
  Android only applies padding on a stop that carries a target, so it outlives
  the mode.
