import { t } from "./i18n.js";
import type { LicenceId } from "./licences.js";
import type { TopoLayerName } from "./topoSettings.js";
import {
  layerIn,
  REGIONS,
  regionInView,
  regionsOf,
  regionsTouching,
  vectorIn,
  WORLD,
  type LonLatBox,
  type Region,
  type TileBytes,
} from "./regions.js";

// Data from NSW Spatial Services' web services is licensed CC BY, subject to one
// extra term in their Terms and Conditions (cl. 3.1.1): they assert the right to
// be attributed as "©Department of Customer Service [date of extraction]". The
// standing credit string can't carry that — the date is only known when the
// tiles are actually fetched — so layers set `requiresExtractionDate` and the
// renderer appends the dated line at draw time.
// Terms: https://www.spatial.nsw.gov.au/products_and_services/web_services/terms_and_conditions
export const SIX_EXTRACTION_CREDIT_PREFIX = "© Department of Customer Service";

// ── Basemap catalog ───────────────────────────────────────────────────────────
// Canonical catalog of raster basemap providers, shared by the web map
// (frontend BASE_LAYERS derives from it), the GeoPDF renderer (via
// GEOPDF_BASE_LAYER_CONFIG below), and the mobile map. One list, no third copy.

const SIX_ATTRIBUTION =
  "Base map © State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to spatial.nsw.gov.au.";
const SIX_ATTRIBUTION_HTML =
  '&copy; State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to <a href="https://spatial.nsw.gov.au">spatial.nsw.gov.au</a>.';

// A tile's labels are a fixed size in pixels, so the deeper a print reads for
// resolution, the smaller they land on paper. Reading for 85 DPI lands a tile
// between 85 and 170 DPI, a 10 px label between 4 and 8 pt, against 1 to 2.5 pt
// at 300 DPI. Guard: geoPdfTileMath.test.ts.
const LABELLED_TILE_DPI = 85;

type BasemapCatalogBase = {
  id: string;
  /** Picker label (web layer switcher / mobile basemap picker). */
  name: string;
  /** The label on a chip in a row of maps, where `name` would run to a second line. */
  chipName?: string;
  /**
   * Cap for interactive map tile requests. Differs from maxNativeZoom where
   * deep-cache tiles are patchy (six-imagery serves z20 in metro only — the
   * web map has always capped display at 18 to avoid blank tiles in the
   * bush; keep that behaviour).
   */
  displayMaxZoom: number;
  /**
   * What the provider licenses its tiles under, or the stricter of that and
   * its tile policy (`licences.ts`).
   */
  licence: LicenceId;
  /** Plain-text attribution (GeoPDF print, mobile). */
  attribution: string;
  /** HTML attribution (web AttributionControl). */
  attributionHtml: string;
  /**
   * Whether a GeoPDF may be made from this provider. A print fetches every
   * tile of its page at once, none of them on screen, so this asks the
   * provider's tile terms, not the licence: every entry's licence allows a
   * printed sheet with the credit it carries.
   */
  printable: boolean;
  /**
   * The DPI a print reads this provider's tiles for, where not `TARGET_DPI`.
   * Left out where deeper tiles lose nothing: imagery has no labels, and SIX
   * Topo's grow with the zoom, as they are drawn on the sheet.
   */
  printTileDpi?: number;
  /**
   * NSW Spatial Services layers additionally need the dated extraction credit
   * (see SIX_EXTRACTION_CREDIT_PREFIX above) appended at draw time.
   */
  requiresExtractionDate?: boolean;
  /** False for an entry neither client's picker lists (`offeredBasemaps`). */
  offered?: false;
  /**
   * The sheet prints its own contour lines, so the statewide ones are not drawn
   * over it (`takesContours`). Guard: `contourRules.test.ts`.
   */
  printsContours?: true;
  /**
   * The map is photographs, which carry their own shadows, so the hillshade is
   * not drawn over it (`takesHillshade`). Guard: `contourRules.test.ts`.
   */
  photo?: true;
};

/**
 * Whether offline region downloads may target this provider.
 * OSM-family tile servers are online-only by policy (their usage policies
 * prohibit bulk scraping); SIX rasters and the self-hosted Protomaps
 * basemap are download-eligible. A raster one is saved as a tile pyramid, so
 * it carries the measured size of its tiles: an entry without them does not
 * compile.
 */
