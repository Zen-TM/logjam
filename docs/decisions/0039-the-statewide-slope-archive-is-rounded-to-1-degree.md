# 0039. The statewide slope archive is terrarium PMTiles rounded to 1°: Horn over the height tiles, a max pyramid

- **Date:** 2026-10-18
- **Status:** Accepted
- **Supersedes:** —

## Context

Logjam needs steepness bands (the user's slope bands, default 40° and up) over
the map for all of NSW, not only inside a LiDAR job's footprint. Slope at a point is already computed from the height
tiles by `demSlopeAt` in `shared/src/demSlope.ts`, using Horn's method (GDAL's
standard 3 × 3 slope); a layer needs the same figure for every pixel, from a
file a client reads by byte range. `topo/build_nsw_dem.py slope` builds that
file from the height archive
([0031](0031-nsw-heights-come-from-the-spatial-services-5m-dem.md)); in AWS,
`slope-s3` runs it on the published archive and uploads `nsw-5m-slope.pmtiles`
beside `nsw-5m.pmtiles` in the bucket's `master/dem` folder. The choices below are costly to undo: the statewide build
came out at 18.68 GB (z8–15), against 16.9 GB for the height archive.

Measured on the Katoomba sheet, one of the most rugged in the state, the
whole sheet's archive size at z8–15:

| Archive | Bytes |
|---|---|
| heights, ¼ m, PNG level 9 | 133 MB |
| slope, ¼°, PNG level 9 | 178 MB |
| slope, 1°, PNG level 9 | 97.5 MB |
| slope, 1°, PNG level 6 (shipped) | 107 MB |

Katoomba came out smaller than its heights; the whole state came out about
10 % larger, so treat the sheet's ratios as indicative, not as bounds.

Per z15 tile on one core: Horn costs 2.6 ms, PNG level 9 costs 250–360 ms, and
level 6 costs 17–33 ms. On an area estimate of about 750 k z15 tiles, z15
plus the pyramid is about 85 core-hours at level 9 against about 8 at level 6.
The builder takes an estimated 13 core-hours at level 6 (45 ms a tile on
Katoomba's fullest blocks (the builder works in blocks of 32 × 32 z15 tiles,
one z10 tile, each a separate job), over 1.03 M tiles at all zooms, z8–15): under two
hours on the 8 vCPU worker task, allow three, against about half a day at
level 9.

## Decision

- **Encoding:** the terrarium PNG of
  [0030](0030-dem-tiles-are-terrarium-png-in-pmtiles.md), in one PMTiles
  archive, where the "height" is the slope in degrees. At z15 a pixel is
  `(0, 0, 0)`, no value, wherever any of the nine heights Horn needs is
  missing; at a coarser zoom only where all four pixels below it have none,
  and a tile with no value anywhere is left out. Zoom 8 to 15. Credit:
  derived from the NSW 5 m DEM, with the tail of `NSW_5M.credit`.
- **Slope as a fake DEM.** The archive holds no colour, so a client draws it
  with a `color-relief` layer and the user's bands as doubled stops, which
  give hard band edges. `color-relief` draws them in the MapLibre Native build
  Logjam GPS ships (13.5.0), checked on a phone. The archive can be clipped
  for an offline area by the same byte-range cut as the height archive.
- **Rounded to 1°** (`SLOPE_ROUNDING_DEG`), not 0030's quarter metre. Bands
  are whole degrees apart, so a finer step buys nothing a band can show, and
  on the Katoomba sheet at level 9 a 1° archive is 27 % smaller than the
  heights where a ¼° one is 33 % larger.
- **A max pyramid** (`halve_max`), not 0030's mean. Each coarser zoom is the
  maximum of the four pixels below it. A mean drops a narrow cliff out of the
  top band as you zoom out (on 2 m data, two thirds of the 70–90° pixels were
  gone by z13); the max keeps every cliff and draws it thicker, as ordinary
  generalisation does.
- **PNG level 6**, not the height archive's 9. It encodes about ten times
  faster for 8–12 % more bytes. The height archive keeps level 9 so its
  published bytes do not change.
- **Horn over the z15 height tiles**, with a one-pixel border read from the
  eight neighbouring tiles, and a pixel's ground size taken from its row's
  latitude. This is `demSlopeAt` run over every pixel, so at z15 the colour on
  the map and the number at a tap agree to within the 1° rounding. Seams
  between tiles and between the builder's blocks are invisible because every tile
  sees its neighbours.

Guard: `topo/tests/test_nsw_dem.py` holds the terrarium encoding with
`(0, 0, 0)` for no data, the 1° rounding, PNG level 6, the credit, and Horn
with its border and per-row pixel size. `TestBlockSlope` compares a
2 × 2-tile block's slope with Horn run over the whole 4 × 4-tile mosaic.
`halve_max` keeps the steepest of four, and `test_the_slope_layer_uses_it`
holds that the slope layer's `reduce` field is `halve_max`, not that the
pyramid built from it is a max: a build path that calls `halve` directly
would pass. Mutations that turn the tests red: the layer's `reduce` swapped
for the mean, a mean inside `halve_max`, a rounding other than 1°,
Horn weights of 1-1-1, a missing centre-pixel check, the neighbour ring read
from the wrong tile, and a row's latitude taken from the wrong origin.
`shared/src/demSlope.test.ts` and `test_nsw_dem.py` assert the same bumpy window to
the same figure. Only the z15 tile of `TestSlopeBlock` holds the top of the
zoom range; nothing holds the bottom (8), that a tile with no value is left out, or a
client drawing the archive.

## Consequences

- **Positive:** one decode in every runtime, and a map band agrees with the
  slope a user reads at a tap at z15, to within the 1° rounding.
- **Negative:** a band edge can sit up to half a degree from the true one.
  Zoomed out, the max draws cliffs wider than the real cliff and bands wider
  than a tap reads. PNG level 6 costs 8–12 % in bytes on the server and in
  every saved area. A change to the slope bands needs no rebuild, but a change
  to the rounding, the pyramid or Horn does, for the whole state.
- **Later:** neither client draws or clips the archive yet, and a LiDAR job's
  slope is still colour baked into its own `slope.mbtiles`, the alternative
  rejected below.
- **Neutral:** slope from the z15 height tiles, before the 1° rounding,
  differs from Horn on the native 5 m grid (warped onto the tile grid) by 0.4°
  mean absolute error over the Katoomba sheet, and every pixel that is 60° or
  steeper on the native grid is 50° or steeper here; on cliffs it reads
  slightly steeper.

## Alternatives considered

- **Follow 0030 and the height archive as they are: a mean pyramid, ¼°
  rounding and the heights' PNG level 9.** What a
  reader of 0030 would reach for. The mean removes cliffs from the top band as
  you zoom out; ¼° made the Katoomba archive a third larger than the heights for no
  visible gain; level 9 costs about 85 core-hours (about 11 h on 8 vCPU)
  instead of 8 for about 7–11 % fewer bytes.
- **Bake the default bands into the tiles as colour.** Simplest to draw,
  and rejected because a user's own bands would need a rebuild of the whole
  archive. Keeping slope as a "fake DEM" lets MapLibre colour it per user, and
  overzoom is smooth because it interpolates the DEM.
- **Horn on the native 5 m grid, warped to web mercator.** The most faithful
  slope, and rejected because it needs its own warp per sheet and its own
  seam handling for no change a band can show, and because it is not equal to
  `demSlopeAt`, so a tap and the colour could disagree.
