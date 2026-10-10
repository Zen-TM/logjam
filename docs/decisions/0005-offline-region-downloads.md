# 0005. Offline region downloads: one queue, the file is the checkpoint

- **Date:** 2026-07-30
- **Status:** Accepted
- **Supersedes:** —

## Context

`src/map/RegionDownloadScreen.tsx` frames an area (edge-handle selector, pure
maths in `regionFrame.ts`), prices it, and enqueues one job per selected map
through `src/offline/regionDownloadQueue.ts`. Enqueue happens on the Save tap and
the naming prompt (a sheet, defaulting to "Region N" from `regionName.ts` — no
geocoding, no coordinates) opens OVER a download already running; the screen
then leaves for the Saved tab's Regions filter, which is where progress is
reported as cards.

Two task kinds share that queue (stage4a §9): `tile-pyramid` fetches SIX raster
tiles straight from the provider into an on-device MBTiles
(`regionTileDownload.ts` + `regionMbtiles.ts`), and `http-file` pulls the
self-hosted Protomaps clip through our API (`regionDownloads.ts`). Both end in a
`map_artifact` row, which is the only thing the map resolver ever sees.

## Decision

**The politeness envelope is not optional** (`regionTileDownload.ts` header):
concurrency 2, a token bucket refilling 3 tiles/s with ±20 % jitter, no
app-identifying headers on a provider request (never `x-logjam-client`, never an
auth token), and an immediate full stop on 403/429 rather than retries. Load
shape, not disguise — do not "optimise" the pace.

**The file is the checkpoint.** A partial MBTiles carries `logjam:build_state`
(plan hash + the 404 gap list) and is never registered as usable; resume diffs
the plan against the tiles present, and unfinished downloads are discovered by
reading the region directory (`listUnfinishedRegions`), not from a progress
table. Don't reintroduce a progress table.

**Metered means expensive, not cellular.** Region downloads answer to the same
rule as every other metered job — `connectionAllowsMetered` in
`networkPolicy.ts`, which reads the platform's `isConnectionExpensive`. A
tethered hotspot is Wi-Fi by type and mobile data by cost. The download screen's
"Use mobile data" row appears on the same answer.

**Nothing large is written without asking whether it fits.** `assertSpaceFor` /
`hasSpaceFor` (`offline/freeSpace.ts`) gate the region clip (after the POST
reports its size), the overlay bundle (from the first progress tick — a
presigned GET URL can't be HEADed), the GeoPDF pyramid (from its plan estimate)
and, via those, both auto-downloaders. There is still **no eviction** anywhere:
nothing reclaims an artifact by age or pressure, which is why the precheck
matters.

**Pause is a tile-pyramid affordance only** (`offline/regionJobStatus.ts`). The
clip is one `expo-file-system` transfer with no mid-flight stop. The same file
owns the "is this run over?" answer Saved's cards read: a job paused by `user` or
`provider-backoff` is *settled* (nothing auto-resumes those, by design) even
though it is not *finished*, so a card never reports work that will never move.

**The offline map is drawn to its own edges.** With "Offline maps only" on (or
no signal), `src/map/offlineMask.ts` fills everywhere outside the downloaded
regions with the page colour, mounted directly above the basemap band. Two
things are load-bearing there: the mask is a MultiPolygon of the COMPLEMENT as
disjoint rectangles, and its `layerIndex` is `1 + basemapLayerCount` — an
offline basemap mounts one raster layer *per region*, all asking for index 1, so
assuming a single basemap layer buries the mask under one of them and it renders
half the screen.

**Every region download also saves the DEM, and that is not optional.** The plan
in `shared/src/mapRegionEstimate.ts` appends a `terrarium` source
(`DEM_SOURCE_ID`) to every run: one flat level at `TERRARIUM.sampleZoom`, priced
into the same size estimate, tile cap and free-space check as the basemaps, and
enqueued as an ordinary `tile-pyramid` job whose `zMin === zMax`. It lands as a
`dem-region` artifact — same group id as the run, so Saved shows it inside the
area's card and deleting the area takes it — which the resolver never draws.
Without it, elevation profiles, point heights and route gain/loss die the moment
the phone loses signal, which is the trip the download exists for. The reader is
`offline/demLookup.ts` (MBTiles → `demPng.ts` → the shared pixel maths), wired
into `useElevationProfile` LOCAL FIRST: saved regions answer, and only a line
nothing on disk covers goes to the API. That also gives a guest elevation, which
the API path never could.

**Size estimates are measured, not guessed.** `shared/src/mapRegionEstimate.ts`
holds per-source, per-zoom tile sizes calibrated by
`shared/scripts/calibrate-basemap-tile-sizes.mjs` (bush AND town samples — a
bush-only calibration read 40 % under for a Katoomba download) plus a measured
7.1 % MBTiles container overhead. Re-run the script and update both together; a
test asserts the range still brackets a real 34-tile download.

## Consequences

- **Positive:** elevation works offline and for a guest; a run outlives the
  screen that started it.
- **Negative:** no eviction — nothing reclaims an artifact by age or pressure.
  The clip cannot be paused mid-flight.
- **Neutral:** Not recorded.

## Alternatives considered

- A progress screen with a Done gate: `RegionDownloadProgressScreen.tsx` was
  deleted (2026-08-16) with its Done gate: a run outlives the screen that
  started it, and a screen whose only job is to be waited on is one the user
  leaves anyway.
- A progress table: the `region_download` table and `downloadMachine.ts` were
  the original plan's version of the checkpoint and were **deleted**
  (2026-08-13): nothing ever installed either — the queue shipped its own
  `RegionJobState` union and `PausedReason` now lives in `regionTileDownload.ts`.
- A world polygon with a hole per region as the offline mask: breaks the moment
  two saved areas overlap.
