# 0036. Logjam GPS cuts every offline clip itself, from the public archives, for guests too

- **Date:** 2026-10-18
- **Status:** Accepted
- **Supersedes:** [0029](0029-vector-map-with-every-signed-in-region.md)

## Context

A saved region ([0005](0005-offline-region-downloads.md)) holds the rasters the
user picked, the worldwide DEM tiles, and three clips of archives Logjam builds:
the vector basemap, each DEM archive the area touches (`planDemDownload` in
`shared/src/mapRegionEstimate.ts`, [0031](0031-nsw-heights-come-from-the-spatial-services-5m-dem.md))
and the statewide contours (`shared/src/nswContours.ts`). Under
[0029](0029-vector-map-with-every-signed-in-region.md) the API cut all three:
`POST /basemap/region-clip` (`api/src/routes/basemap.ts`) ran `pmtiles extract`
for the bbox and the phone fetched the file through a short-lived token. The
endpoint is authenticated, so a guest saved none of them, and offline a guest
got a blank Vector map, straight-line snapping, no contours, and heights from
the worldwide tiles only (up to 280 m out on a valley floor, 0031).

The four archives are already public. The web distribution serves them under
`/master/*` (`infra/terraform/envs/prod/cloudfront.tf`) with no
authentication, and Logjam GPS reads them by byte range online, guest or
signed in: the Vector map (`map/sourceResolver.ts`), snapping
(`map/snapLines.ts`) and heights (`offline/demLookup.ts`). What a guest lacked
was only the offline copy, and that copy is a set of byte ranges of the same
files.

What changed from 0029: its guest clause ("a guest's save never includes it")
and its bbox clause ("the bbox goes to the API in the request body") are
replaced. Its full-detail and area-cap rules stand and are restated here.

Measured on 2026-10-18 against local copies of the archives (the NSW Protomaps
archive, and the 5 m DEM and contour archives of the Blue Mountains sheets
built so far, which hold only part of the Wollangambe box), for 40 km boxes,
each a whole save's clip of that archive. Requests and bytes read count the
header, metadata and leaf directories too. Time is modelled as one round trip
per request plus the bytes at the link's rate:

| Box, archive | Clip | Requests | Bytes read | 4G, 10 Mb/s, 60 ms | 3G, 1 Mb/s, 300 ms |
|---|---:|---:|---:|---:|---:|
| Wollangambe, vector | 4.6 MB | 44 | 5.2 MB | 7 s | 54 s |
| Wollangambe, 5 m DEM | 20.5 MB | 13 | 20.5 MB | 17 s | 168 s |
| Wollangambe, contours | 8.1 MB | 13 | 8.3 MB | 7 s | 70 s |
| Katoomba, vector | 7.3 MB | 59 | 8.2 MB | 10 s | 83 s |
| Katoomba, 5 m DEM | 56.4 MB | 45 | 56.6 MB | 48 s | 466 s |
| Katoomba, contours | 24.4 MB | 27 | 24.8 MB | 21 s | 206 s |
| Sydney CBD, vector | 32.5 MB | 56 | 33.3 MB | 30 s | 283 s |

Each clip's tile set, tile bytes and header matched `pmtiles extract`'s
(go-pmtiles v1.31.2, the version `shared/scripts/pmtiles-extract-fixture.mjs`
names) for the same box. The
clips are the same files the API sent, so a save costs the phone the same
bytes as before, plus the gaps it reads through.

## Decision

**Every region a user saves on Logjam GPS, guest or signed in, includes a clip
of the vector map, of each DEM archive the area touches and of the statewide
contours, and the phone cuts each one itself** from the public archive on the
CDN. `regionClipSpecs` in `mobile/src/offline/regionTilePlanning.ts` is the
one place that lists them, with no account check and no control to leave one
out; a save with no raster picked is the vector map, the DEMs and the
contours. Guard: `regionTilePlanning.test.ts` ("regionClipSpecs").

