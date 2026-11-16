# Adding a region

A region is a place Logjam has maps, terrain and a canyon list for. New South
Wales (NSW) is the only one in prod. This is the checklist for adding another:
what to build, what to declare, and what outside the code has to change with it.
The reasoning is in [0049](../decisions/0049-what-a-map-offers-follows-the-ground-it-shows-and-an-accounts-chosen-regions-only-set-defaults.md).

A region is one declaration in `shared/src/regions.ts`. Nothing else names one:
a client, the API and the worker read the declaration, and
`shared/src/regionNeutral.test.ts` fails on a source file that names NSW's
constants or a simulated region. So adding a region changes no map, switch or
search code. If a step below seems to need that, the code is wrong; fix it
before adding the region.

Two parts are the maintainer's: publishing an archive to the topo bucket and
shipping a build or a consent change reach prod, and nothing here does either.
Never run an `aws` command from this page without their say-so.

## What shows once a second region is in prod

With one region the region step and Settings' region list are hidden
(`offersRegionChoice`). With two they appear for every account, and "Not
available here" shows on a Terrain layer whose data the region in view lacks.
Tell the maintainer before the second region merges.

## 1. Decide what the region has

Every layer is optional. A region declares only the archives it has, and a layer
it lacks is absent from `terrain`, so the map says "Not available here" there.

| Declared | What it is | Built by |
|---|---|---|
| `terrain.heights`, `dem` | the heights the other archives are cut from, and the sampler's source | `topo/build_nsw_dem.py` ([README](../../topo/README.md#building-the-nsw-5-m-dem-archive)) |
| `terrain.slope`, `terrain.hillshade`, `terrain.contours` | cut from the heights | the same script |
| `terrain.land` | land tenure classes | `topo/build_land_tenure.py` |
| `terrain.fire` | fire history | `topo/build_fire_history.py` |
| `terrain.coverage` | mobile coverage by carrier | `topo/build_coverage.py` |
| `vector` | the region's cut of the vector basemap | no script in the repo |
| `placeSearch` | the place registry's CDN prefix | `topo/build_place_registry.py` |
| `gauges` | the river gauge feed's CDN prefix | `topo/build_gauges.py` |
| `canyons` | where the canyon-list import reads from | a RopeWiki region and a snapshot in the media bucket |

The scripts are NSW's: they read NSW's sources. A region's archives are the same
formats built from its own sources, so each needs the script adapted, or a new
one, and a licence check on its data. Keep the credit the licence asks for in
the archive's `credit` and `creditHtml`.

## 2. Build and publish the archives

Archive paths follow `master/<kind>/<region>-…`. NSW's older paths
(`master/dem/nsw-5m.pmtiles`, `master/places/v1/`) stay as they are, because
phones hold them (`shared/src/regions.ts`' header; guard: `regions.test.ts`,
"keeps NSW's stored ids and paths"). Each layer's README section ends with its
publish command. Publishing is a prod change and the maintainer's to make.

