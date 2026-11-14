# Simulated-region archives

The simulated regions in `shared/src/simRegions.ts` (a made-up New Zealand
with two rings, a made-up Utah, and the everywhere tier around each) draw
real, published ground, so every place-aware path can be run end to end with
no real second region. This folder builds that ground's archives: heights,
slope, contours, a vector basemap, the OpenStreetMap places inside each box,
and one point cloud. Go here to rebuild them, or to cut the small copies the
tests commit.

`boxes.json` is the one declaration: each region's boxes, the archives it gets
and where they are written, and the credit each height archive carries.
`shared/src/simRegionsBuild.test.ts` holds its paths equal to the ones
`simRegions.ts` declares.

## Build

You need docker and the [`pmtiles`](https://github.com/protomaps/go-pmtiles)
binary (go-pmtiles) on `PATH`, or `PMTILES=/path/to/it`. The builders run in
the topo worker image, which `build.sh` builds from `topo/`.

```bash
scripts/sim-regions/build.sh                          # everything, into scripts/sim-regions/out/
OUT=~/sim-out scripts/sim-regions/build.sh --only simutah --step heights,slope
scripts/sim-regions/build.sh --fixtures               # also cut the committed copies
```

`--only` takes `simnz`, `simutah`, `world`; `--step` takes `heights`, `slope`,
`contours`, `vector`, `places`, `lidar`. A step whose output exists is skipped,
so a run that stopped carries on; `--force` redoes everything. Never run it
from CI: the heights come from Mapterhorn's download host, which states no
terms for ranged reads, and the build is the only thing that should make them.

`out/master/` has the layout the CDN serves (`master/dem/…`, `master/contours/…`,
`master/basemap/…`); `out/places/` the OpenStreetMap files and the registries
built from them; `out/lidar/` the point cloud; `out/work/` scratch, safe to delete.
The archives are large and never committed.

Hosts read, each by a plain client with nothing that names the project or its
maintainer: `download.mapterhorn.com` (heights, by byte range),
`build.protomaps.com` (vector, `pmtiles extract`), `overpass-api.de` (places),
`rockyweb.usgs.gov` (the point cloud). A refusal (429) is waited out, 2, 4, 8
minutes and so on, never retried at once. The point cloud's host answered 429
to its first three requests.
If your machine cannot reach Overpass (it refused connections from two
networks on 2026-11-14), put the `.osm` files in `out/places/` by hand, named
`<region>-<box number>.osm` (`simnz-0.osm`): the step reads a file that exists.

## What is built

Sizes are in MB as `pmtiles show` prints them, from the build on 2026-11-14
(Protomaps build 20261113).

| Region | Boxes (W, S, E, N) | Archives |
|---|---|---|
| `simnz` | 169.20, -44.10, 169.30, -44.01 (Makarora, Haast Pass; 1 m LiDAR throughout) and 175.58, -37.14, 175.68, -37.06 (Kauaeranga, Coromandel) | heights z8–17 (4,549 tiles, 202 MB), slope (166 MB), contours z11–14 (3.4 MB), vector z0–15 (1.8 MB), places |
| `simutah` | -113.00, 37.24, -112.89, 37.33 (Zion) | heights z8–15 (201 tiles, 9.6 MB), slope (8.1 MB), contours (2.8 MB), vector (1.7 MB), places, one USGS point cloud tile (176 MB) |
| `world` | 168.8, -44.6, 169.8, -43.6 and -113.5, 36.8, -112.5, 37.8 | heights z8–13 (2,226 tiles, 98 MB), vector z0–15 (29 MB) |

A region with two boxes is one archive: the boxes are built apart and joined
with `pmtiles merge`, and the metadata's `bounds` and `center` are set to the
header's afterwards, because a merge keeps the first input's.

Mapterhorn marks no edge where a fine survey ends, so a box's heights are 1 m
only where the survey is, and each credit says "where that survey covers".
The Makarora box was cut to lie inside the LINZ LiDAR (its z17 heights were
compared with the survey's own 1 m DEM, in the PR that added this); the other
boxes were only looked at on samples.

## Sources and credit

| Data | From | Licence | Credit |
|---|---|---|---|
| New Zealand heights | LINZ 1 m DEM through Mapterhorn | CC BY 4.0 | © Toitū Te Whenua Land Information New Zealand |
| Utah heights | USGS 3D Elevation Program 1 m DEMs through Mapterhorn | public domain, U.S. Government work | U.S. Geological Survey 3D Elevation Program |
| Heights outside a survey, and the world patches | COPERNICUS GLO-30 through Mapterhorn | COPERNICUS full, free and open licence | © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved |
| Vector basemap, places | OpenStreetMap, as the Protomaps daily build and as Overpass answers | ODbL | © OpenStreetMap contributors |
| Point cloud | `USGS_LPC_UT_Zion_2015_12SUG225265.laz`, USGS 3DEP | public domain | U.S. Geological Survey 3D Elevation Program |
| Slope, contours | derived from the heights above | as the heights | each archive's attribution names the heights it derives from |

Everything is published data, none a user's, so the Privacy rule on committed
examples holds for the fixtures below.

## Fixtures

`build.sh --fixtures` also cuts a tile or two of each archive over one small
box (`fixture` in `boxes.json`, and each archive's `fixtureZooms`) into
`shared/src/__fixtures__/sim-regions/`, about 1.3 MB in all. Archives are
ignored by git, so add a recut one with `git add -f`. A test holds the folder to
exactly one fixture per archive built, each a PMTiles file under 300 KB. Each
carries its archive's attribution, which is its credit.
