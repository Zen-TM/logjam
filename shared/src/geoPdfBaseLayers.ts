import type { TopoLayerName } from "./topoSettings.js";

export const GEOPDF_BASE_LAYER_CONFIG: Record<
  string,
  { urlTemplate: string; maxNativeZoom: number; attribution: string }
> = {
  "six-topo": {
    urlTemplate:
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 16,
    attribution:
      "Base map © State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to spatial.nsw.gov.au.",
  },
  "six-imagery": {
    urlTemplate:
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 20,
    attribution:
      "Imagery © State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to spatial.nsw.gov.au.",
  },
  osm: {
    urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 19,
    attribution: "Base map © OpenStreetMap contributors",
  },
  "osm-topo": {
    urlTemplate: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 17,
    attribution:
      "Base map © OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors",
  },
  "osm-cycle": {
    urlTemplate:
      "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    maxNativeZoom: 20,
    attribution:
      "Base map © CyclOSM, © OpenStreetMap contributors",
  },
};

// ── Overlay attribution ───────────────────────────────────────────────────────
// Logjam's topo overlays derive from three open-data sources, each requiring its
// own credit wherever the derived material is shared (map UI + exported GeoPDF):
//   - hillshade / slope / contours → ELVIS LiDAR (Geoscience Australia + NSW), CC BY 4.0
//   - vegetation                   → NSW State Vegetation Type Map (SVTM), CC BY 4.0
//   - features                     → OpenStreetMap, ODbL
// Single source of truth so the frontend AttributionControl and the PDF agree.

export type OverlaySource = "elevation" | "vegetation" | "features";

export const GEOPDF_OVERLAY_ATTRIBUTION: Record<OverlaySource, string> = {
  elevation:
    "Elevation derived from LiDAR via ELVIS (elevation.fsdf.org.au) © State of NSW (Spatial Services) / Commonwealth of Australia (Geoscience Australia), CC BY 4.0. See dataset metadata for the specific custodian.",
  vegetation:
    "Vegetation © State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2020 — State Vegetation Type Map (CC BY 4.0)",
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