Each archive also needs `tileBytes`: the mean and the 90th percentile of a
stored tile at every zoom a save clips. An offline save is priced from them
(`mapRegionEstimate.ts`). Measure them on the built archive, from real clips of
rugged ground, since people save rugged ground: the comment on `NSW_HEIGHTS` in
`regions.ts` says how NSW's were taken. The simulated regions' figures are
placeholders, and a placeholder passes the tests while pricing a save wrongly.
Guard: `mapRegionEstimate.test.ts` ("holds figures for every zoom a save
clips").

## 3. Declare the region

In `shared/src/regions.ts`, copy the shape of `NSW_REGION` and add the new
constant to `REGIONS`.

- `id`: lower-case letters and digits, and never changed once shipped: it is
  stored in accounts' preferences and in every map layer id. Archive ids are
  unique across regions (`regions.test.ts`, "gives every terrain archive an id no
  other has, across every region").
- `borders`: one ring for each island or separate piece, drawn a little outside
  the real border. A box would overlap a neighbour's.
- `basemaps` and `defaultBasemap`: ids in `BASEMAP_CATALOG`, each listed by one
  region at most (section 4). The vector basemap is never listed here: `vector`
  declares it.
- `view`, `timeZone`, `name` and `fullName` (through `t`, as NSW's are).
- `grid` is one of `GridId` (`shared/src/grids.ts`). A region on another
  coordinate grid needs the type and the map-grid code widened first.

Then run the declaration's tests:

```
cd shared && npm test -- src/regions.test.ts src/regionNeutral.test.ts src/demSources.test.ts src/mapRegionEstimate.test.ts
```

Four topo tests read `regions.ts` by pattern, so run them too if you touched
the Land, Fire or Coverage archives or the heights:

```
cd topo && python -m unittest discover -s tests
```

Use the Python version CI does (`python-version` in the `topo` job of
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)), after
`pip install -r requirements-test.txt`; [topo/AGENTS.md](../../topo/AGENTS.md) says how the
suite runs.

To see the region on screen before any archive exists, switch on the simulated
regions ([README](../../README.md)): they exercise every place-aware path the
same way.

## 4. Basemaps

A provider is a `BASEMAP_CATALOG` entry in `shared/src/geoPdfBaseLayers.ts`,
listed in one region's `basemaps` (a provider with no region, like OpenStreetMap,
is worldwide).

- `offlineCapable` and `printable` follow the provider's tile terms, not its
  licence: say in the entry's comment which clause allows it.
- A raster entry that can be saved needs measured `tileBytes`. Run `node
  shared/scripts/calibrate-basemap-tile-sizes.mjs` against the live provider and
  copy its figures in, as the SIX entries' comment describes.
- `printsContours` and `photo` stop the map drawing contours or a hillshade over
  a sheet that has its own (`contourRules.test.ts`).

## 5. Each new provider

A provider is any new host a client contacts: a basemap, an archive's CDN, a
geocoder. Three changes go with it.

**The content security policy, in three places.** Logjam Web may only load from
hosts its policy lists. Add the host to `img-src` and `connect-src` in
`CSP_PROD` (`frontend/vite.config.ts`) and to `cspAllowlist` in
`scripts/csp-policy.json`. `frontend/src/cspAgreement.test.ts` fails when those
two disagree:

```
cd frontend && npx vitest run src/cspAgreement.test.ts
```

No test checks that a catalogue host is in the policy, so open each new basemap
in a production build (`cd frontend && npm run build`, then serve `dist/`) and
look for "Refused to" in the console.

**The privacy policy.** `frontend/public/privacy.html`, "Third-party map
services", names each operator that receives a user's IP address and the tile
coordinates of what they view. Add a line for the new one.

**Consent.** Whether the new line is a material change is the maintainer's
call. If it is, `CURRENT_CONSENT_VERSION` (`shared/src/consent.ts`) and the
"Last updated" dates in `privacy.html` and `tos.html` change together, and every
account is asked again at its next sign-in. A Logjam GPS build released before
the server named the version strands on a bump, so the comment on the constant
says to hold one until those builds are outside the support window
([0022](../decisions/0022-mobile-builds-supported-three-months.md)). Guard:

```
cd api && npx vitest run -c vitest.unit.config.ts src/constants/consent.unit.test.ts
```

## 6. A provider's TLS root

A provider whose certificate chains to a root an older device does not trust
fails to load there. SIX Maps' chain ends at DigiCert TLS RSA4096 Root G5, which
iOS 16 lacks ([0042](../decisions/0042-logjam-web-needs-the-popover-api.md)).
Logjam GPS's Android dev APK adds that root when it builds
(`.github/actions/build-dev-apk/action.yml`, `mobile/certs/`); no release build
does. Trusting a root in a release build is a native change: the native
fingerprint moves, so it ships in a store build and never as an OTA update
([0023](../decisions/0023-ota-runtime-is-the-native-fingerprint.md)). Ask the
maintainer before adding one, and test the provider on the oldest phone Logjam
GPS supports.

## 7. Sharpened areas

A sharpened area is cut from an ELVIS LiDAR ZIP, and `credit()` in
`topo/sharpen.py` writes its credit: NSW Spatial Services and CC BY 3.0 AU,
whichever region the area lies over, because the licence is not a field of
`Region`. A region whose survey publisher uses another licence would credit its
sharpened areas wrongly, so make the licence a field of the region before a
sharpened area can lie over one.

## Before the pull request

```
cd shared && npm test && npm run build
cd ../frontend && npm test && npm run typecheck
cd ../mobile && npm test && npm run typecheck
```

The API's unit suite is `npm run test:unit` in `api/`. Its integration suite is
`npm test` against a running local API (`make dev`); see
[api/AGENTS.md](../../api/AGENTS.md).
