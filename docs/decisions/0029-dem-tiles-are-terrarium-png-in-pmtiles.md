# 0029. A DEM Logjam builds is terrarium PNG tiles, rounded to a quarter metre, in one PMTiles archive

- **Date:** 2026-10-10
- **Status:** Accepted
- **Supersedes:** —

## Context

[0028](0028-a-height-comes-from-the-finest-dem-source-that-has-it.md) lets
Logjam read heights from more than one DEM. The first one Logjam builds itself
is the NSW Spatial Services 5 m DEM (#341), tiled by `topo/build_nsw_dem.py`.
Its file format is read by three runtimes and saved on phones, so it is costly
to change once a statewide archive exists.

What each runtime can already decode:

- The API decodes PNG with `canvas` (`api/src/services/elevation.ts`).
- Logjam GPS has no image decoder for raw pixels. It inflates PNG with `fflate`
  and undoes the filters by hand (`mobile/src/offline/demPng.ts`).
- Logjam Web hands MapLibre a `raster-dem` source, which decodes whatever the
  browser can and understands the terrarium and Mapbox encodings.

Measured on six whole sheets, mean bytes of a full zoom-15 tile:

| Encoding | Rugged (Katoomba) | Flat (Hay) |
|---|---|---|
| terrarium PNG, unrounded (1/256 m) | 100 KB | 34 KB |
| terrarium PNG, 1/8 m | 43 KB | 7.3 KB |
| terrarium PNG, 1/4 m | 34 KB | 4.7 KB |
| terrarium lossless WebP, 1/4 m | 23 KB | 2.7 KB |
| Mapbox Terrain-RGB PNG, 0.1 m | 39 KB | 7.9 KB |

The publisher states the data is good to ±0.9 m on open ground.

## Decision

- **Encoding:** terrarium, `height = R × 256 + G + B / 256 − 32768`, the same
  as the worldwide source, so `demSampleHeight` in `shared/src/demTiles.ts` is
  the one decode. A pixel with no height is `(0, 0, 0)`, which that function
  skips.
- **Image:** PNG, 256 px.
- **Rounding:** heights are rounded to a quarter of a metre before encoding.
- **Pyramid:** each coarser zoom is the mean of the heights below it, taken
  before encoding, never the mean of encoded pixels.
- **Container:** one PMTiles archive per source, read by byte range.

Guard: `topo/tests/test_nsw_dem.py` decodes what the builder encodes with the
clients' formula, and checks the no-data value and the rounding.

## Consequences

- **Positive:** no new decoder in any runtime, and no new native dependency in
  Logjam GPS. The archive is served, clipped and read the way the vector
  basemap already is: `pmtiles extract` cuts an offline area out of it, and
  `shared/src/snapTiles.ts` shows the reader working in all three runtimes.
- **Negative:** PNG is about a third larger than lossless WebP, on the server
  and in every offline area a phone saves. A quarter metre is coarser than the
  source's own digits: on dead-flat ground it adds about 0.6° of slope noise at
  zoom 15.
- **Neutral:** the worldwide source stays a public XYZ tile set that Logjam
  does not build, so a phone holds two kinds of saved DEM file: an MBTiles
  pyramid for it, a PMTiles clip for a source built here.

## Alternatives considered

- **Lossless WebP.** A third smaller. Logjam GPS would need a WebP decoder
  that returns raw pixels: none exists in JavaScript at a size worth shipping,
  and a native one means a new native dependency and a new build for a saving
  of about 5 GB on the server and a few megabytes per saved area. Rejected for
  now; the encoding and container would not change if it is revisited.
- **Mapbox Terrain-RGB at 0.1 m.** MapLibre reads it too. It is no smaller
  than terrarium at 1/8 m, and it would give the shared sampler a second
  decode for no gain.
- **Rounding to 1/8 m.** 22 % larger on rugged ground and 36 % larger on flat
  ground than a quarter metre, for digits finer than the data's stated
  accuracy.
- **MBTiles on the server.** It cannot be read by byte range, so the API would
  need the whole file on local disk and the browser could not read it at all.
- **512 px tiles.** A quarter of the requests, but `DEM_TILE_SIZE` is 256 in
  the shared sampler and in every saved area, and the worldwide source is 256.
