# Adding a region

A region is a place Logjam has maps, terrain and a canyon list for. New South
Wales (NSW) is the only one in prod. This is the checklist for adding another:
what to build, what to declare, and what outside the code has to change with it.
The reasoning is in [0049](../decisions/0049-what-a-map-offers-follows-the-ground-it-shows-and-an-accounts-chosen-regions-only-set-defaults.md).

A region is one declaration in `shared/src/regions.ts`. Nothing else names one:
a client, the API and the worker read the declaration, and
`shared/src/regionNeutral.test.ts` fails on a source file that names NSW's
constants or a simulated region. So adding a region changes no map, switch,
search or export code. If a step below seems to need that, the code is wrong;
fix it before adding the region.

Some steps are the maintainer's, because they reach prod: publishing an archive
to the topo bucket, scheduling a build task, uploading a canyon-list snapshot,
and shipping a build or a consent change. Nothing here does any of them. Never
run an `aws` command from this page without their say-so.

## What shows once a second region is in prod

With one region the region step, Settings' region list and the units choice are
hidden (`offersRegionChoice`, `offersUnitsChoice`). With two, the region step and
list appear for every account (the units choice only once a region uses feet),
and "Not available here" shows on a Terrain layer, or on Sharpen an area, where
the region in view lacks it. Tell the maintainer before the second region merges.

## 1. Try it before it is real

The simulated regions (`shared/src/simRegions.ts`: a two-island New Zealand, a
Utah with feet and the ACA grade, and a world entry) exercise every place-aware
path with made-up declarations over real ground. Use them to see what a region
with your mix of layers does, and copy their shape.

