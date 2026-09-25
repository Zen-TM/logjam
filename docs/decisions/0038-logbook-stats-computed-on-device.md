# 0038. Logbook stats are computed on device, from the mirror

- **Date:** 2026-09-13
- **Status:** Accepted
- **Supersedes:** —

## Context

`logs/StatsScreen.tsx`, reached from the Logs hero, summarises the user's
logbook: everything, or one activity.

## Decision

ONE component, two scopes: `activity` null is everything, an activity tag (or
`UNTAGGED_ACTIVITY`) is the drill-down, and they share the hero, the range rail
and the spark so a second screen cannot drift from the first. Every figure is
computed on device from the mirror through `computeLogbookStats` (shared/), so
it needs no endpoint and works offline, as a guest, in a canyon — and cannot
disagree with what the Logjam Web rework will show.

**`MirrorQueryState.loading` is FALSE once the process's first sync has
happened, so it is not "has this screen got its data".** Each `useMirrorQuery`
starts with `data: null` and fills in asynchronously, but `loading` reports the
first-sync-ever state — so a screen PUSHED later renders with no rows while
`loading` is already false. Here that flashed "Nothing logged in here yet" over
a logbook of 123 trips, every time the drill-down opened. Gate an empty state on
`data == null`, never on `loading`, in anything reached after the first sync.

**What syncs is not what the user made: filter `syncRole === "shared"` out of
any aggregate.** A place shared with this account is someone else's ground, and
counting it inflates "places visited" and the completion meter with rows the
user never chose to keep.

**Attribute stats are rendered by the SHAPE of a definition, and grouped by the
TYPE that owns them.** A canyoning trip that also stopped at a campsite carries
the campsite's fields — correct, unavoidable, and confusing in one flat list, so
the place-type heading labels it instead. A definition scoped to two types is
summarised once per type over that type's own samples: the quality of the
canyons someone does and of the campsites they stay at are two distributions.
The total-vs-average rule this screen learned the hard way is in root
`CLAUDE.md` (now `AGENTS.md`, "A TOTAL needs a declaration").

**Trip attributes follow the same logic by TRIP TYPE.** The All screen
summarises only the attributes every trip is asked (`appliesToAllTypes`); one
scoped to an activity appears on that activity's drill-down, over its own trips,
through the same `tripFieldDefs` rule the trip form uses — so a value on a trip
since retagged is still counted somewhere. The All screen says how many it left
to the drill-downs (`tripFieldsUnderActivities`), because an attribute that
silently stopped appearing there reads as data loss.

## Consequences

- **Positive:** no endpoint; works offline and for a guest.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

Not recorded.