type BasemapOffline =
  | { offlineCapable: false; tileBytes?: undefined }
  | { offlineCapable: true; kind: "vector"; tileBytes?: undefined }
  | { offlineCapable: true; kind: "raster"; tileBytes: TileBytes };

/**
 * "raster" = XYZ tile provider. "vector" = self-hosted PMTiles, read from the
 * archive of the region in view (`vectorIn`; the mobile resolver prefixes the
 * CDN base URL), so the entry names no file of its own. Web BASE_LAYERS keeps
 * both; the GeoPDF renderer draws a vector entry from its archive with
 * `frontend/src/geoPdf/draw/basemap.ts`.
 */
type BasemapSource =
  | { kind: "vector" }
  | {
      kind: "raster";
      /** A {z}/{x}/{y} template. */
      urlTemplate: string;
      /**
       * Deepest zoom the provider's tile cache actually serves — the GeoPDF
       * renderer fetches at this zoom for print resolution.
       */
      maxNativeZoom: number;
    };

export type BasemapCatalogEntry = BasemapCatalogBase &
  BasemapSource &
  BasemapOffline;

// Order is the pickers' order: the OSM family, then the SIX sheets.
export const BASEMAP_CATALOG: BasemapCatalogEntry[] = [
  {
    // Self-hosted Protomaps vector basemap (the mobile offline-region source).
    // Each region declares its own cut (`Region.vector`); the mobile resolver
    // builds pmtiles://<cdnBaseUrl>/<archivePath> from the one in view.
    // ODbL requires the OSM credit; Protomaps credits the sponsor-funded
    // planet builds the extract comes from.
    id: "protomaps",
    // Named for what it IS, not for what it can do: every downloadable source
    // is "offline-ready", and "Topo Vector" read as a topographic map, which
    // this is not — it is the OSM road/track network drawn on the device.
    // It is also the only OSM default either picker offers (the "osm" raster
    // entry below is offered by neither): same cartography, drawn rather than
    // fetched and downloadable, so the name says which rendering it is.
    name: "OSM Vector",
    kind: "vector",
    // ODbL: the licence of the OpenStreetMap data every region's cut is drawn from.
    licence: "odbl",
    displayMaxZoom: 15,
    attribution: "Base map © OpenStreetMap contributors (Protomaps build)",
    attributionHtml:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | <a href="https://protomaps.com">Protomaps</a>',
    offlineCapable: true,
    // Our own archive, read from our own origin.
    printable: true,
  },
  {
    id: "osm",
    name: "Default",
    kind: "raster",
    urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 19,
    displayMaxZoom: 19,
    licence: "osmf-tiles",
    attribution: "Base map © OpenStreetMap contributors",
    attributionHtml:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    offlineCapable: false,
    // The vector basemap draws the same OpenStreetMap cartography, and two
    // renderings of one map side by side, one of which can't be saved, is a
    // choice with no answer.
    offered: false,
    // The OSMF tile policy calls "any pre-emptive fetching of tiles other than
    // those a user is actively viewing" bulk downloading, and forbids it. A
    // print is exactly that (operations.osmfoundation.org/policies/tiles).
    printable: false,
  },
  {
    id: "osm-topo",
    printsContours: true,
    name: "OSM Topo",
    kind: "raster",
    urlTemplate: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 17,
    displayMaxZoom: 17,
    licence: "cc-by-sa-3",
    attribution:
      "Base map © OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors, SRTM",
    attributionHtml:
      '<a href="https://github.com/der-stefan/OpenTopoMap">OpenTopo</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    offlineCapable: false,
    // opentopomap.org/about welcomes use elsewhere unless "mass downloads"
    // overload the server, and offers a script to stitch its tiles for print.
    // A print's tiles are read at 2 at a time (geoPdf/tiles.ts), never prefetched.
    printable: true,
    printTileDpi: LABELLED_TILE_DPI,
  },
  {
    id: "osm-cycle",
    printsContours: true,
    name: "OSM Cycle Topo",
    kind: "raster",
    urlTemplate:
      "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    maxNativeZoom: 20,
    displayMaxZoom: 20,
    licence: "osmf-tiles",
    attribution: "Base map © CyclOSM, © OpenStreetMap contributors",
    attributionHtml:
      '<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases">CyclOSM</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    offlineCapable: false,
    // cyclosm.org's "fairuse tile policy" is a link to the OSMF's: refused as
    // "osm" above. Its deep tiles are also rendered on request.
    printable: false,
  },
  {
    id: "six-topo",
    printsContours: true,
    name: "SIX Maps Topo",
    chipName: t`Topo`,
    kind: "raster",
    urlTemplate:
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 16,
    displayMaxZoom: 16,
    licence: "six-web-services",
    attribution: SIX_ATTRIBUTION,
    attributionHtml: SIX_ATTRIBUTION_HTML,
    offlineCapable: true,
    // MEASURED bytes per tile per zoom, by
    // `shared/scripts/calibrate-basemap-tile-sizes.mjs` against the live SIXMaps
    // caches: 14 random tiles per zoom, half from Blue Mountains bush (dense
    // contours, no streets) and half from the Katoomba–Blackheath strip. Re-run
    // that script and update the three SIX entries' `tileBytes` together.
    //
    // Per ZOOM rather than one figure per source, because `six-base` varies 10x
    // across the range (60 KB at z12 down to 6 KB at z18: a road-and-label map
    // has less to draw per tile the further in you go, where imagery has the
    // same amount of photo everywhere). A flat mean would over-estimate a deep
    // download by an order of magnitude and under-estimate a shallow one.
    //
    // BOTH terrain types: a topo tile over a town carries streets, labels and
    // building fill and measures ~1.5x a bush tile at the same zoom. People
    // save the area around a trailhead, and a trailhead is usually near a
    // town, so bush-only sampling would systematically under-estimate downloads.
    tileBytes: {
      12: { meanBytes: 12_441, p90Bytes: 13_085 },
      13: { meanBytes: 16_414, p90Bytes: 23_139 },
      14: { meanBytes: 14_754, p90Bytes: 17_674 },
      15: { meanBytes: 18_013, p90Bytes: 24_397 },
      16: { meanBytes: 18_199, p90Bytes: 28_638 },
    },
    printable: true,
    requiresExtractionDate: true,
  },
  {
    id: "six-base",
    printsContours: true,
    name: "SIX Maps Base Map",
    chipName: t`Base Map`,
    kind: "raster",
    urlTemplate:
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 18,
    displayMaxZoom: 18,
    licence: "six-web-services",
    attribution: SIX_ATTRIBUTION,
    attributionHtml: SIX_ATTRIBUTION_HTML,
    offlineCapable: true,
    tileBytes: {
      12: { meanBytes: 59_847, p90Bytes: 65_983 },
      13: { meanBytes: 43_479, p90Bytes: 53_631 },
      14: { meanBytes: 41_651, p90Bytes: 51_895 },
      15: { meanBytes: 26_577, p90Bytes: 41_196 },
      16: { meanBytes: 18_518, p90Bytes: 25_044 },
      17: { meanBytes: 9_113, p90Bytes: 15_942 },
      18: { meanBytes: 5_720, p90Bytes: 8_066 },
    },
    printable: true,
    printTileDpi: LABELLED_TILE_DPI,
    requiresExtractionDate: true,
  },
  {
    id: "six-imagery",
    photo: true,
    name: "SIX Maps Imagery",
    chipName: t`Imagery`,
    kind: "raster",
    urlTemplate:
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 20,
    displayMaxZoom: 18,
    licence: "six-web-services",
    attribution:
      "Imagery © State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to spatial.nsw.gov.au.",
    attributionHtml: SIX_ATTRIBUTION_HTML,
    offlineCapable: true,
    // `six-imagery` returns 404 for some z18 tiles, where advertised LOD differs
    // from cached tiles. Those are gaps, not errors: the downloader records them
    // and the UI counts them separately.
    tileBytes: {
      12: { meanBytes: 15_885, p90Bytes: 21_250 },
      13: { meanBytes: 15_663, p90Bytes: 19_351 },
      14: { meanBytes: 13_828, p90Bytes: 17_858 },
      15: { meanBytes: 14_433, p90Bytes: 18_393 },
      16: { meanBytes: 16_907, p90Bytes: 18_596 },
      17: { meanBytes: 20_080, p90Bytes: 23_563 },
      18: { meanBytes: 17_347, p90Bytes: 20_444 },
    },
    printable: true,
    requiresExtractionDate: true,
  },
];

