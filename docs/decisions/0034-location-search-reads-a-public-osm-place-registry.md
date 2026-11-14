# 0034. Location search reads a public place registry built from OpenStreetMap

- **Date:** 2026-10-17
- **Status:** Accepted
- **Supersedes:** —

## Context

Both clients find towns, peaks and creeks through OpenStreetMap's public
Nominatim service (`shared/src/geocode.ts`). Nominatim's usage policy forbids
search as you type, and allows one request a second for the whole application.
Since #425 a client asks Nominatim only when the user presses "Search
locations for …", which complies but leaves Logjam GPS with no location search
in the field, where there is no signal. Every press also sends the typed text,
often the name of a place the user would rather not publish, to a third party.

Canyoners mostly search unofficial names. The NSW Geographical Names Register
leaves those out; OpenStreetMap often has them (`Claustral Canyon`, tagged
`natural=yes`, with its entry and exit tracks).

Measured on Geofabrik's NSW extract of 2026-10-15 (269 MB) with
`topo/build_place_registry.py`:

| | |
|---|---|
| Named objects kept | 610,000, merged to 321,000 rows |
| File | 4.4 MB gzipped, one column per field |
| Build | 80 s, 1.3 GB peak memory |
| Node, loaded and indexed | 25 MB heap and 8 MB of typed arrays, 0.6 s; resident memory grows about 175 MB, the load's peak, which V8 keeps (updated 2026-11-14: on a made-up file with NSW's row count, 321,000 rows and 16 MB of JSON, node 24, resident memory grew 164 to 171 MB at the peak and 110 to 125 MB once the parse was collected; the real file's settled figure was not measured) |
| A search | 2–5 ms; 36 ms for the worst two-letter query |
| House addresses, if added | 409,000 objects, about 3.5 MB gzipped more |

## Decision

**Location search as you type reads a registry of every named OpenStreetMap
feature in NSW, never a geocoding service.**

- **One ranking.** `searchPlaces` in `shared/src/placeRegistry.ts` is the only
  ranking. The API runs it for Logjam Web and for a phone without the file;
  Logjam GPS runs it on its own copy. A query ranks the same online and
  offline. Guard: `shared/src/placeRegistry.test.ts`, against the fixtures the
  builder writes (`topo/tests/test_place_registry.py`). The API's:
  `api/src/routes/placeSearch.unit.test.ts` answers exactly what
  `searchPlaces` does over that fixture. Logjam GPS's:
  `mobile/src/offline/placeRegistry.test.ts` ("one ranking").
- **What the user types is never logged.** The search endpoint takes the query
  in a `POST` body, never the URL, and no log line carries it. Guard:
  `api/src/routes/placeSearch.unit.test.ts` ("never logs the query") and
  `api/src/lib/logger.unit.test.ts`. Logjam GPS's crash reports drop it:
  `mobile/src/sentry/scrubEvent.test.ts` ("the typed search query").
- **The file is public.** The builder publishes it under
  `PLACE_REGISTRY_PREFIX` (`master/places/v1/`) in the topo bucket, which the
  web distribution serves without authentication, like the DEM
  ([0031](0031-nsw-heights-come-from-the-spatial-services-5m-dem.md)). It holds
  only OpenStreetMap data. A guest fetches it with no call to our API, so
  [0007](0007-guest-mode-is-dont-sync-yet.md) holds without a guest-only path,
  and the public copy is the ODbL's offer of the derived database. It is
  stored gzipped and served with `Content-Encoding: gzip`, so a client's HTTP
  stack decompresses it natively: in JavaScript that took 1.4 s on a Pixel.
  Guard: `topo/tests/test_place_registry.py`. No guard for the serving itself:
  the CloudFront `/master/*` behaviour in `infra/terraform/envs/prod/cloudfront.tf`
  is what serves it.
- **Each format has its own prefix.** A change to the file's shape bumps
  `PLACE_REGISTRY_FORMAT`, and with it the prefix, so a build that only knows
  the old format keeps reading the old one. Guard: `isPlaceRegistryPointer`
  refuses another format (`placeRegistry.test.ts`).
- **Everything named goes in,** unless measuring shows a class adds size and no
  search a canyoner makes. A feature is kept when it has a `name` and one of
  `KIND_KEYS`, and is not in `EXCLUDED`; relations other than multipolygons
  are read through their member ways. Guard: `topo/tests/test_place_registry.py`.
  House addresses carry no name, so they are out: counted separately on the
  same extract (409,000 objects with `addr:housenumber` and no `name`), they
  would add two thirds to the file, OpenStreetMap holds only some of NSW's,
  and Nominatim answers them.
- **A build replaces the last only when it is not much smaller.** `upload`
  writes the data file, then the pointer, and refuses a build under 80 % of
  the current one's size. Guard: `topo/tests/test_place_registry.py`.
- **The build runs monthly as an ECS task on a schedule,** in the topo worker
  image, with a task role that may write only `master/places/*`. No guard: the
  role's IAM policy is what limits it. Roles that write the whole topo bucket
  (the topo worker's, the API's) could still write there.
- **Nominatim stays** behind the explicit press, for street addresses the
  registry leaves out. No guard.