- Switching them on, per runtime: [README](../../README.md#local-development).
- Building their archives and serving them to the dev stack:
  [scripts/sim-regions/README.md](../../scripts/sim-regions/README.md).
- Sharpening a survey in one: [topo/README.md](../../topo/README.md#sharpening-an-area).

## 2. Decide what the region has

Every layer is optional. A region declares only what it has, and a layer it
lacks is absent from `terrain`, so the map says "Not available here" there.

| Declared | What it is | Built by |
|---|---|---|
| `terrain.heights` and `dem` | the heights the other archives are cut from, and the sampler's source | `topo/build_region_dem.py` ([ADR 0052](../decisions/0052-a-new-regions-heights-are-a-mapterhorn-extract-transcoded-to-adr-0030-tiles.md), [README](../../topo/README.md#building-a-regions-heights-from-mapterhorn)), or a pipeline of the region's own as NSW has |
| `terrain.slope`, `terrain.contours` | cut from the heights | `topo/build_nsw_dem.py slope` and `contours-archive` ([README](../../topo/README.md#another-height-archive)) |
| `terrain.hillshade` | MapLibre's hillshade over the heights archive itself | nothing: it names the heights' `archivePath` |
| `terrain.land` | land tenure classes | `topo/build_land_tenure.py` (NSW's source) |
| `terrain.fire` | fire history | `topo/build_fire_history.py` (NSW's source) |
| `terrain.coverage` | mobile coverage by carrier | `topo/build_coverage.py` (NSW's source) |
| `vector` | the region's cut of the vector basemap | `pmtiles extract` (section 4) |
| `placeSearch` | the place registry's CDN prefix | `topo/build_place_registry.py` |
| `gauges` | the river gauge feed's CDN prefix | `topo/build_gauges.py` is NSW's: another region's feed needs a builder of its own |
| `canyons` | where the canyon-list import reads from | a RopeWiki region and a snapshot in the media bucket |
| `sharpen` | whether a LiDAR survey can be sharpened there | the worker, `topo/sharpen.py` |

The land, fire, coverage and gauge builders read NSW's sources and their tests
read NSW's declaration. A region's archives are the same formats built from its
own sources, so each needs the script adapted, or a new one, and a licence check
on its data. Keep the credit the licence asks for in the archive's `credit` and
`creditHtml`.

Two things follow from the layers chosen:

- **An area export** (GeoTIFF, GeoPackage, MBTiles) is offered over a region that
  declares all of `heights`, `slope` and `contours`, and refused over one that
  lacks any (`areaExportRegion` in `shared/src/areaExport.ts`; the worker's twin
  is `export_region` in `topo/regions.py`). Its grid is the region's `grid`, and
  the worker reads the archives from `topo/regions.json`. Nothing else is
  declared for it. Guards: `areaExport.test.ts` ("is the region the worker reads
  the archives from") and `topo/tests/test_regions.py` (`TestExportRegion`), both
  reading `shared/src/__fixtures__/export-region.json`.
- **Sharpening** is filled from the region's heights and slope at z15, so an
  upload region needs both, with heights that stop at z15 (section 3).

## 3. Declare the region

In `shared/src/regions.ts`, copy the shape of `NSW_REGION`. Put the new constant
in `REGIONS_WITH_SIMULATED`, before the simulated ones, and in the list `REGIONS`
falls back to when the simulated regions are off. The type is `Region`; the
tables below take it field by field. "No test" means nothing goes red when the
value is wrong: check it by hand.

Declare with provisional values first, build the archives in section 4, then come
back and fill in what only a built archive gives: `minzoom`, `maxzoom`,
`coverage`, `tileBytes` and `credit`. A `placeSearch` prefix has to be declared
before the registry is built, because the build reads it from `topo/regions.json`.

The guards in the tables read `REGIONS_WITH_SIMULATED` (or `REGIONS`), so a
region added there is in them. Three lists name regions by hand and need the new
one added to them in the same change: `UPLOADING` and its id list in
`sharpen.test.ts`, and `NSW_ONLY` and `WITH_SIM` in `licences.test.ts` (exact
expectations, by design). "keep each archive under its own region's path" covers
the simulated regions only.

### The region

| Field | What it is, and where the value comes from | Guard |
|---|---|---|
| `id` | Lower-case letters and digits, never changed once shipped: it is stored in accounts' preferences and is in every map layer id. | `regions.test.ts`: "keeps each id to lower-case letters and digits", "gives each region its own id" |
| `name`, `fullName` | What copy calls it ("Import NSW from RopeWiki") and what a sentence with room for it calls it ("canyoning in New South Wales"). Plain strings; the sentences around them go through `t` ([0050](../decisions/0050-user-facing-text-goes-through-one-catalogue-function.md)). | No test |
| `view` | Where a map opens before the user has moved it: somewhere canyoners go, not the centre. | `regions.test.ts`: "opens its map inside its own border" |
| `timeZone` | IANA name. A leaderboard season and a trip plan's day read it. | `regions.test.ts`: "names a time zone the runtime knows" |
| `borders` | One ring of `[lon, lat]` for each island or separate piece, simplified and drawn a little outside the real border so it never cuts off ground the archives cover. A box would overlap a neighbour's. Longitudes are in [-180, 180]; a region across the date line has a ring each side. | `regions.test.ts`: "keeps every border longitude in [-180, 180]". Nothing checks the rings against the archives' `coverage`. |
| `basemaps`, `defaultBasemap` | Ids in `BASEMAP_CATALOG`, each listed by one region at most; the default is one of them. A region with none lists `[]` and defaults to `"osm-topo"`, as the simulated ones do. The vector basemap is never listed: `vector` declares it. Section 8. | `regions.test.ts`: "puts each basemap in one region at most, and only real ones", "opens each region on one of its own basemaps", "leaves the vector basemap out of every region's basemaps" |
| `vector` | The region's cut of the vector basemap, or null: `archivePath`, `maxzoom` and `licence` (a cut of OpenStreetMap is `odbl`). | The type requires a `LicenceId`; nothing checks it is the right one. Nothing checks `maxzoom` against the built archive. |
| `dem` | The height sources, finest first. For a region with its own heights it is `[heights]`. | `regions.test.ts`: "derives DEM_SOURCES: every region's, finest first, then the worldwide one", "cuts each region's terrain from one of its own height sources" |
| `terrain` | The archives below; `{}` where there are none. | `regions.test.ts`: "gives every terrain archive an id no other has, across every region" |
| `grid` | The map grid coordinates are given in: one of `GridId` (`shared/src/grids.ts`): `mga2020`, `nztm2000` or `utm`. A region on another grid needs the type, a zone rule, `GRID_NAMES` and the typed-reference reader widened first. | `grids.test.ts` checks each grid's projection against the survey agencies' published values. No test checks that a region's `grid` suits where it is. |
| `canyonGrades` | The system canyon grades are written in there, `french` or `aca`: a canyon form offers that system's fields. A third system needs `CanyonGradeSystem` and its attribute definitions first ([0051](../decisions/0051-a-lettered-grade-is-stored-as-its-rank.md)). | `canyonGrade.test.ts` ("the grade system at a position"). Nothing checks the value is the region's practice. |
| `units` | `metric` or `imperial`: what an account whose home this is reads until it chooses (`unitsOf`, `shared/src/units.ts`). Stored values never change. | `units.test.ts` ("unitsOf", "offersUnitsChoice"). Nothing checks the value suits the region. |

### Each Terrain archive

`heights`, `slope`, `hillshade`, `contours`, `land`, `fire` and `coverage` share
these fields (`TerrainArchive`):

| Field | What it is | Guard |
|---|---|---|
| `id` | A saved clip is filed under it. Unique across every region. | `regions.test.ts`: "gives every terrain archive an id no other has, across every region" |
| `archivePath` | Under the CDN's `/master`: `master/<kind>/<region>-…`. | `regions.test.ts`: "keep each archive under its own region's path" covers the simulated ones only. Nothing checks that a real one is published. |
| `minzoom`, `maxzoom` | The zooms the built archive holds (`pmtiles show`). | No test against a built file for a real archive |
| `coverage` | `[west, south, east, north]` of the archive's tiles. A position outside a heights archive's box skips the source. | No test |
| `credit`, `creditHtml` | The attribution the source's licence asks for, plain and as HTML. | `licences.test.ts`: "tags a height source or archive with the licence its credit names" (only when the credit names a CC BY licence) |
| `licence` | A `LicenceId` from `shared/src/licences.ts`: the licence of the source data (section 5). | The type requires one; `licences.test.ts` ("tags a height source or archive with the licence its credit names") checks only a credit that names a CC BY licence |
| `tileBytes` | The mean and 90th percentile bytes of a stored tile at every zoom a save clips; an offline save is priced from them (section 4). | `mapRegionEstimate.test.ts`: "holds figures for every zoom a save clips" checks every zoom has a figure, not that the figures are right |

`heights` is a `DemSource` rather than a `TerrainArchive`: it has `sampleZoom`
(the one zoom heights are read at) in place of `minzoom` and `maxzoom`, and
`name` (through `t`: what a save's list calls the clip, "NSW 5 m"), with
`urlTemplate: null`. `hillshade` is the heights' `archivePath` and `tileBytes`,
as NSW's is. Land, fire and coverage add:

| Archive | Extra fields | What they must match |
|---|---|---|
| `land` | `sourceLayer`, `classProperty`, `classes` (source value, name, colour), `caveat` | the build script's layer and attribute, and every class the source can hold: a class not listed is left undrawn. NSW's: `topo/tests/test_land_tenure.py` |
| `fire` | `sourceLayer`, `yearProperty`, `monthProperty`, `typeProperty`, `types`, `caveat` | the build script's layer and properties. NSW's: `topo/tests/test_fire_overlay.py` |
| `coverage` | `sourceLayer`, `carrierProperty`, `levelProperty`, `carriers`, `caveat` | the build script's layer, properties and carrier ids. NSW's: `topo/tests/test_coverage.py` |

Those three topo tests read NSW's declaration by pattern; none reads another
region's. A region's builder needs the same test for its own declaration.

### Place search, gauges and canyons

| Field | What it is | Guard |
|---|---|---|
| `placeSearch`, `placeSearchLicence` | The CDN prefix of the place registry, `master/places/<region>/v1/` (NSW's `master/places/v1/` is the one legacy exception), and its licence (OpenStreetMap's is `odbl`): both or neither. Add the region's Geofabrik extract to `EXTRACTS` in `topo/build_place_registry.py`. The scheduled task that runs `publish` takes no region, so a second region's registry needs a schedule of its own in `infra/terraform/envs/prod/ecs.tf`: the maintainer's. A phone keeps a registry for each region it chose or saved a map over ([0034](../decisions/0034-location-search-reads-a-public-osm-place-registry.md)). | `regions.test.ts`: "carries the current registry format, for every declared and simulated region"; `licences.test.ts`: "has a licence for a feed or a registry exactly where it has one"; `topo/tests/test_place_registry.py`: `test_extracts_are_the_regions_that_declare_a_registry` |
| `gauges`, `gaugesLicence` | The CDN prefix of the gauge feed, ending in "/", and its licence: both or neither ([0044](../decisions/0044-river-gauges-are-public-files-from-waternsw-and-bom.md)). Another region's feed is a builder and a schedule of its own writing the same files; `GaugeFeedFormat` in `shared/src/gauges.ts` is how a feed states its units and the minute offset its days are cut at. A gauge licence that forbids charging is listed by `sourcesNeedingReplacement`. | `regions.test.ts`: "every gauge feed prefix ends in a slash"; `licences.test.ts`; `gauges.test.ts`, against the builder's fixtures |
| `canyons` | The canyon-list import: `kind: "ropewiki"`, `ropewikiRegion` (RopeWiki's own name, as its "Located in regions" holds it), `snapshotKey` (`reference/ropewiki-<region>.csv`: a snapshot the maintainer exports by hand and uploads to the media bucket, because the site refuses automated reads) and `licence`. `extraLinks` is optional. Null where there is no list. | `regions.test.ts`: "give each region its own RopeWiki region and snapshot" |

### Sharpen

`sharpen` is how a user sharpens an area there
([0040](../decisions/0040-a-sharpened-area-is-a-private-dem-source.md)):

- `mode: "upload"` takes the user's own survey. It needs `portal` (`name`, `url`
  and `steps`: `elvis` for the errand ELVIS needs, `link` for a bare address and
  the one-ZIP reminder), `credit` (the line the survey's publisher asks for;
  `{extracted}` is where `credit()` in `topo/sharpen.py` adds the extraction
  month) and `vegetation` (whether the vegetation layer's inputs cover the
  region: NSW's are SVTM and the NPWS fire raster, so any other region is
  `false`). Its `heights.sampleZoom` and `slope.maxzoom` must be 15, where a
  sharpened area starts.
- `mode: "off"` takes a `reason`: `no-lidar`, or `already-fine` where the
  heights are already as fine as a survey.

Guards: `topo/tests/test_regions.py` (`test_an_upload_region_is_filled_from_z15`,
`test_every_reason_a_region_gives_has_a_sentence`) and `sharpen.test.ts` ("gives
every upload region a portal"). Nothing checks `vegetation`.

**`SHARPENED_LICENCE` is one constant** (`shared/src/sharpen.ts`, `cc-by-3-au`):
the licence every sharpened area's heights are tagged with, and the one NSW's
credit names. A region whose survey publisher licenses under anything else cannot
be `upload` yet: make the licence per region first (a `sharpen.licence`, read by
`sharpenedDemSource` and `dataSources`). `licences.test.ts` ("names the sharpened
heights' licence in the region's sharpen credit") passes while any one region's
credit names it, so it does not catch a second region's mismatched credit.

### Then run the declaration's tests

```
cd shared && npm test -- src/regions.test.ts src/regionNeutral.test.ts src/demSources.test.ts src/mapRegionEstimate.test.ts src/licences.test.ts src/grids.test.ts src/units.test.ts src/canyonGrade.test.ts src/sharpen.test.ts src/areaExport.test.ts
```

A few of these assert that prod has NSW alone: `regions.test.ts` ("declares only
NSW unless the simulated-regions flag is set", "puts the simulated regions and
their world in the declaration at load") and `grids.test.ts` ("is NSW's alone in
prod"). They go red on purpose; update each to the new list in the same change.
`src/topoRegions.test.ts` stays red until section 6 has regenerated
`topo/regions.json`.

## 4. Build, measure and publish the archives

Archive paths follow `master/<kind>/<region>-…`. NSW's older paths
(`master/dem/nsw-5m.pmtiles`, `master/places/v1/`, `master/gauges/v1/`) stay as
they are, because phones hold them (`shared/src/regions.ts`' header; guard:
`regions.test.ts`, "keeps NSW's stored ids and paths"). Each layer's section of
[topo/README.md](../../topo/README.md) says how to build it and ends with its
publish command. Publishing is a prod change and the maintainer's to make.

- **Heights, slope and contours.** [ADR 0052](../decisions/0052-a-new-regions-heights-are-a-mapterhorn-extract-transcoded-to-adr-0030-tiles.md)
  makes a region's heights a Mapterhorn extract that Logjam hosts: the clients
  never read Mapterhorn, and the build never runs from CI. Write the credit
  yourself from Mapterhorn's `attribution.json`, naming the sources the box
  draws on; it must not claim the finest resolution for the whole box. Cut slope
  and contours from the finished archive.
- **The vector cut.** `pmtiles extract` of a Protomaps planet build over the
  region's border, with `--maxzoom=15`, as the `vector` step of
  `scripts/sim-regions/build.py` does for the simulated regions (its README lists
  the hosts it reads). The repo has no script for NSW's.
- **`tileBytes`.** Measure them on the built archive, from real clips of rugged
  ground, since people save rugged ground: the comment on `NSW_HEIGHTS` in
  `regions.ts` says how NSW's were taken. The simulated regions' figures are
  placeholders, and a placeholder passes the tests while pricing a save wrongly.
- **The rest.** Land, fire, coverage and the place registry are built from their
  own sources, as section 2 says.

## 5. Licences

Every source a region declares carries a `licence` from `LICENCES` in
`shared/src/licences.ts`: each Terrain archive and height source, `vector`,
`canyons`, `gaugesLicence` and `placeSearchLicence`. `dataSources` flattens them,
so the day Logjam takes money for access, the sources to replace or to ask
permission for are a list a test holds (`sourcesNeedingReplacement`).

- Use the publisher's licence, as read at the source. A publisher not in
  `LICENCES` is a new entry there, with its terms' address and an honest
  `commercialUse`. A licence read second-hand says so in its comment, as
  RopeWiki's does.
- A layer cut from an elevation model carries that model's licence. Made-up data
  is `cc0`.
- **The `protomaps` catalogue entry says `odbl`** (`BASEMAP_CATALOG` in
  `shared/src/geoPdfBaseLayers.ts`), with an OpenStreetMap attribution, for every
  region's cut. That holds while each cut is an OpenStreetMap extract. A vector
  cut from any other source needs the licence and the attribution made per
  region first.
- Guard: `licences.test.ts` ("has a licence for a feed or a registry exactly
  where it has one", "lists, by default, every source of every region that is
  declared") reads every region. Its `sourcesNeedingReplacement` and
  "flattens every declared source of the production declaration" cases are
  exact expectations over NSW and the simulated regions (`NSW_ONLY`,
  `WITH_SIM`), so a new region's non-commercial source is not asserted until
  you add a case for it there by hand.

## 6. Generate what the worker reads

The workers read `topo/regions.json`, written from the declaration so Python never
parses TypeScript. It carries each region's rings, archives, `placeSearch`,
`gauges`, `grid` and `sharpen`. After any change to `regions.ts` or `simRegions.ts`:

```
cd shared && npm run build && npm run topo-regions
```

Commit the file. Guard: `topoRegions.test.ts` ("is what the script writes"). The
file ships in the worker image (`topo/Dockerfile` copies it), so a new region
reaches sharpening and exports with the next worker deploy.

## 7. The worldwide entry

Ground outside every region is answered by `WORLD` (`EMPTY_WORLD` in
`regions.ts`; `SIM_WORLD` in `simRegions.ts` is the worked example). It is a
`Region` with no border, and prod's declares nothing, so heights there are the
public Terrarium tiles. It has two optional parts:

- **`terrain.heights`** (and `hillshade`): an archive of Logjam's own for the
  rest of the world. `worldwideSource` then reads it, with no `coverage`, in
  place of Terrarium, and a save clips it. Declare it in `EMPTY_WORLD`, and list
  the same source in `dem: [heights]`, as `SIM_WORLD` does: `dataSources` takes
  the world's height licence from `dem`, and `regions.test.ts` ("cuts each
  region's terrain from one of its own height sources") fails without it. The
  public tiles drop out of `dataSources`, and the privacy policy's "Terrain and
  elevation" paragraph, which names them, must change with it (section 9).
  Guards: `demSources.test.ts` (the describe "the worldwide source") and
  `licences.test.ts` ("lists the public worldwide height tiles only while the
  world has no archive of its own").
- **`vector`**: the cut a map draws where no region is in view (`vectorsTouching`;
  guard: `regions.test.ts`, "falls to the world's archive only where no region is
  in view").

Declaring `terrain` or `vector` in `EMPTY_WORLD` turns `regions.test.ts`
"declares only NSW unless the simulated-regions flag is set" red on purpose (it
asserts the world's `terrain` is `{}` and its `vector` null). Update it in the
same change.

## 8. Basemaps

A provider is a `BASEMAP_CATALOG` entry in `shared/src/geoPdfBaseLayers.ts`,
listed in one region's `basemaps` (a provider with no region, like OpenStreetMap,
is worldwide).

- `offlineCapable` and `printable` follow the provider's tile terms, not its
  licence: say in the entry's comment which clause allows it.
- A raster entry that can be saved needs measured `tileBytes`.
  `shared/scripts/calibrate-basemap-tile-sizes.mjs` samples live tiles and prints
  them, but it measures only the sources in its `SOURCES` list (the three SIX
  services and Terrarium: an id, a URL builder and a zoom range each), so a new
  provider needs an entry there. Its sample areas, `BBOXES`, are in the Blue
  Mountains: change them to the new region's. It takes a source id as an argument,
  to measure one source.
- `printsContours` and `photo` stop the map drawing contours or a hillshade over
  a sheet that has its own (`contourRules.test.ts`).

## 9. Each new provider

A provider is any new host a client contacts: a basemap, an archive's CDN, a
geocoder. A region's own archives, registry and gauge feed are on Logjam's CDN,
which the policy already lists. Three changes go with a new host.

**The content security policy, in three places.** Logjam Web may only load from
hosts its policy lists. Add the host to `img-src` and `connect-src` in
`CSP_PROD` (`frontend/vite.config.ts`) and to `cspAllowlist` in
`scripts/csp-policy.json`. `frontend/src/cspAgreement.test.ts` fails when those
disagree:

```
cd frontend && npx vitest run src/cspAgreement.test.ts
```

No test checks that a catalogue host is in the policy, so open each new basemap
in a production build (`cd frontend && npm run build && npx vite preview`) and
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

## 10. A provider's TLS root

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

## Before the pull request

Run the topo suite with the Python version CI uses (`python-version` in the
`topo` job of [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)), after
`pip install -r requirements-test.txt`; [topo/AGENTS.md](../../topo/AGENTS.md)
says how it runs. Several of its tests read `regions.ts` and `regions.json`:

```
cd topo && python -m unittest discover -s tests
```

Then every package that reads the declaration:

```
cd shared && npm test && npm run build
cd ../frontend && npm test && npm run typecheck
cd ../mobile && npm test && npm run typecheck
```

The API's unit suite is `npm run test:unit` in `api/`. Its integration suite is
`npm test` against a running local API (`make dev`); see
[api/AGENTS.md](../../api/AGENTS.md).
