# 0039. The statewide slope archive is a 1° terrarium PMTiles archive: Horn over the height tiles, a max pyramid

- **Date:** 2026-10-23
- **Status:** Accepted
- **Supersedes:** —

## Context

Logjam draws steepness bands (the user's slope bands, default 40° and up) over
the map, and Logjam Web and Logjam GPS both need them for all of NSW, offline
included. Slope at a point is already computed from the height tiles by
`demSlopeAt` in `shared/src/demSlope.ts`; a layer needs the same figure for
every pixel, from a file the clients read by byte range.
`topo/build_nsw_dem.py slope` builds that file from the published height
archive ([0031](0031-nsw-heights-come-from-the-spatial-services-5m-dem.md))
into `nsw-5m-slope.pmtiles` in the topo bucket's `master/dem` folder, beside
`nsw-5m.pmtiles`. The sharpened
areas of later LiDAR jobs write the same format, so the clients read one
format whatever its source, and the choices below are costly to undo once a
statewide archive (about 11–13 GB) exists.

Measured on the Katoomba sheet, one of the most rugged in the state, so its
sizes are upper bounds for the state:

| Archive, z8–15 | Bytes |
|---|---|
| heights, ¼ m, PNG level 9 | 133 MB |
| slope, ¼°, PNG level 9 | 178 MB |
| slope, 1°, PNG level 9 | 97.5 MB |

Per z15 tile on one core: Horn costs 2.6 ms, PNG level 9 costs 250–360 ms, and
level 6 costs 17–33 ms. A statewide build at level 9 is about 85 core-hours;
at level 6 about 13.

## Decision

- **Encoding:** the terrarium PNG of
  [0030](0030-dem-tiles-are-terrarium-png-in-pmtiles.md), in one PMTiles
  archive, where the "height" is the slope in degrees. A pixel with no value
  is `(0, 0, 0)`, written wherever any of the nine heights Horn needs is
  missing. Zoom 8 to 15. Credit: derived from the NSW 5 m DEM, with the
  tail of `NSW_5M.credit`.
- **Slope as a fake DEM.** The clients draw it with a `color-relief` layer
  and the user's bands as doubled stops; the archive holds no colour.
- **Rounded to 1°** (`SLOPE_ROUNDING_DEG`), not 0030's quarter metre. Bands
  are whole degrees apart, so a finer step buys nothing a band can show, and
  1° archives are 27 % smaller where ¼° ones are 33 % larger than the heights.
- **A max pyramid** (`halve_max`), not 0030's mean. Each coarser zoom is the
  maximum of the four pixels below it. A mean drops a narrow cliff out of the
  top band as you zoom out (on 2 m data, two thirds of the 70–90° pixels were
  gone by z13); the max keeps every cliff and draws it thicker, as ordinary
  generalisation does.
- **PNG level 6**, not 0030's 9. It encodes about ten times faster for 8–12 %
  more bytes, which is the difference between an afternoon and a week of
  cloud time. The height archive keeps level 9 so its published bytes do not
  change.
- **Horn over the z15 height tiles**, with a one-pixel border read from the
  eight neighbouring tiles, and a pixel's ground size taken from its row's
  latitude. This is `demSlopeAt` run over every pixel, so the colour on the
  map and the number at a tap cannot disagree. Seams between tiles and
  between build blocks are invisible because every tile sees its neighbours.

Guard: `topo/tests/test_nsw_dem.py` decodes what the builder encodes with the
clients' formula and holds each choice above. Mutations that turn it red: a
mean instead of the max, a rounding other than 1°, Horn weights of 1-1-1, a
missing centre-pixel check, a border one pixel short, and a block's slope that
differs from Horn over the whole mosaic. `shared/src/demSlope.test.ts` and
that file assert the same bumpy window to the same figure.

## Consequences

- **Positive:** one decode in every runtime, the archive is clipped for
  offline areas the way the height archive is, and a map band always agrees
  with the slope a user reads at a tap, to within the 1° rounding.
- **Negative:** a band edge on the map can sit up to half a degree from the
  true one. Cliffs drawn from a max are wider than the real cliff when zoomed
  out. PNG level 6 costs 8–12 % in bytes on the server and in every saved
  area. A change to the slope bands needs no rebuild, but a change to the
  rounding, the pyramid or Horn does, for the whole state.
- **Neutral:** against Horn on the native 5 m grid, warped to the tile grid,
  the tiles route differs by 0.4° mean absolute error, and every pixel that is
  60° or steeper on the native grid is 50° or steeper here; on cliffs it reads
  slightly steeper.

## Alternatives considered

- **Bake the default bands into the tiles as colour.** Simplest to draw, and
  rejected because a user's own bands would need a rebuild of 11–13 GB. Keeping
  slope as a "fake DEM" lets the client draw it with `color-relief` and the
  user's bands as doubled stops, which give hard band edges, and overzoom is
  smooth because MapLibre interpolates the DEM. `color-relief` exists in the
  MapLibre Native build Logjam GPS ships; it was not run on a device.
- **Horn on the native 5 m grid, warped to web mercator.** The most faithful
  slope, and rejected because it needs its own warp per sheet and its own
  seam handling for no change a band can show, and because it is not equal to
  `demSlopeAt`, so a tap and the colour could disagree.
- **Round to ¼°.** One third larger than
  the heights themselves for no visible gain.
- **The mean for the pyramid, as 0030 does for heights.** Right for heights,
  wrong for slope: it removes cliffs from the top band as you zoom out.
- **PNG level 9, as 0030 does.** About 85 core-hours statewide for 8–12 %
  fewer bytes.
