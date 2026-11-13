# 0052. A new region's heights are a Mapterhorn extract, transcoded to ADR 0030 tiles and hosted by Logjam

- **Date:** 2026-11-14
- **Status:** Accepted
- **Supersedes:** —

## Context

[0031](0031-nsw-heights-come-from-the-spatial-services-5m-dem.md) gave NSW its
own height archive, built from one agency's sheets. A second region cannot
repeat that: it would need a fetcher and a warp per country (the
`fetch` and `tile` steps of `topo/build_nsw_dem.py` are the NSW portal's).

[Mapterhorn](https://mapterhorn.com) publishes open heights for the world
as one tile set per zoom range: `planet.pmtiles` (zoom 0 to 12) and a
`6-x-y.pmtiles` file for each zoom-6 tile with finer data (zoom 13 and up), in
`download_urls.json` on `download.mapterhorn.com`. The tiles are 512 px
terrarium in lossless WebP, and each source's credit is in `attribution.json`.
Its `attribution.json` lists 1 m sources in New Zealand (`nz`, LINZ) and the
United States (`us1*`, USGS 3DEP), in part of each, and the builder keeps its
pixels (the archive built from it agrees with Mapterhorn's tiles to the
rounding step), so a region's heights are a cut of it.

Mapterhorn is not used for NSW. Its Australian source is Geoscience
Australia's 5 m LiDAR composite, which covers part of the state, not the
statewide model that 0031 builds from.

What each reader can decode. The API's refusal was run against a real
Mapterhorn tile on 2026-11-14; the rest is from the code and MapLibre's
documentation:

- MapLibre and the browser: WebP.
- The API (`api/src/services/elevation.ts`, `canvas`): WebP is refused with
  "Unsupported image type".
- Logjam GPS (`mobile/src/offline/demPng.ts`): PNG only, inflated by hand with
  `fflate`; no Expo module returns pixels.

Transcoding costs bytes: when this was planned, on 12 tiles at zoom 12, 14 and
16 in New Zealand and Utah the four PNG tiles were 1.36 to 1.58 times the WebP's size, the ratio
[0030](0030-dem-tiles-are-terrarium-png-in-pmtiles.md) measured (34 KB against
23 KB) and accepted.

What Mapterhorn does where a fine survey ends, read on real tiles
(2026-11-14). The land tiles are from New Zealand's South Island, the Makarora
valley, as `topo/build_region_dem.py` built them. Which ground is which was
told from a tile's size and smoothness, not from a survey's own extent, and the
built archive was compared with Mapterhorn's tiles, not with a survey's model.

- In the tiles read it wrote no no-data: each is RGB with no alpha, and none of
  all 2,208 zoom 17 tiles built for the Makarora box has a pixel at the
  terrarium value for -32768 m. No void inside a survey was met, so what it
  does at one is unverified. The builder still maps a transparent pixel and
  that value to no-data, in case another region's sources write them. The one
  Tasman Sea tile tried, at zoom 12 and zoom 8, is absent: where it has no
  data it may have no tile.
- Open sea in the tiles read is exactly 0 m: a tile off the Sydney coast (the
  planet file, zoom 12 and zoom 8: 52 bytes, one value); a coast tile at Sydney
  Heads has 0 m as its lowest height.
- Where a fine survey does not cover, the tile is still there, at the same
  zoom, made from a coarser source. Over Makarora that is most likely Copernicus
  GLO-30. This is inferred: a tile does not name its source, but at zoom 16
  (1.7 m a pixel) the smooth tiles are about 70 to 90 KB and show nothing finer
  than 30 m, and `attribution.json` has one global 30 m source (`glo30`). The
  tiles that look like 1 m LiDAR are about 120 to 200 KB. The two meet along an edge inside one tile. Mean second
  difference across a row is 0.016 m on the smooth side and 0.05 to 0.2 m on
  the other. Across the edge in one tile, the difference to Mapterhorn's own
  zoom 12 tile upsampled averaged -0.01 m on the smooth side and +0.02 m on the
  other: no offset between the sides against Mapterhorn's coarse tile. The survey's own vertical datum
  against that source's was not examined.

So a tile's zoom says nothing about how fine its ground is.

## Decision

- **A region's heights are a Mapterhorn extract.** `topo/build_region_dem.py
  heights` reads Mapterhorn's files by byte range over a box and writes one
  archive in the form of 0030: terrarium PNG, 256 px, in PMTiles, with a
  quarter-metre rounding to zoom 15 and the step halved each zoom deeper (as
  `rounding_at` in `topo/sharpen.py`), each coarser zoom the mean of the
  heights below it.
- **Transcoded once, at build time.** Each 512 px WebP tile at zoom z becomes
  four 256 px PNG tiles at z + 1. The pixels line up, so nothing is resampled.
  No reader learns WebP, and `DEM_TILE_SIZE` stays 256.
- **Hosted by Logjam.** The archive is built once and served from Logjam's own
  bucket like `nsw-5m`. No client or API code reads `tiles.mapterhorn.com` or
  `download.mapterhorn.com` at run time. The build is the only caller, from a
  host, never from CI, and its requests carry a generic client name
  (`USER_AGENT` in `topo/build_region_dem.py`).
- **No-data is 0030's.** A pixel Mapterhorn marks as no height (a transparent
  pixel, or the terrarium value for -32768 m) is written as `(0, 0, 0)`. Sea
  stays 0 m, as published.
- **The credit names every source in the box, and says where the ground is
  coarse.** It lists each of Mapterhorn's sources the box draws on (from
  `attribution.json`) with its licence, and, because the archive holds no mark
  of where a fine survey ends, says that the finest heights exist only where
  that survey covers and names the coarser source the rest comes from. Over
  Makarora that is inferred to be Copernicus GLO-30 at 30 m; elsewhere it may
  be a 10 m or a 5 m source, and the credit says what the box draws on.
- **Rounding.** A region's archive is rounded as a sharpened area's is, as
  [0030](0030-dem-tiles-are-terrarium-png-in-pmtiles.md)'s update of the same
  date says. Guard: `TestRounding` in `topo/tests/test_region_dem.py`.
- **Guards.** `topo/tests/test_region_dem.py` decodes what the builder writes
  (with `decode_terrarium`, which `test_nsw_dem.py` holds equal to the
  clients' formula), and checks the quarter addressing, the rounding
  per zoom, the no-data cases, the range reads (a short or dropped reply, a 429's
  `Retry-After`, a reply that is not the range asked for) and the written
  archive's zoom range, bounds and attribution. In the same file
  `TestMapterhornIsOnlyTheBuildsToRead` holds that no file under `shared/src`,
  `frontend/src`, `mobile/src` or `api/src` names `mapterhorn.com` (with a
  floor on the files scanned) and that `USER_AGENT` names no project or person.
  No check holds "the build never runs from CI", that `topo/`'s other workers
  do not read Mapterhorn, or the wording of a credit, which is an argument of
  the build: review holds them.

## Consequences

- **Positive:** a region's heights cost one command and no new reader. The
  result has the format of an archive `build_nsw_dem.py` made, so the sampler,
  the API, the phone's decoder and every `raster-dem` source should take it
  unchanged; no client was run against one in this change. The Makarora box
  (9.6 by 10 km, zoom 17, mostly coarse ground) is 77 MB. A box wholly of 1 m
  ground would be larger: an estimate from the tile sizes above, about twice
  that, not measured.
- **Negative:** PNG is 1.4 to 1.6 times the WebP, so the planet at zoom 1 to 13
  would be about 500 GB (an estimate) where Mapterhorn's file is 356 GB, and
  its one-off transcode is a large job. Logjam hosts and is responsible for a derived copy
  of other people's data, under each source's licence.
- **Negative:** a region's heights are not one resolution, and nothing in the
  archive says where they are fine. A map or a slope reading near a survey's
  edge changes character with no sign of it.
- **Negative:** Mapterhorn states no terms for range reads of its download
  host. The build makes the traffic `pmtiles extract` makes, which its data page
  documents, as read when this was planned. If the host refuses, the build moves to Mapterhorn's
  published source tarballs.
- **Neutral:** NSW stays on 0031. Heights are as each source publishes them,
  on its own vertical datum, with no conversion.
- **Later work:** `slope` and `contours` in `topo/build_nsw_dem.py` read an
  archive of NSW's zooms only; a region's need them to take any heights
  archive.

## Alternatives considered

- **Read Mapterhorn's tile endpoint from the clients.** Nothing to host. It
  states no terms we found, is understood to log each reader's address and
  referrer (not verified here), and a map view would send where a user is
  looking to a third party. Logjam GPS cuts its
  offline clips from Logjam's own archives for the same reason
  ([0036](0036-the-phone-cuts-its-own-offline-clips.md)).
- **Teach the readers WebP.** No transcode and a third smaller. It needs an
  image dependency in the API, a native decoder or a second hand-written
  codec on the phone, a tile size per source through `resolveDemSamples`, a
  second zoom convention in every `raster-dem` source, and new byte estimates
  for offline saves. The cost of transcoding is bytes on a server; the cost of
  this is code in three runtimes. Revisit only if those bytes matter.
- **A national pipeline per country, as NSW has.** Finer where an agency has
  a model Mapterhorn lacks, as in NSW. A fetcher and a warp for each, and none of
  the regions planned with this was known to have such a source.
- **Copernicus GLO-30 alone.** One source worldwide, with no surveys. Rejected
  for the reason 0031 rejected it for NSW: 30 m with canopy, where a region's
  own LiDAR is 1 m.