/**
 * Every catalogue entry some picker lists: all but those marked `offered:
 * false`. What each client derives its stored-pick check and its mounted
 * sources from. Guard: `regions.test.ts`.
 */
export const LISTED_BASEMAPS: readonly BasemapCatalogEntry[] =
  BASEMAP_CATALOG.filter((entry) => entry.offered !== false);

/**
 * The listed entries, minus those a region owns unless `covering` has them. The
 * vector entry is no region's to own: `vector` says whether it is offered.
 */
function listed(
  regions: readonly Region[],
  covering: ReadonlySet<string>,
  vector: boolean,
): BasemapCatalogEntry[] {
  const owned = new Set(regions.flatMap((r) => r.basemaps));
  return LISTED_BASEMAPS.filter((entry) =>
    entry.kind === "vector"
      ? vector
      : !owned.has(entry.id) || covering.has(entry.id),
  );
}

/**
 * The basemaps a picker lists for the ground a map shows, in the catalogue's
 * order: the worldwide ones and those of every region the view touches, and the
 * vector map where the region in view declares an archive of it (the one it is
 * drawn from, `regionInView`). The regions an account chose play no part
 * (ADR 0049). Guard: `regions.test.ts`.
 */
export function offeredBasemaps(
  view: LonLatBox,
  regions: readonly Region[] = REGIONS,
  world: Region = WORLD,
): BasemapCatalogEntry[] {
  return listed(
    regions,
    new Set(regionsTouching(view, regions).flatMap((r) => r.basemaps)),
    vectorIn(regionInView(view, regions, world)) !== null,
  );
}

