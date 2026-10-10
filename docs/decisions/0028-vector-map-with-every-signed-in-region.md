# 0028. A signed-in region save always includes the vector map; a guest's never does

- **Date:** 2026-10-10
- **Status:** Accepted
- **Supersedes:** —

## Context

A saved region ([0005](0005-offline-region-downloads.md)) held whichever maps
the user picked on `src/map/RegionDownloadScreen.tsx`. The vector map was one
chip among four, and the only one that is not a raster: it is a clip of our own
Protomaps archive, cut by `POST /basemap/region-clip` (`routes/basemap.ts`) for
the framed bbox and fetched once through a short-lived token
(`offline/regionDownloads.ts`).

On the 2026-10-09 trip the maintainer found that things stop working in the
field when that chip was not picked, with nothing on the screen to say why:

- The route and measure tools snap to tracks and creeks by reading the clip's
  `.pmtiles` file (`map/snapLines.ts`). Outside a saved clip, with no signal,
  they draw a straight line.
- The Vector map is blank outside a saved clip.

Nobody choosing between "Topo" and "Vector" at home can know that the second
one also decides whether a tool works three days later.

The clip is small next to what the user already downloads. Measured on
2026-10-09 with `pmtiles extract` against the NSW archive, at full detail
(z15), in MB:

| Area | 5 km box | 10 km | 20 km | 40 km |
|---|---:|---:|---:|---:|
| Wollangambe (bush) | 0.7 | 0.8 | 1.4 | 4.6 |
| Kanangra (bush) | 0.7 | 0.8 | 1.1 | 2.3 |
| Katoomba (town and bush) | 2.1 | 2.4 | 3.9 | 7.3 |
| Sydney CBD (worst case) | 3.6 | 8.0 | 14.9 | 32.5 |

One raster source for the same boxes at the default detail (z16), from
`shared/src/mapRegionEstimate.ts`: 3.6, 11.0 and 42.6 MB, and the 40 km box is
over the tile cap. In the bush the clip is 3 to 20 % of one raster, about the
size of the DEM that 0005 already adds to every region, and it is one request
that takes seconds where a raster takes minutes.

What it costs is privacy. The raster tiles and the DEM go from the provider to
the phone, and the framed area never reaches Logjam. The clip is the one part
of a region download that tells our API where the area is.

## Decision

**Every region a signed-in user saves includes the vector clip, unasked, and
there is no control to leave it out.** `vectorClipFor` in
`offline/regionTilePlanning.ts` is the one place that decides; the Vector chip
is gone from `RegionDownloadScreen.tsx`, and a save with no raster picked is
the vector map plus the DEM. Guard: `regionTilePlanning.test.ts`
("vectorClipFor").

**A guest's save never includes it and makes no request to Logjam.** The clip
endpoint is authenticated, and a guest syncs nothing
([0007](0007-guest-mode-is-dont-sync-yet.md)). The same guard test fails if a
guest is given the clip.

**The clip is always cut at full detail**, `catalogMaxZoom("protomaps")` (z15),
whatever the detail rail says. The rail prices rasters, where one zoom level
is a factor of four in megabytes and minutes. For the clip the saving is small
(a 40 km bush box is 4.6 MB at z15 and 1.8 MB at z13), and a lower zoom drops
the minor tracks the snapping exists for.

**Over `MAX_REGION_AREA_KM2` (1600 km², a 40 km square) the rasters save
without the clip, and the screen says so before the Save tap.** The endpoint
refuses a larger bbox (`MAX_CLIP_AREA_KM2` in `lib/regionClip.ts`, the same
constant), so the client does not ask. A failed clip never fails the region:
the rest saves and the card reports one map that did not finish.

**The bbox goes to the API in the request body and nowhere else.** This rule
predates this ADR and now carries more weight: the body is redacted from logs
(`redactPaths` in `lib/logger.ts`), the bbox is never put in a URL, a filename
or an error message, the token in the GET URL is a random UUID, and the
clipped file is deleted when it has been sent or after 120 s
(`CLIP_TOKEN_TTL_MS`). `lib/logger.unit.test.ts` builds its logger from the
same `redactPaths`, but no test names the bbox fields, and none covers the
URL, filename and error-message parts.

## Consequences

- **Positive:** snapping and the Vector map work in every area a signed-in
  user saved, with nothing to remember at home. The screen has one choice
  fewer.
- **Negative:** the bbox of every area a signed-in user saves now reaches our
  API. Before, only an area saved with the Vector chip did. The API does not
  log the bbox, but the request log does record that a clip was asked for,
  when, and how many bytes came back, and the server process sees the bbox for
  the length of the request. A user who wants an area kept from Logjam
  entirely can now only get that by saving it as a guest.
- **Negative:** `regionClipLimiter` (`middleware/rateLimit.ts`) allows 10 clips
  an hour per user, and every save now spends one. The eleventh save in an
  hour keeps its rasters and reports the vector map as not finished.
- **Negative:** region saves now depend on the clip endpoint working in prod.
  When this was decided it did not: prod returned 502 for every clip, because
  `pmtiles extract` was handed an `s3://` URI it reads as a local path. That
  fix is a separate change and has to be deployed before a build with this
  one ships, or every signed-in save reports a failed map.
- **Negative:** a signed-in user cannot skip the clip to save space or data.
  In a city that is up to about 30 MB per area.
- **Neutral:** an area saved before this change keeps whatever it was saved
  with. Nothing backfills the clip.

## Alternatives considered

- **Keep the Vector chip, opt-in as it was, and have the route and measure
  tools say when they have no snapping data.** Still reasonable: it keeps the
  bbox on the phone unless the user chooses otherwise, which is the stricter
  reading of "privacy constrains every feature", and the warning makes the
  missing data visible. Rejected because the warning arrives in the field,
  with no signal and no way to act on it, and the choice at home is not an
  informed one: the chip reads as "which map do I want to look at". The
  privacy it protects is from our own API, which already holds a signed-in
  user's places with their coordinates.
- **Keep the chip but pre-select it for signed-in users.** The smallest
  change, and the user could still untick it. Rejected: it leaves a control
  whose off position silently breaks a tool, to save a megabyte or two.
- **Let the detail rail set the clip's zoom, as it did.** Rejected under
  Decision: a small saving, and a lower zoom drops the tracks snapping needs.