- **Logjam GPS holds the whole file,** fetched with the first region download
  and refreshed on Wi-Fi by default, and a download replaces the stored file
  only once it parses (updated 2026-11-14: one file for each region it keeps,
  fetched with the first region download or, for another region the account
  chose or saved a map over, at the next check). Guards: `mobile/src/offline/placeRegistry.test.ts`,
  and `mobile/src/map/placeSearch.test.ts` for the phone's copy answering
  first and a guest making no API call, and `mobile/src/shellTriggers.test.ts`
  for the refresh being registered for a guest as for a signed-in user
  (updated 2026-10-18).
- **Update 2026-11-14: one registry for each region that declares one.** A
  region's `placeSearch` is the CDN prefix of its registry; NSW's is
  `PLACE_REGISTRY_PREFIX`, and every declared region's prefix carries
  `PLACE_REGISTRY_FORMAT`, so a format bump moves each as above (guard:
  `shared/src/regions.test.ts`, "carries the current registry format, for every
  declared and simulated region"). The API holds one index for each, and
  `POST /places/search` answers from the one its `region` names (the default
  region's when absent, for a build that predates regions). Both clients name
  the region the map shows (`placeRegistryIn`) and, over ground no registry
  covers, offer no registry rows and ask nothing, so the geocoder row alone
  remains. Logjam GPS keeps one copy for each region the account chose or saved
  a map over, and no other: once it asks for the file, each such region gets
  its copy at the next check (app start, foreground, regained signal; Wi-Fi by
  default, never in the background) without a region download of its own, and
  a copy of any other region is deleted at the next check. Sign-out runs that
  check after the chosen regions and saved maps are gone, so the default
  region's copy alone stays, as it did when it was the only one: which regions
  a phone holds would otherwise show where its last user was interested. The
  ranking, the public file, what is never logged and the replacement rule stand
  for each registry. Guards: `shared/src/regions.test.ts` ("placeRegistryIn"),
  `api/src/routes/placeSearch.unit.test.ts` ("answers from the registry of the
  region it names, and the default region's when it names none"),
  `mobile/src/offline/placeRegistry.test.ts` ("keeps each region's copy apart",
  "lets a copy lapse once its region is neither chosen nor saved over" and
  "leaves only the default region's copy at sign-out"),
  `mobile/src/offline/wipeLocalData.test.ts` ("lets the place registries lapse
  after the chosen regions and saved maps are gone") and
  `frontend/src/components/map/MapSearchBox.test.tsx` ("asks no registry over
  ground none covers, and shows no answer from the ground it left"). Everything
  else above stands.

## Consequences

- **Positive:** search as you type on both clients, offline on the phone, with
  nothing typed leaving a phone that has the file, and the unofficial names
  OpenStreetMap holds.
- **Negative:** every phone downloads about 4.4 MB a month (NSW's build; one
  such download for each region it keeps, updated 2026-11-14), and the API
  holds about 35 MB more in memory once loaded (heap and typed arrays on the
  real file, with a peak near 175 MB resident while it loads). For each region
  that declares a registry, plan on its resident cost: 110 to 125 MB once
  loaded and up to 171 MB at the peak, measured on a made-up file with NSW's
  row count (updated 2026-11-14). Results are up to a month stale. The ODbL binds
  us: the "© OpenStreetMap contributors" credit wherever results show, and the
  public copy must stay. A format bump must keep a build of the old format
  publishing for as long as a supported build reads it
  ([0022](0022-mobile-builds-supported-three-months.md)); the builder writes
  one format today.
- **Neutral:** the ranking is a heuristic (`KIND_RANKS`); tune it with the
  fixture test, not in a client.

## Alternatives considered

- **Nominatim as you type:** forbidden by its usage policy.
- **The file behind the authenticated API:** a guest could never fetch it, and
  the ODbL offer would need another public copy anyway.
- **A GitHub Actions cron for the build:** simpler to run, but the right to
  publish to a public CDN path would sit with a role that GitHub workflows can
  assume. An ECS task keeps it with an AWS task role.
- **Public Photon (photon.komoot.io):** built for search as you type, but its
  terms say heavy use is throttled or banned, with no availability guarantee.
- **Self-hosted Photon:** a Java service, OpenSearch and an index to run all
  the time, for a search box.
- **A paid provider** (Stadia Maps, LocationIQ, MapTiler, Geoapify): every
  keystroke goes to a third party, and plans start at about $20–60 a month.
- **The NSW Geographical Names Register:** official names only, and last
  updated in 2016 on data.gov.au.
- **A slice of the registry per downloaded region:** sends a region bbox to our
  server, which no current Logjam GPS build does
  ([0036](0036-the-phone-cuts-its-own-offline-clips.md); updated 2026-10-18),
  and needs a clip endpoint, merging and cleanup.
  The whole state is smaller than most single regions.
- **Bundling the file in app releases, or shipping guests a fixed copy:**
  freshness tied to releases, a bigger app for everyone, and a guest-only path.
- **Refreshes by OTA update:** ties data to signed releases every month
  ([0046](0046-ota-hotfixes-publish-from-ci-on-a-labelled-merge.md)) and ignores the Wi-Fi rule.
- **Postgres trigram search:** it would rank differently from the phone, and
  the in-memory index measured above costs about 35 MB of heap and typed
  arrays (110 to 125 MB resident on the made-up file of the Update below,
  updated 2026-11-14).
- **Diffs between versions:** a diff format, apply logic and a fallback to save
  a few MB a month. Revisit if transfer numbers say it matters.
