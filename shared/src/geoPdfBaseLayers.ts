import type { TopoLayerName } from "./topoSettings.js";

// Data from NSW Spatial Services' web services is licensed CC BY, subject to one
// extra term in their Terms and Conditions (cl. 3.1.1): they assert the right to
// be attributed as "©Department of Customer Service [date of extraction]". The
// standing credit string can't carry that — the date is only known when the
// tiles are actually fetched — so layers set `requiresExtractionDate` and the
// renderer appends the dated line at draw time.
// Terms: https://www.spatial.nsw.gov.au/products_and_services/web_services/terms_and_conditions
// Licensing research + per-layer sources: private/offline-basemap-licensing.md
export const SIX_EXTRACTION_CREDIT_PREFIX = "© Department of Customer Service";

// ── Basemap catalog ───────────────────────────────────────────────────────────
// Canonical catalog of raster basemap providers, shared by the web map
// (frontend BASE_LAYERS derives from it), the GeoPDF renderer (via
// GEOPDF_BASE_LAYER_CONFIG below), and the mobile map. Consolidated from the
// previously-drifting web/shared copies (map-sources.md deviation D2): the two
// disagreed on six-imagery max zoom and six-base existed only on web — while
// VALID_GEOPDF_BASE_LAYERS accepted "six-base", so a six-base GeoPDF silently
// fell back to defaults. One list, no third copy.

const SIX_ATTRIBUTION =
  "Base map © State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to spatial.nsw.gov.au.";
const SIX_ATTRIBUTION_HTML =
  '&copy; State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to <a href="https://spatial.nsw.gov.au">spatial.nsw.gov.au</a>.';

export type BasemapCatalogEntry = {
  id: string;
  /** Picker label (web layer switcher / mobile basemap picker). */
  name: string;
  /**
   * "raster" = XYZ tile provider (urlTemplate is a {z}/{x}/{y} template).
   * "vector" = self-hosted PMTiles archive (urlTemplate is the CDN-relative
   * archive path; the mobile resolver prefixes the CDN base URL). Web
   * BASE_LAYERS and the GeoPDF renderer consume raster entries only.
   */
  kind: "raster" | "vector";
  urlTemplate: string;
  /**
   * Deepest zoom the provider's tile cache actually serves — the GeoPDF
   * renderer fetches at this zoom for print resolution.
   */
  maxNativeZoom: number;
  /**
   * Cap for interactive map tile requests. Differs from maxNativeZoom where
   * deep-cache tiles are patchy (six-imagery serves z20 in metro only — the
   * web map has always capped display at 18 to avoid blank tiles in the
   * bush; keep that behaviour).
   */
  displayMaxZoom: number;
  /** Plain-text attribution (GeoPDF print, mobile). */
  attribution: string;
  /** HTML attribution (web AttributionControl). */
  attributionHtml: string;
  /**
   * Whether Stage 4 offline region downloads may target this provider.
   * OSM-family tile servers are online-only by policy (their usage policies
   * prohibit bulk scraping); SIX rasters and the self-hosted Protomaps
   * basemap are download-eligible.
   */
  offlineCapable: boolean;
  /**
   * NSW Spatial Services layers additionally need the dated extraction credit
   * (see SIX_EXTRACTION_CREDIT_PREFIX above) appended at draw time.
   */
  requiresExtractionDate?: boolean;
};

