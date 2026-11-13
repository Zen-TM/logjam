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

- **The map asks one question.** `regionInView(view)` in
  `shared/src/regions.ts` returns the region holding the view's centre, else
  the first touching the view, else `WORLD` when it declares anything, else
  null. A layer switch reads `layerIn(regionInView(view), key) === null` as
  "not available here". `regionAt` answers for a point.
- **A box that is saved, printed or exported** uses every region in
  `regionsTouching(box)`, not one.
- **A region has several rings** (`Region.borders`): one for each island, so
  a strait or a gap between rings is outside the region.
- **The declaration's shape.** A region's border is a list of rings; the
  worldwide entry `WORLD` sits outside `REGIONS`; and a map draws one region
  at a time.
- **Guard.** `shared/src/regions.test.ts` holds the resolvers against
  `SIM_REGIONS` (`shared/src/simRegions.ts`); `shared/src/regionNeutral.test.ts`
  fails on a source file that names NSW's constants and is not on its list,
  and on a listed file that no longer does; a new entry is an added line a
  reviewer sees. No test yet fails on code that gates an offer by the
  chosen regions: `offeredBasemaps(regionIds)` still does, until the gallery
  reads the view.

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
  is a default. Home with several chosen regions is the first in `REGIONS`
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
