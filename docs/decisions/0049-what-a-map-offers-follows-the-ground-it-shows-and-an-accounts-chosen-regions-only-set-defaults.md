# 0049. What a map offers follows the ground it shows; an account's chosen regions only set defaults

- **Date:** 2026-11-14
- **Status:** Accepted
- **Supersedes:** —

## Context

`shared/src/regions.ts` declares NSW as a region and was written for a second:
its header said "Choosing regions controls what Logjam offers (the basemaps a
gallery lists, the canyon-list import, the layer switches)". #847 declared NSW
as a region; #849 built the choice: `offeredBasemaps(regionIds)` in
`shared/src/geoPdfBaseLayers.ts` lists the basemaps of the regions an account
chose (`uiPreferences.regions`), and the region step and Settings section
offer the choice once there is more than one region. #850 added the
canyon-list offers for each chosen region.

Gating by the choice breaks for a traveller. Someone who chose NSW and pans to
New Zealand sees no New Zealand basemap and no New Zealand terrain layers,
though Logjam holds them, and has to leave the map to find a setting that
makes what is in front of them appear. Heights, gauges and the area-export
check already follow coverage and never took the choice
([0028](0028-a-height-comes-from-the-finest-dem-source-that-has-it.md)).

The maintainer chose the map on 2026-11-14.

## Decision

**A layer, basemap or grid is offered where its data covers what the map
shows. The regions an account chose only set defaults: where a map first
opens, the first-run basemap and the canyon-list offers. They never decide
what is offered at a location.**
(updated 2026-11-15: the Updates below add the other places the home region is
read, none of them a location.)

- **The map asks one question.** `regionInView(view)` in
  `shared/src/regions.ts` returns the region holding the view's centre, else
  the first touching the view, else `WORLD` when it declares anything, else
  null. A layer switch reads `layerIn(regionInView(view), key) === null` as
  "not available here". `regionAt` answers for a point. (updated 2026-11-15:
  the basemap gallery also asks `regionsTouching`; see the second Update
  below.)
- **A box that is saved, printed or exported** uses every region in
  `regionsTouching(box)`, not one, except a printed sheet's Terrain layers,
  which come from the one region at the sheet's centre, else the first region
  the sheet touches (updated 2026-11-15;
  see the Update below), and an area export's rasters, which come from the
  one region `areaExportRegion` picks (updated 2026-11-16: see the last
  Update).
- **A region has several rings** (`Region.borders`): one for each island, so
  a strait or a gap between rings is outside the region.
- **The declaration's shape.** A region's border is a list of rings; the
  worldwide entry `WORLD` sits outside `REGIONS`; and a map draws one region
  at a time.
