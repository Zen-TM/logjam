# 0052. A new region's heights are a Mapterhorn extract, transcoded to ADR 0030 tiles and hosted by Logjam

- **Date:** 2026-11-14
- **Status:** Accepted
- **Supersedes:** —

## Context

[0031](0031-nsw-heights-come-from-the-spatial-services-5m-dem.md) gave NSW its
own height archive, built from one agency's sheets. A second region cannot
repeat that: it would need a fetcher and a warp per country (the `fetch` and
`tile` steps of `topo/build_nsw_dem.py` are the NSW portal's).

[Mapterhorn](https://mapterhorn.com) publishes open heights for the world as
one tile set per zoom range: `planet.pmtiles` (zoom 0 to 12) and a
`6-x-y.pmtiles` file for each zoom-6 tile with finer data (zoom 13 and up), in
`download_urls.json` on `download.mapterhorn.com`. The tiles are 512 px
terrarium in lossless WebP. Its `attribution.json`, read on 2026-11-14, names
each source and licence, and lists 1 m sources in New Zealand (`nz`, LINZ) and
the United States (`us1*`, USGS 3DEP).

NSW stays on 0031. Mapterhorn's Australian source (`au5a` to `au5i` in the same
file) is Geoscience Australia's 5 m LiDAR-derived DEM, which the
maintainer established on 2026-11-14 is a partial composite, not the statewide
model 0031 builds from.

The readers cannot take Mapterhorn's tiles as published: the API's `canvas`
refuses WebP ("Unsupported image type", run against a real tile on 2026-11-14),
and Logjam GPS inflates PNG by hand with `fflate`
(`mobile/src/offline/demPng.ts`) and has no WebP decoder.

## Decision

- **A region's heights are a Mapterhorn extract.** `topo/build_region_dem.py
  heights` reads Mapterhorn's files by byte range over a box and writes one
  archive in the form of
  [0030](0030-dem-tiles-are-terrarium-png-in-pmtiles.md): terrarium PNG, 256 px,
  in PMTiles, each coarser zoom the mean of the heights below it.
- **Converted once, at build time.** Each 512 px WebP tile at zoom z becomes
  four 256 px PNG tiles at z + 1. The pixels line up, so nothing is resampled.
  No reader learns WebP, and `DEM_TILE_SIZE` stays 256. A pixel Mapterhorn marks
  as no height (a transparent pixel, or the terrarium value for -32768 m) is
  written as 0030's no-data, `(0, 0, 0)`.
- **Rounding.** A region's archive is rounded as a sharpened area's is, as
  0030's update of the same date says. Guard: `TestRounding` in
  `topo/tests/test_region_dem.py`.
- **Hosted by Logjam.** The archive is built once and served from Logjam's own
  bucket like `nsw-5m`. No client or API code reads `tiles.mapterhorn.com` or
  `download.mapterhorn.com`. The build is the only caller, from a host, never
  from CI, and its requests carry a generic client name (`USER_AGENT` in
  `topo/build_region_dem.py`).
- **The credit** names the sources the author can show the box draws on, from
  Mapterhorn's `attribution.json` and its coverage, with each licence. It says
  that the finest heights exist only where the finest survey covers, because the
  tiles do not mark a survey's edge: where a survey ends, a tile of the same
  zoom is made from a coarser source, so a credit must not claim the finest
  resolution for a whole box.
- **Guards.** `topo/tests/test_region_dem.py` decodes what the builder writes
  (with `decode_terrarium`, which `test_nsw_dem.py` holds equal to the clients'
  formula), and checks the quarter addressing, the rounding per zoom, the
  no-data cases, the range reads (a short or dropped reply, a 429's
  `Retry-After`, a reply that is not the range asked for), that a source that
  cannot be opened stops the run, and the written archive's zoom range, bounds
  and attribution. In the same file `TestMapterhornIsOnlyTheBuildsToRead`
  holds that no file under `shared/src`, `frontend/src`, `mobile/src` or
  `api/src` names `mapterhorn.com` (with a floor on the files scanned) and that
  `USER_AGENT` names no project or person. No check holds "the build never runs
  from CI", that `topo/`'s other workers do not read Mapterhorn, or the wording
  of a credit, which is an argument of the build: review holds them.

## Consequences

- **Positive:** a region's heights cost one command and no new reader. The
  archive has the format of one `build_nsw_dem.py` made, so the sampler, the
  API, the phone's decoder and every `raster-dem` source should take it
  unchanged; no client was run against one in this change.
- **Negative:** PNG is bigger than the WebP: 0030 measured 34 KB against 23 KB
  on rugged ground and 4.7 KB against 2.7 KB on flat ground (it says about a
  third larger), and accepted it. This change did not measure the ratio again. At that
  ratio the planet at zoom 1 to 13 would be about 500 GB (an estimate), where
  Mapterhorn's `planet.pmtiles` is 355.6 GB (its size in `download_urls.json`,
  read 2026-11-14), and its one-off transcode is a large job. Logjam hosts and is
  responsible for a derived copy of other people's data, under each source's
  licence.
- **Negative:** a region's heights are not one resolution, and nothing in the
  archive says where they are fine. A map or a slope reading near a survey's
  edge changes character with no sign of it.
- **Negative:** Mapterhorn states no terms we found for range reads of its
  download host. The build makes the traffic `pmtiles extract` makes, which its
  data page documents, as read when this was planned. If the host refuses, the
  build moves to Mapterhorn's published source tarballs (`attribution.json` has
  their URLs).
- **Neutral:** Logjam's build applies no vertical datum conversion. Whether
  Mapterhorn converted its sources to one datum was not examined.
- **Later work:** `slope` and `contours` in `topo/build_nsw_dem.py` read an
  archive of NSW's zooms only; a region's need them to take any heights
  archive.

## Alternatives considered

- **Read Mapterhorn's tile endpoint from the clients.** Nothing to host. It
  states no terms we found, is understood to log each reader's address and
  referrer (not verified here), and a map view would send where a user is
  looking to a third party. Logjam GPS cuts its offline clips from Logjam's own
  archives, as [0036](0036-the-phone-cuts-its-own-offline-clips.md) does:
  requests stay on Logjam's own CDN.
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