/**
 * The basemap a map draws for the user's pick: the pick where the view offers
 * it, else the default of the region in view (always one the view offers, which
 * `regions.test.ts` holds for every region), else the first offered. The pick
 * itself is left alone, so it comes back when the map returns to ground that
 * offers it. Guard: `regions.test.ts`.
 */
export function basemapHere(
  picked: string,
  view: LonLatBox,
  regions: readonly Region[] = REGIONS,
  world: Region = WORLD,
): string {
  const offered = offeredBasemaps(view, regions, world).map(
    (entry) => entry.id,
  );
  return offered.includes(picked)
    ? picked
    : (regionInView(view, regions, world)?.defaultBasemap ?? offered[0]!);
}

/**
 * The vector basemap's id when it is among `offeredIds`, else undefined: it is
 * the one basemap read from our own archive, so a client falls to it when a
 * pick's server is down or the pick is not offered, and only where it is
 * offered. Guard: `regions.test.ts`.
 */
export function vectorBasemapIn(
  offeredIds: readonly string[],
): string | undefined {
  const vector = BASEMAP_CATALOG.find((entry) => entry.kind === "vector");
  return vector && offeredIds.includes(vector.id) ? vector.id : undefined;
}

/**
 * The basemap Logjam GPS opens on before the user picks: the first chosen
 * region's, or the first worldwide one when no chosen region has one.
 */
export function defaultBasemapFor(
  regionIds: readonly string[],
  regions: readonly Region[] = REGIONS,
): string {
  return (
    regionsOf(regionIds, regions)[0]?.defaultBasemap ??
    listed(regions, new Set(), false)[0]!.id
  );
}

// Keyed view of the raster entries, the ones the GeoPDF renderer fetches as XYZ
// tiles. Derived: never hand-edit; extend BASEMAP_CATALOG instead.
export const GEOPDF_BASE_LAYER_CONFIG: Record<
  string,
  {
    urlTemplate: string;
    maxNativeZoom: number;
    attribution: string;
    printTileDpi?: number;
    requiresExtractionDate?: boolean;
  }
> = Object.fromEntries(
  BASEMAP_CATALOG.filter((entry) => entry.kind === "raster").map((entry) => [
    entry.id,
    {
      urlTemplate: entry.urlTemplate,
      maxNativeZoom: entry.maxNativeZoom,
      attribution: entry.attribution,
      printTileDpi: entry.printTileDpi,
      requiresExtractionDate: entry.requiresExtractionDate,
    },
  ]),
);