- **Update 2026-11-15: a printed sheet's Terrain comes from one region.** A
  GeoPDF takes its hillshade, slope, contours and Land from the one region
  `regionInWrappedView` picks for the sheet's box (`sheetTerrain` in
  `frontend/src/geoPdf/sheetTerrain.ts`), the way a map does, not from every
  region in `regionsTouching(box)`. A sheet straddling two regions prints the
  far side from the wrong archives, or none. It is held to one region
  because the renderer plans each strip's tiles, credits and Land legend
  from a single archive per layer, and no planned region is adjacent to
  another. A saved box still uses every region touching it (updated
  2026-11-16: an exported box does not; see the last Update). Guard:
  `frontend/src/geoPdf/sheetTerrain.test.ts` ("takes all its Terrain from
  the one region at its centre, though another touches the sheet"). Everything
  else above stands.
- **Update 2026-11-15: the basemap gallery lists every region the view
  touches.** `offeredBasemaps` (`shared/src/geoPdfBaseLayers.ts`) lists the
  worldwide basemaps and those of every region in `regionsTouching(view)`, not
  of the one `regionInView` names. A basemap is offered where its data covers
  what the map shows, so a view across a border offers both sides'; the one
  region still decides the default shown for a pick that is not offered
  (`basemapHere`). Guard: `shared/src/regions.test.ts` ("offeredBasemaps" block,
  "lists every region the view touches, in the catalogue's order"). Everything
  else above stands.
- **Update 2026-11-15: the chosen regions also decide which offline
  place-name copies Logjam GPS keeps.** A phone keeps a place registry for
  each region the account chose or saved a map over, and no other
  ([0034](0034-location-search-reads-a-public-osm-place-registry.md) holds the
  rule). That is one more default the choice sets: what a search offers at a
  location still follows the map's view, online and on the phone
  (`placeRegistryIn`), and the chosen regions never decide it. Guard:
  `mobile/src/offline/placeRegistry.test.ts` ("lets a copy lapse once its
  region is neither chosen nor saved over"). Everything else above stands.
- **Guard.** `shared/src/regions.test.ts` holds the resolvers against
  `SIM_REGIONS` (`shared/src/simRegions.ts`); `shared/src/regionNeutral.test.ts`
  fails on a source file that names NSW's constants and is not on its list,
  and on a listed file that no longer does; a new entry is an added line a
  reviewer sees. (updated 2026-11-14) The basemap gallery reads the view:
  `offeredBasemaps` and `basemapHere` take a box, so a call that passes the
  chosen region ids does not compile (the typecheck covers the tests), and
  `regions.test.ts` ("offeredBasemaps") holds what each view lists.
- **Update 2026-11-14: the chosen regions also set the first-run units.** An
  account that never chose its units reads those of its home region, the first
  of its chosen regions in `REGIONS` order (`unitsOf`,
  `shared/src/units.ts`); its own choice in Settings, offered only once a
  region uses feet (`offersUnitsChoice`), replaces them while that choice is
  offered. What a map offers at
  a place still never reads the choice. Guard: `shared/src/units.test.ts`
  ("unitsOf", "offersUnitsChoice"). Everything else above stands.
- **Update 2026-11-15: the account's home region also decides which grade
  attributes the lists with no map position name.** Settings, Place attributes;
  the Canyon type's built-in rows; Logjam GPS's attributes step and editor; and the
  import dialog's column targets list the grade fields of the system of the home
  region's `canyonGrades` (`listedAttributeDefs`, `shared/src/canyonGrade.ts`), plus,
  in the import dialog only, any grade field a place of the user holds a value on.
  The ACA four are not listed over NSW. This does not break "never decide what is
  offered at a location": these lists have no location, they are not drawn over a
  place, and a place's own form and the filter sheet still follow the ground
  ([0051](0051-a-lettered-grade-is-stored-as-its-rank.md) holds the rule). Guard:
  `shared/src/canyonGrade.test.ts` ("the definitions an attribute list shows").
  Everything else above stands.
- **Update 2026-11-16: Sharpen an area is offered where the region sharpens.**
  The Tools tray's tool, the Sharpened areas view's button, a place's
  "Sharpen an area here" and the dialog read `Region.sharpen` through
  `sharpenOfferFor` (`shared/src/sharpen.ts`). Where it is `off` they read "Not
  available here" with the region's reason; where it is `upload` the dialog
  names the region's portal. An action about a box (a place's verb, an area
  already drawn) asks the region holding the box's centre, which is how the
  worker picks the region that fills the area, and a box in no region is `off`
  with "no LiDAR", as the worker refuses it. A map's own entry points (no box)
  ask the region in view; over ground no region declares, that is "no LiDAR"
  too, so with one region in prod the entries read "Not available here" when
  the map is wholly outside New South Wales, where they used to open a dialog
  whose job was refused. A map not yet placed starts from the stored or
  default camera's region, so a New South Wales user never sees the off state
  flash. Guard: `shared/src/sharpen.test.ts` ("sharpenOffer",
  "sharpenOfferFor"), `frontend/src/components/map/viewRegion.test.ts`
  ("startingView") and `frontend/e2e/sharpen-region.spec.ts`. Everything else above stands.
- **Update 2026-11-16: an area export's rasters come from one region.** An
  area export (GeoTIFF, GeoPackage, MBTiles) reads its heights, slope and
  contours from the one region `areaExportRegion` (`shared/src/areaExport.ts`)
  and `export_region` (`topo/regions.py`) pick: the region with heights, slope
  and contours holding the box's centre, else the first such region touching
  it, in `REGIONS` order. An export is one grid and one archive for each
  layer, so ground of the box outside that region is left empty, and a box no
  such region touches is refused up front. A saved box still uses every region
  touching it. Guards: `shared/src/areaExport.test.ts` ("is the region the
  worker reads the archives from") and `topo/tests/test_regions.py`
  (`TestExportRegion`), both reading `shared/src/__fixtures__/export-region.json`.
  Everything else above stands.

## Consequences

- **Positive:** a traveller sees what exists where they are looking, with no
  setting to change first. A new region needs a declaration and archives, and
  no change to how any switch decides.
- **Negative: one region is drawn at a time.** A map keeps one source for each
  Terrain layer, its id carrying the region id, so with two regions side by
  side on screen only the one under the centre draws its Terrain group and
  vector basemap. No planned region is adjacent to NSW. The upgrade is a
  source for each region for each layer, which multiplies every map source
  and layer id by the number of regions in both clients.
- **Negative:** with one region in prod, a layer switch outside NSW reads "Not
  available here" where it used to turn on and draw nothing.
- **Neutral:** the region step and Settings section stay, and what they set
  is a default (updated 2026-11-15: and the grade attributes the lists with no map
  position name, the last Update). Home with several chosen regions is the first in `REGIONS`
  order, as `defaultBasemapFor` already does.

## Alternatives considered

- **Offers gated by the chosen regions** (#849, #850). The obvious reading of
  "choosing regions" and what the code did. Rejected: the traveller case
  above, and an account must change a setting to see data Logjam already
  holds for the place on screen. It keeps one place to look for what an account
  can see, which the map-first rule gives up: what is offered now depends on
  where the camera is.
- **A source for each region on screen at once.** No gap at a border and no
  ceiling. Rejected for now: it multiplies sources and layer ids in both
  clients for a case no planned region has. Revisit when two regions are
  adjacent.
- **Every region touching the printed sheet** (the rule above, without its
  exception). A sheet over two regions would print both sides from their own
  archives. Rejected for now: the planner, the renderer's strips and the
  credit and legend blocks each assume one archive per layer, and no planned
  region is adjacent to another. Revisit when two regions are adjacent.
- **Every region touching an exported box** (the rule above, without the
  export's exception). Mosaic each touching region's archives into one export.
  Rejected for now: more worker code (one mosaic and one grid per region, a
  credit for each) for a case no declared region has, since none share a
  border. Revisit when two regions are adjacent.
- **The basemap gallery listing only the region `regionInView` names** (the
  rule above, without the gallery's exception). Rejected: a view across a
  border would hide the basemap that covers half of what the map shows.
