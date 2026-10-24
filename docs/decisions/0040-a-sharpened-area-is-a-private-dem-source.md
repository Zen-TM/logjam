# 0040. A sharpened area is a private DEM source, and each map tile comes from one archive

- **Date:** 2026-10-23
- **Status:** Accepted
- **Supersedes:** —

## Context

A LiDAR job now sharpens an area (`topo/sharpen.py`, #590): instead of styled
layers, it writes the statewide terrain formats at the survey's own cell.
That means a heights archive ([0030](0030-dem-tiles-are-terrarium-png-in-pmtiles.md)),
a slope archive ([0039](0039-the-statewide-slope-archive-is-rounded-to-1-degree.md))
and a contour archive, from z15 to z16 for 2 m ground or z17 for 1 m. The
statewide versions are public archives on the CDN (`shared/src/terrain.ts`,
`shared/src/nswContours.ts`), and every client draws them as the Terrain
group. A job's archives are not public: a job is its owner's, and it reaches
another user only by a direct share (`directlySharedIds` in
`api/src/lib/shareAccess.ts`).

The lab run before W5 drew a sharpened area over the statewide layers and
found three problems:
- The 5 m slope shows as a halo around the area's edge, and alpha doubles
  where the two overlap.
- Blanking the statewide tiles under the area shades a false cliff along
  each blank tile's edge, because MapLibre fills a hillshade tile's border
  from its neighbours in the same source.
- A per-pixel composite would make the phone encode PNG when it saves an
  area, and Logjam GPS has only a PNG decoder (0030).

## Decision

- **A sharpened area is a DEM source.** `sharpenedDemSource` in
  `shared/src/sharpen.ts` declares it with id `lidar-<job id>`, its zmax as
  the sample zoom, and its `coverage`. It ranks above every public source
  ([0028](0028-a-height-comes-from-the-finest-dem-source-that-has-it.md)).
  Among areas, the finer one wins, then the newer, then the lower id
  (`compareSharpenedAreas`). `demSourcesFor` gives the sampler that order,
  and the tile router uses the same one. They share the precedence, not the
  test of which areas hold a point: the sampler asks an area's `coverage`,
  the router its tile range, which is the coverage widened to whole z14
  tiles. So in that margin the first-ranked area's tile (its 5 m fill) can
  be drawn where a lower-ranked area's coverage answers the height. A source names its
  archive by `areaId`, never by a URL or a path.
- **Only the owner and the users it is shared with directly read it.**
  `visibleSharpenedAreas` in `api/src/services/sharpenedAreas.ts` applies the
  rule `completed-overlays` already applies.
  - The API reads an area's archive from the topo bucket by range, on its own
    role (`api/src/services/elevation.ts`).
  - A client gets the archives as presigned URLs in
    `GET /topo-jobs/completed-overlays`, in a `sharpened` field of its own
    (`SharpenedOverlay`), so a build that reads only `layers` ignores it. The
    archive keys reach a client only inside the presigned URLs, never as
    fields of their own.
  - A stranger gets the statewide answer, worded as anywhere else.
- **Each map tile comes from exactly one archive.** `terrainTileArchive`
  routes heights and slope from z15 to the first area whose z15 range holds
  the tile, down to that area's zmax. Past it, or past z15 outside every
  area, the tile is absent and the renderer draws its parent. Contours route
  at z14, the statewide archive's deepest zoom, and are never absent. To make
  that hold, an area's archives hold every tile of the range: the footprint's
  bbox in z15 tiles, widened to whole z14 tiles, and every descendant. Where
  the survey has no ground, the worker bakes in the statewide 5 m value when
  the job runs.
- **A track's climb from any area is stored as `lidar`**
  (`SHARPENED_CLIMB_SOURCE`), first in `CLIMB_SOURCES`, so a stored label
  names no job.
- **The credit is declared once, by the worker.** `credit` in
  `topo/sharpen.py` writes it into the job's result, and the API passes it
  on. Every result read from an area also carries the NSW 5 m credit
  (`demCredits`), because the area's edge tiles hold 5 m heights.

Guards:
- `shared/src/sharpen.test.ts`: the precedence, the routing at each edge of
  a range and past zmax, the sampler taking the finer area, the credit, and
  the `lidar` climb.
- `api/src/services/sharpenedAreas.unit.test.ts`: a key outside the job's own
  outputs is refused.
- `api/src/__tests__/sharpenedAreas.test.ts`: owner, sharee, stranger and
  revoked share, end to end.
- `api/src/services/elevation.unit.test.ts`: an area read from S3 by range.
- `topo/tests/test_sharpen.py`:
  - `TestTileRange`: the range widened to whole z14 tiles;
  - `TestPyramid.test_every_zoom_from_zmax_to_z15_at_the_blocks_tiles`;
  - `TestBlockGrids`: the survey first, then the 5 m fill;
  - `TestCredit`.
- `topo/tests/e2e/check.py`: the job's result carries the survey's credit.

## Consequences

- **Positive:**
  - No halo, no doubled alpha, and a hillshade whose border fill reads real
    heights on both sides of an area's edge.
  - One sampler, so heights, slope at a point and climbs read an area for
    everyone who can see it, in the same way.
- **Negative:**
  - **Overlapping areas.** Inside the losing area's footprint, within the
    winning area's tiles, the winner's 5 m fill shows rather than the loser's
    survey.
  - **Stale fill.** A statewide rebuild leaves the old 5 m data, and its
    credit month, in each area's edge tiles until the area is sharpened
    again (accepted by the maintainer, 2026-10-24).
  - **Repeated bytes.** Each archive repeats statewide data in its edge
    tiles.
  - **Revoking.** A presigned URL keeps working until it expires, 24 h at
    most after the share ends.
  - **Old builds.** A Logjam GPS build older than this stores the climb of
    a profile read wholly inside areas as `terrarium`. Logjam Web relabels
    the account's copy as `lidar` when the track is opened. Logjam GPS
    relabels its row when the track's stats open with the line not fully
    covered by saved terrain, or for every track once its upgrade key covers
    areas (0028's update of 2026-10-23).
- **Neutral:** each client routes per tile, and reads an area's archive
  straight from its presigned URL, so no tile index reaches Logjam's servers.
  Logjam Web does it in the browser with a MapLibre protocol. MapLibre Native
  has no custom protocol, so Logjam GPS cuts the map into rectangles that each
  read one archive: the statewide layer stops where routing starts, and each
  rectangle is a source kept to its tiles by the bounds in a TileJSON the
  phone writes (`mobile/src/map/terrainRoutes.ts`). Update of 2026-10-24:
  this replaces a routing API route, whose tile traffic the API's per-IP
  request limit at the CDN would have blocked (maintainer, 2026-10-24).

## Alternatives considered

- **Draw the area over the statewide layers.** What a client would do with
  any overlay. Rejected: it draws the halo and doubles the alpha.
- **Blank the statewide tiles under a separate area layer.** Works for
  slope. Rejected because the hillshade shades a false cliff along every
  blank tile's edge.
- **Composite per pixel in each client.** Handles overlapping areas best.
  Rejected because the phone would have to encode PNG to save an area, and
  every client would need the same compositor.
- **One composite archive on the server.** Rejected for the reason 0028
  gives: an area is private to the users who may see it.
- **Keep a ground-only raster per job, so the fill can be rebuilt without
  the ZIP.** About 1.5 bytes a pixel more per job. Rejected by the maintainer
  (2026-10-24): a statewide sharpening is likely to come before any 5 m
  rebuild.
- **A climb id per job.** It would name the job in every track's stored
  label, and a phone could not rank an id it has never seen.
- **The survey credit as a constant in `shared/`.** It would need a parity
  test against the worker's copy, and the extraction month differs for each
  area.
