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
  one reaches it. Absent means GPS heights, which is also what a line with a
  position no source can answer keeps. `upgradeTrackClimbs` in
  `mobile/src/tracks/trackClimb.ts` asks again on the first sync cycle after
  the finish, and after that only when the ids or `coverage` in
  `DEM_SOURCES` change; nothing polls. It reads saved terrain and
  `POST /elevation/profile`, never a public tile host, because nobody opened
  the track. Guards: `shared/src/elevation.test.ts`,
  `mobile/src/tracks/trackClimb.test.ts`. Cost: a stored figure can be older
  than the best terrain, a phone built with a new source before the API
  serves it marks its tracks as asked, and an archive rebuilt inside an
  unchanged `coverage` re-asks nothing. Everything else above stands.

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
- **Ask again about every unimproved track on a timer** (2026-10-12). Built
  as a seven-day wait and removed before merge: a track outside NSW would be
  sent to the API every week for good, for an answer that changes only when
  the source list does.
- **Choose the source in each client.** Rejected by 0020: deciding twice is
  how the two clients drifted before.
