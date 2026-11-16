// What each data source Logjam reads is licensed under, so the day Logjam
// takes money for access (a subscription, an ad) the sources it must replace,
// or ask permission for, are a list a test holds, not a search through terms.
//
// Every declared source carries a `LicenceId`: a basemap catalogue entry, a
// height source, a Terrain archive, a region's vector cut, canyon list, gauge
// feed and place registry (`Region`), the geocoder and the forecast.
// `dataSources` flattens them. Shows nothing to a user: the credits users read
// stay each source's own. Guard: `licences.test.ts`.
//
// `commercialUse` is the stricter of the data's licence and the service's terms
// as Logjam uses them: false where a Logjam that charges, or shows ads, needs
// the owner's permission or another source. A tile or search service that a
// commercial app may call under a fair-use policy is true, though its owner can
// withdraw access.
import { GEOCODER_LICENCE } from "./geocode.js";
import { TERRARIUM } from "./demSources.js";
import { BASEMAP_CATALOG } from "./geoPdfBaseLayers.js";
import { REGIONS, WORLD, type Region } from "./regions.js";
import { WEATHER_LICENCE } from "./weather.js";

export type Licence = {
  name: string;
  /** The terms, read at their source. */
  url: string;
  commercialUse: boolean;
};

export const LICENCES = {
  "cc-by-3-au": {
    name: "CC BY 3.0 AU",
    url: "https://creativecommons.org/licenses/by/3.0/au/",
    commercialUse: true,
  },
  "cc-by-2.5-au": {
    name: "CC BY 2.5 AU",
    url: "https://creativecommons.org/licenses/by/2.5/au/",
    commercialUse: true,
  },
  "cc-by-4": {
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    commercialUse: true,
  },
  "cc-by-sa-3": {
    name: "CC BY-SA 3.0",
    url: "https://creativecommons.org/licenses/by-sa/3.0/",
    commercialUse: true,
  },
  // RopeWiki's licence and its version were not verified at the source (the
  // site refuses automated reads): the name and URL are the family's, with no
  // version, until someone reads its copyright page.
  "cc-by-nc-sa": {
    name: "CC BY-NC-SA",
    url: "https://creativecommons.org/licenses/",
    commercialUse: false,
  },
  // Made-up data, such as the simulated regions', which Logjam releases as it likes.
  cc0: {
    name: "CC0 1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUse: true,
  },
  odbl: {
    name: "ODbL",
    url: "https://opendatacommons.org/licenses/odbl/",
    commercialUse: true,
  },
  // OpenStreetMap's own tile servers: ODbL data; the policy forbids offline
  // use and bulk fetching, and says commercial services can lose access at any time.
  "osmf-tiles": {
    name: "OpenStreetMap Foundation map server usage policy",
    url: "https://operations.osmfoundation.org/policies/tiles/",
    commercialUse: true,
  },
  // ODbL data; heavy use is refused (one request a second at most).
  "osmf-nominatim": {
    name: "Nominatim usage policy",
    url: "https://operations.osmfoundation.org/policies/nominatim/",
    commercialUse: true,
  },
  // Spatial Services' web services: data under CC BY, with its own credit line.
  "six-web-services": {
    name: "NSW Spatial Services web services terms (CC BY)",
    url: "https://www.spatial.nsw.gov.au/products_and_services/web_services/terms_and_conditions",
    commercialUse: true,
  },
  // Terrain Tiles hold many open datasets, each credited under its own terms
  // (public domain, or an attribution licence; none forbids commercial use).
  "terrain-tiles": {
    name: "Mapzen terrain data attributions",
    url: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
    commercialUse: true,
  },
  // WaterNSW lets anyone use its information on condition of its notice, but
  // asks permission to charge for access or to put it in a product for sale.
  "waternsw-copyright": {
    name: "WaterNSW copyright notice",
    url: "https://www.waternsw.com.au/copyright",
    commercialUse: false,
  },
  // The free API is for non-commercial use only; a paid plan lifts that.
  "open-meteo-free": {
    name: "Open-Meteo free API terms (data CC BY 4.0)",
    url: "https://open-meteo.com/en/terms",
    commercialUse: false,
  },
} as const satisfies Record<string, Licence>;

export type LicenceId = keyof typeof LICENCES;

export type DataSource = {
  /** `<kind>:<declared id>`, unique across `dataSources`. */
  id: string;
  licence: LicenceId;
  /** The credit a height source or Terrain archive draws: a licence it names is this one (`licences.test.ts`). */
  credit?: string;
};

/**
 * Every source of data the app reads, once each: the catalogue's basemaps, the
 * worldwide height tiles, the geocoder and the forecast, then each region's
 * (and the world entry's) own. A height source that is also a Terrain archive
 * counts once.
 */
export function dataSources(
  regions: readonly Region[] = REGIONS,
  world: Region = WORLD,
): DataSource[] {
  const found = new Map<string, DataSource>();
  const add = (id: string, licence: LicenceId, credit?: string) =>
    found.set(id, { id, licence, ...(credit !== undefined && { credit }) });

  for (const entry of BASEMAP_CATALOG)
    add(`basemap:${entry.id}`, entry.licence);
  add(`dem:${TERRARIUM.id}`, TERRARIUM.licence, TERRARIUM.credit);
  add("geocoder", GEOCODER_LICENCE);
  add("weather", WEATHER_LICENCE);

  for (const region of [...regions, world]) {
    for (const dem of region.dem) add(`dem:${dem.id}`, dem.licence, dem.credit);
    for (const [key, archive] of Object.entries(region.terrain))
      if (key !== "heights")
        add(`terrain:${archive.id}`, archive.licence, archive.credit);
    if (region.vector) add(`vector:${region.id}`, region.vector.licence);
    if (region.canyons) add(`canyons:${region.id}`, region.canyons.licence);
    if (region.gauges !== null && region.gaugesLicence !== null)
      add(`gauges:${region.id}`, region.gaugesLicence);
    if (region.placeSearch !== null && region.placeSearchLicence !== null)
      add(`placeSearch:${region.id}`, region.placeSearchLicence);
  }
  return [...found.values()];
}

/** The sources a Logjam that charges for access must replace or get permission for. */
export function sourcesNeedingReplacement(
  sources: readonly DataSource[],
): DataSource[] {
  return sources.filter(({ licence }) => !LICENCES[licence].commercialUse);
}