export const BASEMAP_CATALOG: BasemapCatalogEntry[] = [
  {
    id: "osm",
    name: "Default",
    kind: "raster",
    urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 19,
    displayMaxZoom: 19,
    attribution: "Base map © OpenStreetMap contributors",
    attributionHtml:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    offlineCapable: false,
  },
  {
    id: "osm-topo",
    name: "OSM Topo",
    kind: "raster",
    urlTemplate: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 17,
    displayMaxZoom: 17,
    attribution: "Base map © OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors",
    attributionHtml:
      '<a href="https://github.com/der-stefan/OpenTopoMap">OpenTopo</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    offlineCapable: false,
  },
  {
    id: "osm-cycle",
    name: "OSM Cycle Topo",
    kind: "raster",
    urlTemplate: "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    maxNativeZoom: 20,
    displayMaxZoom: 20,
    attribution: "Base map © CyclOSM, © OpenStreetMap contributors",
    attributionHtml:
      '<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases">CyclOSM</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    offlineCapable: false,
  },
  {
    id: "six-topo",
    name: "SIX Maps Topo",
    kind: "raster",
    urlTemplate:
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 16,
    displayMaxZoom: 16,
    attribution: SIX_ATTRIBUTION,
    attributionHtml: SIX_ATTRIBUTION_HTML,
    offlineCapable: true,
    requiresExtractionDate: true,
  },
  {
    id: "six-base",
    name: "SIX Maps Base Map",
    kind: "raster",
    urlTemplate:
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 18,
    displayMaxZoom: 18,
    attribution: SIX_ATTRIBUTION,
    attributionHtml: SIX_ATTRIBUTION_HTML,
    offlineCapable: true,
    requiresExtractionDate: true,
  },
  {
    id: "six-imagery",
    name: "SIX Maps Imagery",
    kind: "raster",
    urlTemplate:
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 20,
    displayMaxZoom: 18,
    attribution:
      "Imagery © State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to spatial.nsw.gov.au.",
    attributionHtml: SIX_ATTRIBUTION_HTML,
    offlineCapable: true,
    requiresExtractionDate: true,
  },
  {
    // Self-hosted Protomaps vector basemap (mobile Stage 2+; the Stage 4
    // offline-region source). urlTemplate is the CDN-relative archive path —
    // the mobile resolver builds pmtiles://<cdnBaseUrl>/<urlTemplate>.
    // ODbL requires the OSM credit; Protomaps credits the sponsor-funded
    // planet builds the extract comes from.
    id: "protomaps",
    // Named for what it IS, not for what it can do: every downloadable source
    // is "offline-ready", and "Topo Vector" read as a topographic map, which
    // this is not — it is the OSM road/track network drawn on the device.
    name: "Vector Map",
    kind: "vector",
    urlTemplate: "master/basemap/protomaps-nsw.pmtiles",
    maxNativeZoom: 15,
    displayMaxZoom: 15,
    attribution: "Base map © OpenStreetMap contributors (Protomaps build)",
    attributionHtml:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | <a href="https://protomaps.com">Protomaps</a>',
    offlineCapable: true,
  },
];

// Legacy keyed view consumed by the GeoPDF renderer/estimator (api). Derived —
// never hand-edit; extend BASEMAP_CATALOG instead. Raster entries only: the
// renderer fetches XYZ tiles, which a vector PMTiles archive can't provide.
export const GEOPDF_BASE_LAYER_CONFIG: Record<
  string,
  {
    urlTemplate: string;
    maxNativeZoom: number;
    attribution: string;
    requiresExtractionDate?: boolean;
  }
> = Object.fromEntries(
  BASEMAP_CATALOG.filter((entry) => entry.kind === "raster").map((entry) => [
    entry.id,
    {
      urlTemplate: entry.urlTemplate,
      maxNativeZoom: entry.maxNativeZoom,
      attribution: entry.attribution,
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
//                                     plus NSW NPWS Fire History (fire-staleness hatch
//                                     baked into the same layer — see apply_fire_history
//                                     in topo/pipeline.py), CC BY 4.0
//   - features                     → OpenStreetMap, ODbL
// Single source of truth so the frontend AttributionControl and the PDF agree.

export type OverlaySource = "elevation" | "vegetation" | "features";

export const GEOPDF_OVERLAY_ATTRIBUTION: Record<OverlaySource, string> = {
  elevation:
    "Elevation derived from LiDAR via ELVIS (elevation.fsdf.org.au) © State of NSW (Spatial Services) / Commonwealth of Australia (Geoscience Australia), CC BY 4.0. See dataset metadata for the specific custodian.",
  vegetation:
    "Vegetation © State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2020 — State Vegetation Type Map (CC BY 4.0). Fire history © State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2010 — NPWS Fire History - Wildfires and Prescribed Burns (CC BY 4.0)",
  features: "Features © OpenStreetMap contributors",
};

// Maps each selectable overlay layer name to its underlying data source(s).
// A layer may draw on more than one source: the vegetation density layer is a
// LiDAR Canopy Height Model (DSM − DTM), so it credits both the elevation source
// and the SVTM vegetation source.
// Keyed by the canonical TopoLayerName (topoSettings.ts TOPO_LAYERS): the
// values are per-layer data and stay hand-maintained, but a missing or extra
// key is now a compile error (ARCH-010).
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
