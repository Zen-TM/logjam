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
so a run that stopped carries on (an archive is written under a `.part` name
and renamed when whole); `--force` redoes everything, fetches included. Never run it
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
`<region>-<box number>.osm` (`simnz-0.osm`): the step uses a file that exists,
unless you pass `--force`, which fetches it again.

## What is built

The regions, their boxes, the archives each gets and their zoom ranges are in
`boxes.json`. Sizes of the build on 2026-11-14 (Protomaps build 20261113),
in MB as `pmtiles show` prints them:

| Archive | Tiles | Size |
|---|---|---|
| `simnz` heights (two boxes) | 4,549 | 202 |
| `simnz` slope, contours, vector | | 166, 3.4, 1.8 |
| `simutah` heights | 201 | 9.6 |
| `simutah` slope, contours, vector | | 8.1, 2.8, 1.7 |
| `world` heights (two patches) | 2,226 | 98 |
| `world` vector | | 29 |
| `simutah` point cloud (metres) | | 176 |

The `places` step (`simnz` and `simutah`) has not been run against Overpass: it
refused connections the day this was built. The registry builder it calls was
run on a 1 km Overpass sample and reads it.

A region with two boxes is one archive: the boxes are built apart and joined
with `pmtiles merge`. A merge keeps the first input's metadata and an extract
the source's, so `build.py` sets `bounds`, `center`, `minzoom` and `maxzoom` to
the header's on a merged archive and on every fixture.

Mapterhorn marks no edge where a fine survey ends, so a box's heights are 1 m
only where the survey is, and each credit says "where that survey covers".
The Makarora box was cut to lie inside the LINZ LiDAR; the other boxes were
only looked at on samples.

## Sources and credit

| Data | From | Licence | Credit |
|---|---|---|---|
| New Zealand heights | LINZ 1 m DEM through Mapterhorn | CC BY 4.0 | © Toitū Te Whenua Land Information New Zealand |
| Utah heights | USGS 3D Elevation Program 1 m DEMs through Mapterhorn | public domain, U.S. Government work | U.S. Geological Survey 3D Elevation Program |
| Heights outside a survey, and the world patches | COPERNICUS GLO-30 through Mapterhorn | COPERNICUS full, free and open licence | © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved |
| Vector basemap, places | OpenStreetMap, as the Protomaps daily build and as Overpass answers | ODbL | © OpenStreetMap contributors |
| Point cloud | `USGS_LPC_UT_Zion_2015_12SUG225265.laz`, USGS 3DEP | public domain | U.S. Geological Survey 3D Elevation Program |
| Slope, contours | derived from the heights above | as the heights | the archive's credit (the contours': its `description`) names the heights it derives from |

Everything is published data, none a user's, so the Privacy rule on committed
examples holds for the fixtures below.

## Fixtures

`build.sh --fixtures` also cuts a tile or two of each archive over one small
box (`fixture` in `boxes.json`, and each archive's `fixtureZooms`) into
`shared/src/__fixtures__/sim-regions/`, about 1.3 MB in all. Archives are
ignored by git, so add a recut one with `git add -f`. A test holds the folder to
exactly one fixture per archive built, each a PMTiles file under 300 KB whose
metadata says what its header does. The credit travels with each: in its
`attribution` metadata, except the contours', whose builder writes it in
`description` ("Contours derived from: …").