/**
 * The dated credit line NSW Spatial Services requires alongside the standing
 * base-map credit, or null for layers that don't come from their web services.
 *
 * `extractedAt` is when the tiles were actually fetched, not when the PDF was
 * assembled — the two straddle midnight often enough to matter for a date that
 * exists to say when this copy of the data was taken. Formatted ISO (UTC) so
 * the date is unambiguous to a reader in any timezone.
 */
export function extractionCreditLine(
  baseLayer: string,
  extractedAt: Date,
): string | null {
  if (!GEOPDF_BASE_LAYER_CONFIG[baseLayer]?.requiresExtractionDate) return null;
  return `${SIX_EXTRACTION_CREDIT_PREFIX} ${extractedAt.toISOString().slice(0, 10)}`;
}

// ── Overlay attribution ───────────────────────────────────────────────────────
// Logjam's topo overlays derive from open-data sources, each requiring its own
// credit wherever the derived material is shared (map UI + exported GeoPDF):
//   - hillshade / slope / contours → ELVIS LiDAR (Geoscience Australia + NSW), CC BY 4.0
//   - vegetation                   → NSW State Vegetation Type Map (SVTM), CC BY 4.0,
//                                     plus NSW NPWS Fire History (fire-staleness marking
//                                     baked into the same layer — see apply_fire_history
//                                     in topo/pipeline.py), CC BY 4.0
//   - features                     → OpenStreetMap, ODbL
// Land tenure is not here: its credit is the region's own (`LandArchive.credit`).
// Single source of truth so the frontend AttributionControl and the PDF agree.

export type OverlaySource = "elevation" | "vegetation" | "features";

export const GEOPDF_OVERLAY_ATTRIBUTION: Record<OverlaySource, string> = {
  elevation:
    "Elevation derived from LiDAR via ELVIS (elevation.fsdf.org.au) © State of NSW (Spatial Services) / Commonwealth of Australia (Geoscience Australia), CC BY 4.0. See dataset metadata for the specific custodian.",
  // The credit for the fire marking is the home region's (the first in
  // `REGIONS`, NSW): `apply_fire_history` in topo/pipeline.py marks with NSW's
  // NPWS history.
  vegetation:
    "Vegetation © State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2020 — State Vegetation Type Map (CC BY 4.0). " +
    (layerIn(REGIONS[0], "fire")?.credit ?? ""),
  features: "Features © OpenStreetMap contributors",
};

// Maps each selectable overlay layer name to its underlying data source(s).
// A layer may draw on more than one source: the vegetation density layer is a
// LiDAR Canopy Height Model (DSM − DTM), so it credits both the elevation source
// and the SVTM vegetation source.
// Keyed by the canonical TopoLayerName (topoSettings.ts TOPO_LAYERS): the
// values are per-layer data and stay hand-maintained, but a missing or extra
// key is a compile error.
export const TOPO_OVERLAY_SOURCE: Record<TopoLayerName, OverlaySource[]> = {
  hillshade: ["elevation"],
  slope: ["elevation"],
  contours: ["elevation"],
  vegetation: ["elevation", "vegetation"],
  features: ["features"],
};

// Stable display order for credit lines.
const OVERLAY_SOURCE_ORDER: OverlaySource[] = [
  "elevation",
  "vegetation",
  "features",
];

/**
 * Deduped attribution lines for the given active overlay layer names, in stable
 * source order. e.g. ["hillshade","slope","features"] →
 * ["Elevation data © …", "Features © OpenStreetMap contributors"].
 */
export function overlayAttributionLines(overlays: string[]): string[] {
  const sources = new Set<OverlaySource>();
  for (const name of overlays) {
    // Callers pass already-validated overlay names, but this is also used on
    // raw config input — tolerate unknown names rather than crash.
    const layerSources = (
      TOPO_OVERLAY_SOURCE as Record<string, OverlaySource[] | undefined>
    )[name];
    for (const source of layerSources ?? []) sources.add(source);
  }
  return OVERLAY_SOURCE_ORDER.filter((s) => sources.has(s)).map(
    (s) => GEOPDF_OVERLAY_ATTRIBUTION[s],
  );
}
