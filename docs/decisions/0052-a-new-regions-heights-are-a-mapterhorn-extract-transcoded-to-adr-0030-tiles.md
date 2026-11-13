# 0052. A new region's heights are a Mapterhorn extract, transcoded to ADR 0030 tiles and hosted by Logjam

- **Date:** 2026-11-14
- **Status:** Accepted
- **Supersedes:** —

## Context

[0031](0031-nsw-heights-come-from-the-spatial-services-5m-dem.md) gave NSW its
own height archive, built from one agency's sheets. A second region cannot
repeat that: it would need a fetcher and a warp per country (the
`fetch` and `tile` steps of `topo/build_nsw_dem.py` are the NSW portal's).

[Mapterhorn](https://mapterhorn.com) publishes the world's best open heights
as one tile set per zoom range: `planet.pmtiles` (zoom 0 to 12) and a
`6-x-y.pmtiles` file for each zoom-6 tile with finer data (zoom 13 and up), in
`download_urls.json` on `download.mapterhorn.com`. The tiles are 512 px
terrarium in lossless WebP, and each source's credit is in `attribution.json`.
The pixels are the finest source's own, down to 1 m in New Zealand and the
United States, so a region's heights are a cut of it.

Mapterhorn is not used for NSW. Its Australian source is Geoscience
Australia's 5 m LiDAR composite, which covers part of the state, not the
statewide model that 0031 builds from.

What each reader can decode, checked 2026-11-14 on real Mapterhorn tiles:

- MapLibre and the browser: WebP.
- The API (`api/src/services/elevation.ts`, `canvas`): WebP is refused with
  "Unsupported image type".
- Logjam GPS (`mobile/src/offline/demPng.ts`): PNG only, inflated by hand with
  `fflate`; no Expo module returns pixels.

Transcoding costs bytes: on 12 tiles at zoom 12, 14 and 16 in New Zealand and
Utah the four PNG tiles were 1.36 to 1.58 times the WebP's size, the ratio
[0030](0030-dem-tiles-are-terrarium-png-in-pmtiles.md) measured (34 KB against
23 KB) and accepted.

What Mapterhorn does where a fine survey ends, read on real tiles in New
Zealand's South Island (`topo/build_region_dem.py` over the Makarora valley):

- It writes no no-data. A tile is RGB with no alpha, and no pixel in any tile
  read was the terrarium value for -32768 m. Where it has no data at all it
  has no tile; open sea inside a tile is exactly 0 m.
- Where a fine survey does not cover, the tile is still there, at the same
  zoom, made from the next coarser source: at zoom 16 (1.7 m a pixel) a tile
  on Copernicus GLO-30 is 70 to 80 KB and shows nothing finer than that 30 m source,
  and a tile on the 1 m LiDAR is 130 to 200 KB. The two meet along the
  survey's edge, inside one tile, with no step in height and no marker. Mean
  second difference across a row is 0.016 m on the 30 m side and 0.05 to 0.2 m
  on the 1 m side.

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
  bucket like `nsw-5m`. No client or worker reads `tiles.mapterhorn.com` or
  `download.mapterhorn.com` at run time. The build is the only caller, from a
  host, never from CI, and its requests carry a generic client name.
- **No-data is 0030's.** A pixel Mapterhorn marks as no height (a transparent
  pixel, or the terrarium value for -32768 m) is written as `(0, 0, 0)`. Sea
  stays 0 m, as published.
- **The credit names every source in the box, and says where the ground is
  coarse.** It lists each of Mapterhorn's sources the box draws on (from
  `attribution.json`) with its licence, and, because the archive holds no mark
  of where a fine survey ends, says that the finest heights exist only where
  that survey covers and that the rest is the worldwide 30 m model.
- Guard: `topo/tests/test_region_dem.py` decodes what the builder writes with
  the clients' formula, and checks the quarter addressing, the rounding per
  zoom, the no-data cases and the written archive's zoom range, bounds and
  attribution. No test enforces a credit's wording: it is an argument of the
  build, kept by whoever declares the region.

## Consequences

- **Positive:** a region's heights cost one command and no new reader. The
  result is indistinguishable from an archive `build_nsw_dem.py` made, so the
  sampler, the API, the phone's decoder and every `raster-dem` source take it
  unchanged. The Makarora box (9.6 by 10 km, zoom 17, mostly
  coarse ground) is 77 MB; a box of 1 m ground is about twice that.
- **Negative:** PNG is 1.4 to 1.6 times the WebP, so the planet at zoom 1 to 13
  would be about 500 GB where Mapterhorn's file is 356 GB, and its one-off
  transcode is a large job. Logjam hosts and is responsible for a derived copy
  of other people's data, under each source's licence.
- **Negative:** a region's heights are not one resolution, and nothing in the
  archive says where they are fine. A map or a slope reading near a survey's
  edge changes character with no sign of it.
- **Negative:** Mapterhorn states no terms for range reads of its download
  host. The build makes the traffic `pmtiles extract` makes, and its own data
  page documents that. If the host refuses, the build moves to Mapterhorn's
  published source tarballs.
- **Neutral:** NSW stays on 0031. Heights are as each source publishes them,
  on its own vertical datum, with no conversion.
- **Later work:** `slope` and `contours` in `topo/build_nsw_dem.py` read an
  archive of NSW's zooms only; a region's need them to take any heights
  archive.

## Alternatives considered

- **Read Mapterhorn's tile endpoint from the clients.** Nothing to host. It
  states no terms, it logs each reader's address and referrer, and a map view
  would send where a user is looking to a third party. Logjam GPS cuts its
  offline clips from Logjam's own archives for the same reason
  ([0036](0036-the-phone-cuts-its-own-offline-clips.md)).
- **Teach the readers WebP.** No transcode and a third smaller. It needs an
  image dependency in the API, a native decoder or a second hand-written
  codec on the phone, a tile size per source through `resolveDemSamples`, a
  second zoom convention in every `raster-dem` source, and new byte estimates
  for offline saves. The cost of transcoding is bytes on a server; the cost of
  this is code in three runtimes. Revisit only if those bytes matter.
- **A national pipeline per country, as NSW has.** Finer where an agency has
  a model Mapterhorn lacks, as in NSW. A fetcher and a warp for each, and no
  region this run has such a source.
- **Copernicus GLO-30 alone.** One source worldwide, with no surveys. Rejected
  for the reason 0031 rejected it for NSW: 30 m with canopy, where a region's
  own LiDAR is 1 m.
