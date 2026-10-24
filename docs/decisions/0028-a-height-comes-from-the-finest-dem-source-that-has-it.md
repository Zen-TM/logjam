# 0028. A height comes from the finest DEM source that has it, and a seam is measured in one source

- **Date:** 2026-10-10
- **Status:** Accepted
- **Supersedes:** —

## Context

Logjam read every terrain height from one worldwide DEM, named in several
places: a URL template, a zoom, a tile size and a credit as separate constants
in `shared/src/demTiles.ts`, the id again in `shared/src/mapRegionEstimate.ts`,
and one reader each in `api/src/services/elevation.ts` and
`mobile/src/offline/demLookup.ts`.

More DEMs are coming: a statewide NSW 5 m DEM (#341) and a finer DEM for the
footprint of a LiDAR topo job. Each covers part of the map, so a line can start
on one and finish on another. The surfaces do not agree where they meet. The
worldwide tiles include tree canopy and read a median 8 to 14 m above the
bare-earth NSW DEM on forested ranges, and gain and loss are sums of the steps
between consecutive samples (`elevationGainLoss` in `shared/src/elevation.ts`),
so the offset at a join would be counted as climb that is not there.

Proposal: #359.

## Decision

- **One declaration.** `DEM_SOURCES` in `shared/src/demSources.ts` lists every
  source, finest first; the order is the precedence. No other file names a
  source's URL, zoom or credit.
- **One sampler.** `sampleDem` in the same file decides which source answers.
  The API and Logjam GPS supply only tile I/O (a `DemTileReader`), following
  [0020](0020-share-the-decision-not-the-drawing.md).
- **Finest per position.** Each position gets the first source in the list
  that has a height there. A position outside a source's `coverage`, on a
  missing tile or on a no-data pixel falls through to the next.
- **A seam is measured in one source.** Where two consecutive known samples
  come from different sources, the step between them is read from the finest
  source that has a height at both, found by walking the list from the coarser
  of the two. If no source has both, the step is not counted.
- **The chart shows heights as read.** Gain and loss are summed from
  `DemSamples.levelled`, which has the offset at each seam taken out.
- **A result names its sources.** `sampleDem` returns a source id per sample,
  a profile carries `demSourceIds`, and a saved `dem-region` file is filed
  under its source's id and read back only for that source.
- **Update 2026-10-12: a track's climb is stored with one source id, and
  replaced only by a finer one.** A finished track's climb and descent are
  the sums above, written once to the track and to its file's metadata
  (`elevationSource` in `shared/src/mediaMetadata.ts`) so every screen shows
  the same figure without reading terrain. The figure is still finest per
  position; the id is only a label, and `climbFromProfile` in
  `shared/src/elevation.ts` sets it to the coarsest source any sample came
  from, so a track partly on a coarse source is offered again when a finer
  one reaches it. Absent means GPS heights. A recorded track's own GPS heights
  are the source under every DEM: `fillDemFromGps` in
  `shared/src/trackStats.ts` fills the positions no DEM answers, sums each
  filled stretch and its joins from every GPS fix, in GPS throughout, and
  holds GPS still until it has moved `ELEVATION_HYSTERESIS_M` so its wander
  is not summed at the DEM's threshold. Such a climb is labelled `gps`. The
  ground between two segments of a track (a pause gap) was not walked, so
  the step across it is counted by neither: a sample position carries its
  segment, `sampleDem` leaves that step out of `levelled` and reads no seam
  for it, and each segment is filled from its own fixes and DEM samples. The
  chart still shows the jump. `upgradeTrackClimbs` in
  `mobile/src/tracks/trackClimb.ts` asks again on the first sync cycle after
  the finish, and after that only when the ids or `coverage` of the
  sources it reads change: `DEM_SOURCES` and the account's kept sharpened
  areas (updated 2026-10-24); nothing polls. It reads saved terrain and
  `POST /elevation/profile`, never a public tile host, because nobody opened
  the track. Guards: `shared/src/elevation.test.ts`,
  `shared/src/gpsFill.test.ts`, `mobile/src/tracks/trackClimb.test.ts`. Cost: a stored figure can be older
  than the best terrain, a phone built with a new source before the API
  serves it marks its tracks as asked, and the key sees only the declaration: an
  archive rebuilt inside an unchanged `coverage` re-asks nothing (updated
  2026-10-24: a sharpened area declares its `coverage`, so the key sees one
  that is new or grown). Everything else above stands.
- **Update 2026-10-12: Logjam Web replaces a stored climb too, and each
  figure says its source.** A finished recording's Ascent and Descent are the
  stored figures on every screen of both clients; no screen shows its own
  reading beside them. A track's page on Logjam Web
  (`frontend/src/components/sidebar/panels/TrackProfiles.tsx`) reads the
  terrain for its chart anyway, so when that reading is complete and
  `isFinerClimbSource` says its source beats the stored one, the page sends
  it (`reclimbMedia` in `frontend/src/placeUtils.ts`), for the viewer's own
  recording only: never an import, never a shared track. It builds the
  request as `upgradeTrackClimbs` does (`toElevationLine` in
  `shared/src/trackLine.ts`, `ELEVATION_TRACK_MAX_SAMPLES`), so both clients
  store the same figure for one source. The stored climb and the chart under
  it can still come from different sources (a phone offline on coarse saved
  terrain), so the line under the two figures names the stored source
  (`storedClimbCaption` in `shared/src/profileSeries.ts`) and the chart's
  line names its own in the same words. Guards:
  `frontend/src/components/sidebar/panels/TrackProfiles.test.tsx` ("stores a
  climb read from a finer source"), `shared/src/profileSeries.test.ts`
  ("names every source a climb can be stored from"). Cost: opening a page
  can write; `PATCH /media/:id` accepts any valid climb from the owner, so
  "finer only" is held by each client and not by the API; and the phone that
  recorded the track shows its own row, which learns of the web's write only
  when its own pass reaches the same answer. A climb stored before the
  arithmetic changed is still replaced by nothing. Everything else above
  stands.
- **Update 2026-10-23: a sharpened area is a source with its own coverage,
  read only by those who may see it, and declared outside `DEM_SOURCES`.**
  `demSourcesFor` in `shared/src/sharpen.ts` puts each area the caller may
  read ([0040](0040-a-sharpened-area-is-a-private-dem-source.md)) above
  `DEM_SOURCES`, the finer first, then the newer. This is an exception to
  "one declaration": an area's zoom and credit come from its job's result at
  run time, not from `DEM_SOURCES`. The precedence and the one sampler still
  hold, and no file names an area's archive by URL or path. Each area
  declares its `coverage`, so the key `upgradeTrackClimbs` uses sees a new
  area: Logjam GPS keys it on `demSourcesFor` the account's kept areas, and
  then counts a track short of `lidar` as due (updated 2026-10-24; guard
  `mobile/src/tracks/trackClimb.test.ts`). Every area's
  heights are stored under one climb id, `lidar`, first in `CLIMB_SOURCES`,
  so a track's label names no job. Guard: `shared/src/sharpen.test.ts`.
  Everything else above stands.
- **Update 2026-10-18: a slope reads its window from the finest regional
  source with all nine pixels, never the worldwide tiles.** Slope is not a
  height, so `demSlopeReading` in `shared/src/demSlope.ts` walks
  `DEM_SOURCES` itself instead of calling `sampleDem`: it takes the first
  source whose coverage and tiles hold the whole 3 × 3 window of Horn, and
  gives no slope when none does, since the worldwide 30 m tiles are too
  coarse to show a cliff. Guard: `shared/src/demSlope.test.ts`.
  Everything else above stands.

Guards: `shared/src/demSources.test.ts` holds each seam case and fails when a
file outside the declaration names a source's URL. The API and Logjam GPS
readers are held to the same heights and source ids for one real tile by the
parity pair `api/src/services/elevation.unit.test.ts` and
`mobile/src/offline/demLookup.test.ts`.

## Consequences

- **Positive:** A new DEM is one entry in `DEM_SOURCES`. A line that crosses
  onto a finer DEM keeps the finer heights on that side and gains no false
  climb at the join.
- **Negative:** The chart can show a step at a seam that the totals beside it
  do not count. Each seam costs extra reads: two positions in every source
  from the coarser of the pair down to the first that has both. MapLibre takes
  one `raster-dem` source, so the 3D terrain on Logjam Web
  (`frontend/src/components/map/Map.tsx`) cannot follow the list and uses one
  source.
- **Neutral:** Heights from different sources are in different vertical
  datums (AHD for NSW, EGM96 for the worldwide tiles). They differ by well
  under a metre in NSW and are not corrected. A value computed from a DEM and
  stored must store the source id beside it.

## Alternatives considered

- **One source for the whole line: the finest that covers every position.**
  No seam can occur. Rejected because a line that leaves a fine DEM for a few
  metres would be read entirely from the coarser one, and lose the accuracy
  the fine DEM exists for.
- **Read the seam from the coarser of the two sources.** Usually right,
  because a coarse source usually lies under a fine one. Rejected because two
  footprints can meet without overlapping (a LiDAR job that borders the NSW
  DEM from outside the state): neither has both points, and only a source
  under both can measure the step.
- **Drop the step at every seam.** Simple, and needs no extra read. Rejected
  because the ground between the two samples does rise or fall, and a line
  that crosses a seam on a climb would lose that part of it.
- **Composite every DEM into one tile set on the server.** The clients would
  need no precedence. Rejected because a LiDAR job's DEM is private to the
  job's owner and cannot go into a shared archive, and a composite hides which
  source a height came from.
- **Derive a track's climb wherever it is shown** (2026-10-12). No stored
  figure to go stale. Rejected because the Saved list, the Stats totals and
  Logjam Web would each read terrain for every track they list, and the track
  sheet did exactly this while the other screens showed the stored GPS
  figure, so they disagreed.
- **Label a stored climb with the finest, or the most used, source in it**
  (2026-10-12). Reads better beside the figure. Rejected because the label's
  one job is to say whether a finer source could still improve the figure,
  and only the coarsest one answers that.
- **Keep a track wholly on GPS heights when any position has no DEM**
  (2026-10-12). One surface for the whole chart, and no join to level. Built
  and removed before merge: a track that strayed a few metres past a saved
  area lost the DEM for all the ground inside it until the phone was next
  online.
- **Ask again about every unimproved track on a timer** (2026-10-12). Built
  as a seven-day wait and removed before merge: a track outside NSW would be
  sent to the API every week for good, for an answer that changes only when
  the source list does.
- **Show Logjam Web's own terrain reading on a track's page** (2026-10-12).
  Always the best data the page can get. Rejected because the Ways list, the
  Stats totals and Logjam GPS would show the stored figure beside it, which
  is the disagreement the stored climb exists to end.
- **Leave replacing a stored climb to the phone that holds the line**
  (2026-10-12). One writer. Rejected because a track that reached the account
  from a phone no longer in use is never read again by anything.
- **Have the API compute the climb when the file is uploaded** (2026-10-12).
  It holds both the file and the DEM, so no client would need a pass. Not
  taken: a larger change, and a phone offline must still store a figure of
  its own at the finish.
- **Read a slope like a height, through `sampleDem` down the whole list**
  (2026-10-18). One sampler, and a slope wherever there is a height. Rejected
  because the worldwide 30 m tiles are within 5° of a 5 m survey at only 57 %
  of points (ground of 60° or steeper reads a median of 34° on them), and
  `sampleDem`'s four-pixel blend can fill a missing pixel from a neighbour.
- **Choose the source in each client.** Rejected by 0020: deciding twice is
  how the two clients drifted before.
- **Declare each sharpened area in `DEM_SOURCES`** (2026-10-23). One list for
  every source. Rejected because an area is private to the users who may see
  it, and its zoom, coverage and credit are known only from its job's result
  at run time. 0040 lists the other options it rejected.