**A save makes no request to Logjam's API, and the bbox never reaches it.**
`runRegionClip` in `mobile/src/offline/regionDownloads.ts` asks the CDN for
byte ranges of the archive, with no header but `range`: no token, no client
id. Nothing logs the bbox or an offset, and a failure's text carries neither.
Guard: `regionDownloads.test.ts` ("cuts the clip from the CDN, asking for
nothing but byte ranges", and "picks up where a failed run stopped, and says
nothing about where").

**The cut is `pmtiles extract`'s, in `shared/src/pmtilesExtract.ts`**
(`planExtract`, `fetchExtractRequest`): for a bbox and a zoom range, the same
tile set, tile bytes and header as go-pmtiles v1.31.2, in the same layout
(header, root, metadata, leaves, tile data). Only the directories' gzip bytes
differ. Guard: `pmtilesExtract.test.ts`, against go-pmtiles' own extracts of
a made-up fixture that `shared/scripts/pmtiles-extract-fixture.mjs`
regenerates.

**Requests are coalesced and bounded.** Runs of wanted tiles less than
`EXTRACT_MERGE_GAP_BYTES` (64 KiB) apart are one request that reads through
the gap; it was the quickest gap on both modelled links in every box above,
for at most 12 % extra bytes. No request is larger than
`EXTRACT_MAX_REQUEST_BYTES` (4 MiB), and each response is written to the file
as it arrives, so the phone holds one response at a time (and, for a request
that reads through gaps, a copy of the bytes it keeps).
Guard: `pmtilesExtract.test.ts` ("coalesces runs across small gaps, and caps
a request's size").

**The file is the checkpoint, as in 0005.** The directories are written
first. A partial file whose first bytes are what a replanned clip would write
picks up at the first request it does not hold all of; any other partial file
is cut again from the start. The connection is checked before every request,
so a Wi-Fi-only clip parks when Wi-Fi drops rather than carrying on over
mobile data, and a dropped connection parks the job for the queue's
reconnect. Stop aborts the request in flight and deletes the file; Pause is
still not offered on a clip (0005). Each range is retried on its own, up to
three times, so one failed directory read does not restart the plan. While a
range is in flight the run reports progress every 30 s: the download's
foreground notice renews its CPU lock only on a report, and the lock lapses
after 3 minutes, less than a 4 MiB range takes on a weak link. Guards:
`regionDownloads.test.ts` ("picks up where a failed run stopped", "stops for
a connection it may not use", "waits for a connection that drops mid-clip",
"stays cancelled when Stop comes during a failing request", "aborts the
request in flight on Stop", "retries a failed read on its own, not the whole
plan", "keeps the download alive through a slow request"),
`pmtilesExtract.test.ts` ("plans the same bytes again later"). A clip the app was killed during is still deleted on the
next Saved open (`sweepOrphanFiles`), as before.

**The vector clip is always cut at full detail**, the archive's own deepest
zoom (z15), whatever the detail rail says. The rail prices rasters, and a
lower zoom drops the minor tracks snapping follows. A DEM's clip is its
`sampleZoom`, except the NSW 5 m one, which runs from z8 (`demClipMinZoom`;
updated 2026-10-24), and the contours' their `minzoom` to `maxzoom`. Guard:
`regionDownloads.test.ts` ("cuts the nsw-5m height clip from z8, not from the
sampler's z15").

**No area larger than `MAX_REGION_AREA_KM2` (1600 km², a 40 km square) can be
saved, by anyone, whatever maps are picked.** `checkRegionCaps` in
`shared/src/mapRegionEstimate.ts` refuses it on the save screen (guard:
`mapRegionEstimate.test.ts`, "rejects an area over MAX_REGION_AREA_KM2
whatever is being saved"). The cap now
bounds what a save costs the phone: about 160 MB and 185 requests for the four
clips of 40 km of mountains (updated 2026-10-23: the three above, plus the
slope clip below).

**A clip that fails never fails the region.** The rest saves and the card
reports one map that did not finish. A DEM or contour archive the CDN does not
have (403 or 404: not built yet) leaves that clip out of the run unreported,
since the worldwide heights and the basemap still save. A host that ignores
or refuses ranges (200, 416) fails the clip as `source-unavailable`; any
other status, a 5xx or a 429, is retried, then fails as one Resume can
retry. Guard: `regionDownloads.test.ts` ("leaves out a DEM or contour archive
the CDN lacks, and only that").

**`POST /basemap/region-clip` stays, unchanged, while a Logjam GPS build that
calls it is supported** ([0022](0022-mobile-builds-supported-three-months.md)).
What 0029 set for it holds: the bbox only in the request body, redacted from
logs (guard: `api/src/lib/logger.unit.test.ts`, "the region clip's bbox"),
never in a URL, a filename or an error; the clip deleted when sent or after
120 s (`CLIP_TOKEN_TTL_MS`); 60 clips an hour per user
(`REGION_CLIPS_PER_HOUR`, guard `api/src/middleware/rateLimit.unit.test.ts`).
Nothing new calls it.

- **Update 2026-10-18: the endpoint is gone (#510).** `POST /basemap/region-clip`
  and what existed only for it (`regionClip.ts`, `regionClipLimiter` and its
  test, the bbox redaction paths and their test, the `pmtiles` binary in `api/Dockerfile`,
  `PROTOMAPS_ARCHIVE_URI` from the API and its environment (updated
  2026-10-18)) are removed, so the API has no route that takes a saved area's
  bounds. What held it up was a supported Logjam GPS build that calls it
  ([0022](0022-mobile-builds-supported-three-months.md)), and there is none.
  0022 dates support by a release event, a `mobile-vX.Y.Z` tag or a Play
  Store release, and no Logjam GPS build has either, so none is a supported
  build in its sense. The only build that calls the endpoint is the
  maintainer's own pre-phone-cut build, which saves an area without its vector,
  DEM and contour clips until they rebuild it; they accept that. The first
  release will include the phone-cut clips, so no released build ever calls it. The area cap
  stays in `shared/`, for the phone. The paragraph above and the guards it names
  no longer apply. Everything else above stands.
- **Update 2026-10-23: every saved area also clips the statewide slope**
  (`NSW_SLOPE` in `shared/src/terrain.ts`), so Logjam GPS draws the Terrain
  group's Slope offline. It is a fourth entry in `regionClipSpecs`, cut the
  same way, at the archive's own zooms (z8 to z15), and filed as
  `slope-region`. A slope archive the CDN lacks is left out like a DEM or
  contour one. Guards: `regionTilePlanning.test.ts` ("regionClipSpecs"),
  `regionDownloads.test.ts` ("leaves out a DEM or contour archive the CDN
  lacks, and only that", which covers the slope too, and "files a slope clip
  as the DEM the map colours"). A 40 km Katoomba box's slope clip, planned
  with `planExtract` from a local copy of the Katoomba sheet's slope, is
  64 MB in 53 requests, and `SLOPE_TILE_BYTES` in
  `shared/src/mapRegionEstimate.ts` prices the statewide archive's at about
  71 MB.
- **Update 2026-10-24: the NSW 5 m height clip is cut from z8 to z15, so
  Logjam GPS draws the Terrain group's Hillshade offline.** MapLibre shades the
  height archive itself, and a z15-only clip would shade only close in, so
  `clipArchiveFor` cuts `nsw-5m` from `demClipMinZoom` (z8); the sampler still
  reads z15 alone ([0028](0028-a-height-comes-from-the-finest-dem-source-that-has-it.md)),
  and the worldwide terrarium clip is unchanged. `planRegionForBasemaps` prices
  every zoom of it, about three and a half times the z15 bytes of the same box
  (1.2 MB against 0.33 MB for a 24-tile Katoomba Falls box). A clip saved before
  this holds z15 alone: `holdsHillshade` (`mobile/src/map/sourceResolver.ts`)
  refuses it, so that area's Hillshade switch still says "Needs a connection"
  until it is saved again, and there is no migration. Guards:
  `regionDownloads.test.ts` ("cuts the nsw-5m height clip from z8, not from the
  sampler's z15"), `mapRegionEstimate.test.ts` ("prices the height clip at
  every zoom the hillshade is drawn at"), `sourceResolver.test.ts`
  ("holdsHillshade", "a clip saved at z15 alone gives no shade"). Everything
  else above stands.
- **Update 2026-10-24: a signed-in save also keeps the account's sharpened
  areas it reaches ([0040](0040-a-sharpened-area-is-a-private-dem-source.md)),
  cut on the phone from their private archives.** For each area the box
  reaches, the save cuts the area's heights, slope and contours over the part
  of it the box covers, widened to whole z14 tiles (`areaClipSpecs` in
  `mobile/src/offline/sharpenedClips.ts`). The save screen asks the API for
  the account's list (`GET /topo-jobs/completed-overlays`), which sends no
  bbox. Each clip is cut through the presigned URL the list gave, by byte
  range with no header but `range`, from the bucket instead of the CDN, and
  filed under the area's source id, `lidar-<id>`. A guest has no areas, so
  their save is unchanged. A presigned URL expires after 24 h, so a clip
  resumed after that fails with "source unavailable" and is saved again from
  the save screen. Offline, the map routes the area clips over the statewide
  clips one archive per tile as it does online, the sampler reads an area's
  heights first, and the account's last list (without its URLs) is kept so
  they know the areas (`offline/sharpenedAreaStore.ts`). Guards:
  `regionDownloads.test.ts` ("cuts a sharpened area's clip through its
  presigned URL, filed under the area"), `sharpenedClips.test.ts`,
  `sourceResolver.test.ts` ("routes saved areas offline"),
  `demLookup.test.ts` ("reads a saved clip of a sharpened area before the
  statewide one"). What holds the decision up still holds: the phone cuts
  every clip, and the bbox never reaches the API. Everything else above
  stands.

## Consequences

- **Positive:** offline, a guest's saved area has what a signed-in user's has:
  the Vector map, snapping to tracks and creeks, 5 m heights and contours. The
  area a user saves never reaches our API, signed in or not. A save no longer
  costs the API a `pmtiles` process, a temporary file of up to 80 MB and the
  egress, and no longer fails when the API does.
- **Negative:** the CDN sees which byte ranges a phone reads, and anyone with
  the archive can map ranges back to an area. That was already true of the
  Vector map, snapping and heights online, the requests carry no account, and
  the web distribution keeps no access logs (`cloudfront.tf` has no
  `logging_config`). An operator who turns those logs on starts recording it.
- **Negative:** a save is about 10 to 60 requests per clip where it was two,
  and reads up to 12 % more bytes than it keeps. The web distribution's WAF
  (`web_acl_id` in `cloudfront.tf`, not managed in Terraform) has no rate
  rule, only AWS's managed groups, as read in prod on 2026-10-18; a rate rule
  added later would have to allow a save's burst. Its common rule set refuses
  a request with no User-Agent, so the range requests keep the platform's
  default (OkHttp's on Android): a header removed there would fail every
  clip. No guard: only the device check shows it.
- **Negative:** the `/master/*` behaviour caches nothing (`max_ttl = 0`), so
  every range is an S3 GET. At about 185 per save (updated 2026-10-23) that is
  a fraction of a cent.
- **Negative (updated 2026-10-18):** there were two ways to cut a clip until
  the endpoint went. It is removed (#510), with the API image's `pmtiles`
  binary and `PROTOMAPS_ARCHIVE_URI`, so there is one way now.
- **Negative:** a guest now downloads the DEM, contour and slope clips too, up
  to about 150 MB more per mountain area than before (updated 2026-10-23).
- **Neutral:** an area saved before this change keeps what it was saved with.
  Nothing backfills the clips.

## Alternatives considered

- **Make `POST /basemap/region-clip` public, so a guest can call it.** The
  smallest change. Rejected: every call is a process, a temporary file of up
  to 80 MB and API egress; a limit for anonymous callers can only key on IP;
  and it sends a guest's bbox to our API, the one thing guest mode still kept
  from Logjam under 0029.
- **Cut on the phone for guests only, and keep the endpoint for signed-in
  users.** Rejected: a guest-only path ([0007](0007-guest-mode-is-dont-sync-yet.md)),
  two implementations to keep in step, and a signed-in user's bbox would still
  reach the API for no gain.
- **Merge each area into the statewide slope and contour clips**, one file
  a layer holding each tile from the archive `terrainTileArchive` picks, so
  the map draws one clip with no routing. Rejected for the update of
  2026-10-24: a tile past an area's deepest zoom, outside it, would be missing
  from the merged file, and MapLibre Native's drawing of the parent for a
  missing tile is unverified, where the routed sources are what Logjam GPS
  already draws online.
- **Fetch the clip tile by tile (`PMTiles.getZxy`).** No merging or writer
  needed. Rejected: a 40 km box at z15 is about 2,000 tiles, so 2,000 requests
  for the vector map alone, and the result still has to be written as an
  archive.
- **go-pmtiles' own range merging, a budget of extra bytes spent on the
  smallest gaps first.** It can reach fewer requests for the same waste.
  Rejected: its requests come out of output order, so the phone could no
  longer append each response to the file, and a partial file would not be a
  prefix to resume from.
