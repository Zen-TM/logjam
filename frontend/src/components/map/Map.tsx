import { Button, Checkbox, Notice } from "../../ui";
import { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "virtual:maplibre-worker-url";

// maplibre-gl 6 finds its worker beside the library file via import.meta.url,
// which Vite's bundling breaks. vite.config.ts emits the worker and the shared
// chunk it imports under a content-hashed path and exposes its URL here.
setWorkerUrl(maplibreWorkerUrl);
import { PMTiles, Protocol } from "pmtiles";
import {
  INK,
  MAP_INK,
  MAP_LABEL_MIN_ZOOM,
  PLACE_TYPE_COLORS,
  SHARED_PLACE_COLOR,
  type MapPointCoord,
  type RegionBbox,
  contourLabelHalo,
  gaugeDisplayName,
  latestGaugeReading,
  LAND_EDGE_LINES,
  LAND_EDGE_MINZOOM,
  landColor,
  landEdgeOpacity,
  landFillOpacity,
  nswContourStyle,
  NSW_LAND,
  TERRAIN_LAYER_KEYS,
  type SharpenedOverlay,
  type TerrainLayerKey,
} from "@logjam/shared";
import { WORLDWIDE_TERRAIN_SOURCE, applyTerrain } from "./terrainSource";
import { useTerrainReapply } from "./useTerrainReapply";
import { useBoxDraw } from "./useBoxDraw";
import MapPointPopover from "./MapPointPopover";
import GaugePopover from "../gauges/GaugePopover";
import { GaugeLoadNotice } from "../gauges/GaugeLoadNotice";
import { useGauges } from "../gauges/useGauges";
import {
  GAUGE_BELOW,
  GAUGE_LABELS,
  GAUGE_LAYER,
  LAND_EDGE_LAYER,
  LAND_FILL_LAYER,
  PRESSABLE_LAYERS,
  pressClosedGauge,
  pressedGaugeId,
} from "./layerOrder";
import type { PlaceHighlight } from "./placeHighlight";
import type { RouteHoverChannel } from "./routeHover";
import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import {
  arrowSegmentFeatures,
  draftAnchorIndices,
  draftPoints,
  fetchSnapLines,
  insertAnchor,
  moveAnchor,
  nearestSegment,
  snapSegment,
  ARROW_FEATURE_KIND,
  GAUGE_ICON_IMAGE,
  GAUGE_ICON_SDF_URI,
  GAUGE_ICON_SIZE,
  ROUTE_ARROW_ICON_SIZE,
  ROUTE_ARROW_IMAGE,
  ROUTE_ARROW_MIN_ZOOM,
  ROUTE_ARROW_SDF_URI,
  SAVED_ROUTE_MIN_ZOOM,
  type RouteDraft,
  type RoutePoint,
  type SnapMode,
} from "@logjam/shared";

export type { SnapMode };

// Register PMTiles protocol for serving topo overlay layers from S3
const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile.bind(pmtilesProtocol));
// The Terrain group's tiles once the user can see a sharpened area.
maplibregl.addProtocol(TERRAIN_PROTOCOL, terrainTile);

// Decide whether a MapLibre source error means the PMTiles archive is
// DEFINITIVELY gone (tear the overlay down + blacklist it) versus a transient
// blip we should let MapLibre retry. MapLibre fires "error" for ANY
// per-tile/source load failure — including one-off network drops — so treating
// the first error as terminal would kill a healthy overlay for the session.
//
// Terminal signals, deliberately conservative:
//   - MapLibre AJAXError carries a numeric `.status`: the real HTTP code for an
//     error response, or 0 for a network/CORS/DNS failure. Only 404 (object
//     gone) and 403 (forbidden — expired/removed) are terminal; 0 and 5xx are
//     transient.
//   - The pmtiles Protocol throws a plain Error whose message embeds the
//     archive's response code, e.g. "Bad response code: 404".
// A per-tile "Tile not found." (sparse coverage inside a healthy archive) is
// NOT terminal and is intentionally excluded.
function isTerminalTopoSourceError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof status === "number") {
    return status === 404 || status === 403;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /bad response code:\s*(403|404)\b/i.test(message);
}
import classes from "./Map.module.css";
import MapSearchBox from "./MapSearchBox";
import MapChrome, { type MapTool } from "./MapChrome";
import { collectLngLatPairs } from "./topoFootprint";
import {
  afterEase,
  type FramePick,
  keepScale,
  keptFrameSizePx,
  keptScaleOnEntry,
  letGo,
  scaleNow,
  unmovedPick,
} from "./geoPdfFrame";
import type { ReactNode } from "react";
import { MOBILE_MAX_WIDTH_PX, useMediaQuery } from "../../useIsMobile";
import type {
  TPlace,
  TFilters,
  PlaceTrack,
  StandaloneTrack,
  TRoute,
} from "../../placeUtils";
import type { GeoJsonPolygonal } from "../../topoLayerTypes";
import {
  passesFilters,
  isPlaceDoneByViewer,
  type TPlaceType,
} from "../../placeUtils";
import { fetchTrackGeoJSON, trackGeoCacheKey } from "../media/trackGeo";
import { useToast } from "../feedback/ToastProvider";
import { moveTerrainIntoBasemap, stackTopoLayers } from "./layerOrder";
import { TERRAIN_ENTRIES, type RoutedTiles } from "./terrainEntries";
import {
  TERRAIN_PROTOCOL,
  areasKey,
  isAbsentTerrainTile,
  terrainTile,
} from "./terrainRouter";
import { messageFromError } from "../../errors/messageFromError";
import {
  BASEMAP_CATALOG,
  extentFromCentreAndSize,
  rgbaCssFromHex,
  contourWidthStops,
  TERRARIUM,
  slopeReliefColor,
  isValidLatitude,
  isValidLongitude,
  type SlopeBand,
  type VectorStyleSettings,
  metersPerPixel,
} from "@logjam/shared";

// How long after touching a vertex handle the map ignores its own click. Long
// enough to cover the press-release of a deliberate click, short enough that a
// genuine map click straight afterwards still registers.
const HANDLE_CLICK_SUPPRESS_MS = 400;

/** Movement below this is a click, not a drag, so it inserts nothing. */
const DRAG_INSERT_MIN_PIXELS = 6;

// Saved routes vanish below SAVED_ROUTE_MIN_ZOOM, which lives in
// `@logjam/shared` (`routeArrow.ts`): Logjam GPS draws the same routes at the
// same floor, and why that zoom (and why the route being drawn is exempt) is
// documented there.

const INITIAL_CENTER: [number, number] = [151.2093, -33.8688];
const INITIAL_ZOOM = 7;

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function applyPlaceThemePaint(map: maplibregl.Map) {
  // A place whose type has not loaded wears the palette's first colour.
  const fallback = PLACE_TYPE_COLORS[0];
  const shared = SHARED_PLACE_COLOR;
  const ink = INK;
  // The accent is the scheme's own colour and follows it onto the map; a
  // label and its halo are drawn on the basemap, so they do not (MAP_INK).
  const accent = readCssVar("--color-accent", "#deb188");
  const label = MAP_INK.label;
  const halo = MAP_INK.casing;

  // FILL is the place's type; the RING says someone shared it with you — the
  // same two axes Logjam GPS draws (mobile/src/map/PlacePinsLayer.tsx).
  if (map.getLayer("place-circles")) {
    map.setPaintProperty("place-circles", "circle-color", [
      "coalesce",
      ["get", "color"],
      fallback,
    ]);
    map.setPaintProperty("place-circles", "circle-stroke-color", ink);
    map.setPaintProperty("place-circles", "circle-stroke-width", 1.5);
  }
  // A shared pin is the SAME pin as your own, with a thin ring set apart from
  // it — a mark on a pin rather than a louder pin — as on Logjam GPS.
  if (map.getLayer("shared-place-circles")) {
    map.setPaintProperty("shared-place-circles", "circle-color", [
      "coalesce",
      ["get", "color"],
      fallback,
    ]);
    map.setPaintProperty("shared-place-circles", "circle-stroke-color", ink);
    map.setPaintProperty("shared-place-circles", "circle-stroke-width", 1.5);
  }
  if (map.getLayer("shared-place-halos")) {
    map.setPaintProperty("shared-place-halos", "circle-stroke-color", shared);
  }
  for (const id of ["place-highlight", "shared-place-highlight"]) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, "circle-color", accent);
    map.setPaintProperty(id, "circle-stroke-color", accent);
  }
  for (const id of ["place-labels", "shared-place-labels", GAUGE_LABELS]) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, "text-color", label);
    map.setPaintProperty(id, "text-halo-color", halo);
  }
}

// Protomaps glyph + sprite assets. Logjam GPS vendors these into its bundle
// because offline regions must render labels with zero network; Logjam Web
// has no offline requirement, so it reads them from the upstream host (CSP
// allowlisted). No user data rides these requests — they are keyed by font
// stack and codepoint range only.
const BASEMAP_ASSETS_BASE_URL = "https://protomaps.github.io/basemaps-assets";

/**
 * Prefix for the generated Protomaps style layers. Namespaced because the
 * upstream set includes generic ids ("background", "water") that would collide
 * with layers this map already owns.
 */
const PROTOMAPS_LAYER_PREFIX = "pm-";
const PROTOMAPS_SOURCE_ID = "protomaps";

// Derived from the canonical shared basemap catalog (map-sources.md D2) —
// same ids, order, URLs, and zoom caps as before the consolidation. The
// interactive map uses displayMaxZoom (six-imagery stays capped at 18 here
// while the GeoPDF renderer keeps fetching its native 20).
//
// `kind` rides along because the two entry kinds are not interchangeable
// downstream: raster entries are XYZ templates the GeoPDF renderer can fetch,
// the vector entry is a PMTiles archive it cannot.
//
// The raster "osm" entry ("Default") is left out: the vector basemap draws the
// same OpenStreetMap cartography and is the default, so offering both put two
// renderings of one map side by side. Logjam GPS dropped it the same way.
export const BASE_LAYERS = BASEMAP_CATALOG.filter(
  (entry) => entry.id !== "osm",
).map((entry) => ({
  id: entry.id,
  name: entry.name,
  kind: entry.kind,
  // Vector has no XYZ template — `tiles` stays empty and the picker falls back
  // to a captioned placeholder instead of a tile thumbnail.
  tiles: entry.kind === "raster" ? [entry.urlTemplate] : [],
  maxzoom: entry.displayMaxZoom,
  attribution: entry.attributionHtml,
}));

/**
 * Mounts the self-hosted Protomaps vector basemap: one PMTiles source plus the
 * generated @protomaps/basemaps layer set.
 *
 * The layer set comes from the package at runtime rather than a committed JSON
 * because web needs plain MapLibre layers, while the committed JSONs under
 * mobile/src/map/basemap/ are reshaped for maplibre-react-native (paint+layout
 * merged into one camelCase object). Same package, same pinned version — see
 * scripts/basemap/package.json; bump both together or neither.
 *
 * Light flavor only: Logjam Web has no dark theme (index.css carries a single
 * prefers-color-scheme rule that inverts icons, nothing more).
 */
function addProtomapsBasemap(
  map: maplibregl.Map,
  visibility: "visible" | "none",
) {
  const entry = BASEMAP_CATALOG.find((e) => e.id === "protomaps");
  // Fail loudly — a missing catalog entry is a programming error, and silently
  // skipping it would leave the picker offering a basemap that draws nothing.
  if (!entry) throw new Error("protomaps missing from BASEMAP_CATALOG");

  // Always same-origin: prod serves /master/* from the web distribution, and
  // the dev server proxies the same prefix (see vite.config.ts). That keeps
  // the archive under CSP 'self' and out of the CORS problem entirely.
  map.addSource(PROTOMAPS_SOURCE_ID, {
    type: "vector",
    url: `pmtiles://${window.location.origin}/${entry.urlTemplate}`,
    attribution: entry.attributionHtml,
  });

  for (const layer of protomapsLayers(
    PROTOMAPS_SOURCE_ID,
    namedFlavor("light"),
    { lang: "en" },
  )) {
    map.addLayer({
      ...layer,
      id: `${PROTOMAPS_LAYER_PREFIX}${layer.id}`,
      layout: { ...layer.layout, visibility },
    } as maplibregl.LayerSpecification);
  }
}

/**
 * The Protomaps archive, read directly for snapping. Same origin in prod and
 * proxied in dev (vite.config.ts), so this never leaves our own host — and it
 * is independent of which basemap is showing or how far the map is zoomed.
 */
function snapArchiveUrl(): string {
  const entry = BASEMAP_CATALOG.find((e) => e.id === "protomaps");
  if (!entry) throw new Error("protomaps missing from BASEMAP_CATALOG");
  return `${window.location.origin}/${entry.urlTemplate}`;
}

/** Every layer id belonging to the Protomaps band, in style order. */
function protomapsLayerIds(map: maplibregl.Map): string[] {
  return map
    .getStyle()
    .layers.map((l) => l.id)
    .filter((id) => id.startsWith(PROTOMAPS_LAYER_PREFIX));
}

/**
 * A lat/lng box. An ALIAS of the shared `RegionBbox`, not a second declaration:
 * the same four numbers are the offline-region plan's input, the topo job's
 * extent and the place filter's area, and three structurally-identical types
 * meant three places to fix the day one of them grew a fifth field.
 */
export type TBbox = RegionBbox;

// ── Vector style helpers ──────────────────────────────────────────────────
// Colour + width math lives in @logjam/shared so the live overlay and the
// GeoPDF canvas renderer stay in lockstep. These thin wrappers adapt the shared
// pure helpers into MapLibre paint expressions.

// Convert #RRGGBBAA → rgba(r,g,b,a) CSS string that MapLibre's paint expressions
// accept.
function rgbaCss(hex: string): string {
  return rgbaCssFromHex(hex);
}

// Contour width is specified in ground metres by the user; convert to a pixel
// width via the shared stops (default 18 m → ≈2.25 px, default 8 m → ≈1 px).
function contourPixelWidth(widthM: number): maplibregl.ExpressionSpecification {
  const { z12, z18 } = contourWidthStops(widthM);
  return ["interpolate", ["linear"], ["zoom"], 12, z12, 18, z18];
}

// Place map labels: ellipsize a name past this length so a pathological
// long name (e.g. a 250-char single token that can't line-wrap) can't render
// as one full-map-width label. The detail-panel header truncates
// separately via CSS.
const MAX_LABEL_CHARS = 40;
const PLACE_LABEL_FIELD: maplibregl.ExpressionSpecification = [
  "case",
  [">", ["length", ["get", "name"]], MAX_LABEL_CHARS],
  ["concat", ["slice", ["get", "name"], 0, MAX_LABEL_CHARS], "…"],
  ["get", "name"],
];

// Base label-size bump for the live map, independent of the user's labelScale
// slider. Topo labels read too small at the bare 9→12px ramp; 1.75 lifts them to
// ~16→21px. The export bakers deliberately diverge with their own larger base
// (the MBTiles baker uses 3×, see topo/pipeline.py `label_font_size`), so baked
// exports are intentionally bigger than the live overlay — no longer a match.
const WEB_LABEL_BASE_SCALE = 1.75;

// The label text-size zoom ramp (9px@z14→12px@z18) scaled by the user's global
// labelScale and the web base bump. Single source for every topo label layer.
function labelTextSizeExpr(scale: number): maplibregl.ExpressionSpecification {
  const s = scale * WEB_LABEL_BASE_SCALE;
  return ["interpolate", ["linear"], ["zoom"], 14, 9 * s, 18, 12 * s];
}

// Paint the statewide contours in place via setPaintProperty. Called when the
// layers are first created and again when the basemap changes, so neither
// recreates them. Each set is guarded by getLayer, so it's a no-op for a layer
// that doesn't exist yet.
function applyContourPaint(
  map: maplibregl.Map,
  entryId: string,
  vs: VectorStyleSettings,
): void {
  const setPaint = (
    lid: string,
    prop:
      | "line-color"
      | "line-width"
      | "fill-color"
      | "fill-outline-color"
      | "text-color"
      | "text-halo-color",
    value: string | number | maplibregl.ExpressionSpecification,
  ): void => {
    if (map.getLayer(lid)) map.setPaintProperty(lid, prop, value as never);
  };
  // text-size is a layout property, not paint. setLayoutProperty triggers a
  // relayout (cheap for the handful of label layers) and never recreates them.
  const sizeExpr = labelTextSizeExpr(vs.labelScale ?? 1);
  const setLabelSize = (lid: string): void => {
    if (map.getLayer(lid)) map.setLayoutProperty(lid, "text-size", sizeExpr);
  };

  setPaint(
    `topo-${entryId}-minor`,
    "line-color",
    rgbaCss(vs.contours.minorColour),
  );
  setPaint(
    `topo-${entryId}-minor`,
    "line-width",
    contourPixelWidth(vs.contours.minorWidthM),
  );
  setPaint(
    `topo-${entryId}-major`,
    "line-color",
    rgbaCss(vs.contours.majorColour),
  );
  setPaint(
    `topo-${entryId}-major`,
    "line-width",
    contourPixelWidth(vs.contours.majorWidthM),
  );
  setPaint(
    `topo-${entryId}-labels`,
    "text-color",
    rgbaCss(vs.contours.majorColour),
  );
  setPaint(
    `topo-${entryId}-labels`,
    "text-halo-color",
    contourLabelHalo(vs.contours.majorColour),
  );
  setLabelSize(`topo-${entryId}-labels`);
}

/**
 * Draft geometry as map features: the line, plus one point per ANCHOR carrying
 * its `role` so the two ends can be told apart. Shared by the state-driven
 * effect and the live drag preview, which must agree on what a draft looks like
 * or the line would flicker between two renderings mid-drag.
 */
function draftFeatureCollection(
  points: readonly RoutePoint[],
  anchorIndices: readonly number[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (points.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: points.map((p) => [...p]) },
      properties: {},
    });
    // One line per segment for the arrows to ride, so an arrow never lands on
    // an anchor handle. The line above stays whole for the line layer, which
    // filters these back out — see `arrowSegmentFeatures` in @logjam/shared.
    features.push(...(arrowSegmentFeatures(points, {}) as GeoJSON.Feature[]));
  }
  anchorIndices.forEach((pointIndex, anchorIndex) => {
    const point = points[pointIndex];
    if (!point) return;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [...point] },
      properties: {
        role:
          anchorIndex === 0
            ? "start"
            : anchorIndex === anchorIndices.length - 1
              ? "end"
              : "middle",
      },
    });
  });
  return { type: "FeatureCollection", features };
}

/**
 * Paint a draft straight into the map source, bypassing React.
 *
 * Deliberate: routing a frame per pixel through the draft hook would push an
 * undo entry per pixel moved. Every live drag (moving an anchor, dragging a
 * segment to insert one) previews through here so they can't diverge.
 */
function previewDraft(map: maplibregl.Map, draft: RouteDraft): void {
  const source = map.getSource("route-draft") as
    | maplibregl.GeoJSONSource
    | undefined;
  if (!source) return;
  source.setData(
    draftFeatureCollection(draftPoints(draft), draftAnchorIndices(draft)),
  );
}

function Map({
  filters,
  places,
  sharedPlaces,
  selectPlace,
  pickingCoords,
  onCoordsPicked,
  onCancelPickCoords,
  showPlaces,
  showWays,
  showGauges,
  onShowGauges,
  placeTracks,
  standaloneTracks,
  routes,
  selectRoute,
  selectTrack,
  onAddPlaceAt,
  onMeasureFrom,
  routeHover,
  drawingRoute,
  measuring,
  drawColor,
  drawPoints,
  drawAnchorIndices,
  draft,
  snapMode,
  editingRouteId,
  onDrawPointAdd,
  onDrawSnap,
  onDrawPointDelete,
  onDrawPointInsert,
  onDrawPointMove,
  selectingBbox,
  onBboxSelected,
  onBboxCancelled,
  selectingFilterArea,
  onFilterAreaSelected,
  topoLayers,
  sharpenedAreas,
  slopeBands,
  activeLayerId,
  selectingGeoPdfExtent,
  geoPdfPaperAspect,
  geoPdfPaperDimensions,
  geoPdfInitialExtent,
  geoPdfInitialScale,
  onGeoPdfExtentConfirmed,
  onGeoPdfExtentCancelled,
  onMapBoundsChange,
  onMapViewChange,
  initialView,
  topoFlyTarget,
  onTopoFlyConsumed,
  flyToPlace,
  onFlyToPlaceConsumed,
  flyToBounds,
  onFlyToBoundsConsumed,
  panelOpen,
  sheetOpen = false,
  placeHighlight,
  placeTypes,
  layersButton,
  mapTools,
  notices,
  onTopoSourceUnavailable,
}: {
  filters: TFilters;
  places: TPlace[];
  sharedPlaces: TPlace[];
  selectPlace: (id: string | null) => void;
  pickingCoords: boolean;
  onCoordsPicked: (lat: number, lng: number) => void;
  onCancelPickCoords: () => void;
  // TWO overlays over the user's own data, divided by what a thing IS: a pin is
  // a place, a line is a way. Ownership does not split either of them — it is
  // already on the thing itself (fill is the type, ring is sharing), and
  // splitting by it made a shared place answer to two toggles (LayersPopover).
  showPlaces: boolean;
  /** Every line: routes, imported and recorded files, and the tracks on places
   *  friends shared. */
  showWays: boolean;
  /** The river gauge drops, an optional layer (off until asked for). */
  showGauges: boolean;
  onShowGauges: () => void;
  placeTracks: PlaceTrack[];
  // Standalone files (the user's own imports and recorded tracks), already
  // resolved to a presigned URL. Same fetch-and-parse treatment as placeTracks.
  standaloneTracks: StandaloneTrack[];
  // User-authored routes. Geometry arrives inline, so unlike placeTracks
  // there is nothing to fetch and parse per feature.
  routes: TRoute[];
  selectRoute: (id: string) => void;
  // A track or import line pressed: its media id, for the page that opens it.
  selectTrack: (mediaId: string) => void;
  /** "What is here?" verbs: each hands the point to the flow that exists. */
  onAddPlaceAt: (point: MapPointCoord) => void;
  onMeasureFrom: (point: MapPointCoord) => void;
  /** Where along a line the elevation-profile cursor sits, marked on the map so
   *  the chart and the ground read as the same place. A CHANNEL, not a value:
   *  it changes many times a second (see the subscribing effect). */
  routeHover: RouteHoverChannel;
  // Draw/edit mode. The vertex list lives in App so the HUD can render the
  // running distance and drive undo; the map only reports gestures.
  drawingRoute: boolean;
  /** The draft is a measurement, not a route: the same gestures, drawn dotted
   *  and without direction (it is asked, not made). Implies `drawingRoute`. */
  measuring: boolean;
  /** Palette colour the draft will be saved with. */
  drawColor?: string;
  drawPoints: [number, number][];
  /** Which of drawPoints are the user's own vertices (the draggable handles). */
  drawAnchorIndices: number[];
  /** The anchor/filler split, for deciding which segment a line-drag splits. */
  draft: RouteDraft;
  /** Whether new segments follow trails/creeks. */
  snapMode: SnapMode;
  /** Route being edited; null while drawing a new one. The saved-routes layer
   * skips it so the draft layer isn't drawing over a stale copy. */
  editingRouteId: string | null;
  /** Appends one or more vertices — more than one when a segment snapped. */
  onDrawPointAdd: (point: [number, number]) => void;
  /** A snapped run arrived for the segment between these two anchors. */
  onDrawSnap: (
    from: [number, number],
    to: [number, number],
    between: [number, number][],
  ) => void;
  onDrawPointMove: (index: number, lngLat: [number, number]) => void;
  /** Click a handle to remove that vertex. */
  onDrawPointDelete: (index: number) => void;
  /** Drag the line between two anchors to introduce one there. */
  onDrawPointInsert: (segmentIndex: number, lngLat: [number, number]) => void;
  selectingBbox?: boolean;
  onBboxSelected?: (bbox: TBbox) => void;
  /** Given, the box tool has a Cancel that leaves it undrawn. */
  onBboxCancelled?: () => void;
  /** The Places filter's "area on map" mode — the third box-draw on this map. */
  selectingFilterArea?: boolean;
  onFilterAreaSelected?: (bbox: TBbox) => void;
  topoLayers?: {
    id: string;
    pmtilesUrl: string;
    /** `slope` and `hillshade` are a terrarium DEM, drawn by MapLibre. */
    format?: "raster" | "vector" | "slope" | "hillshade" | "land";
    attribution?: string;
    /** Read through the terrain router instead of `pmtilesUrl`'s archive. */
    tiles?: RoutedTiles;
  }[];
  /** The sharpened areas the user can see: 3D terrain reads them too. */
  sharpenedAreas?: readonly SharpenedOverlay[];
  /** The bands every `slope` entry is coloured in. */
  slopeBands?: SlopeBand[];
  activeLayerId: string;
  selectingGeoPdfExtent?: boolean;
  geoPdfPaperAspect?: number;
  geoPdfPaperDimensions?: { w: number; h: number };
  geoPdfInitialExtent?: TBbox;
  geoPdfInitialScale?: number;
  onGeoPdfExtentConfirmed?: (extent: TBbox, scale: number) => void;
  onGeoPdfExtentCancelled?: () => void;
  /**
   * The visible bounds, on load and after every pan/zoom. Separate from
   * `onMapViewChange` because its consumer keeps the answer in a ref: "filter
   * to the current view" needs the bounds only at the moment the button is
   * pressed, and routing them through state would re-render Logjam Web on every
   * frame of a pan for a value nothing renders.
   */
  onMapBoundsChange?: (bounds: TBbox) => void;
  onMapViewChange?: (view: {
    lat: number;
    lng: number;
    zoom: number;
    bearing: number;
    pitch: number;
  }) => void;
  initialView?: {
    lat: number;
    lng: number;
    zoom: number;
    bearing: number;
    pitch: number;
  } | null;
  // A footprint may be a Polygon OR a MultiPolygon (disconnected capture);
  // collectLngLatPairs walks either to its [lng,lat] leaf positions.
  topoFlyTarget?: GeoJsonPolygonal | null;
  onTopoFlyConsumed?: () => void;
  flyToPlace?: { lat: number; lng: number } | null;
  onFlyToPlaceConsumed?: () => void;
  /**
   * Fit the map to a way's extent: opening one centres it, and so does arming
   * the draw tool on it. A CONSUMED request, not a counter — a counter above
   * zero fires again on every remount (DESIGN.md).
   */
  flyToBounds?: [number, number, number, number] | null;
  onFlyToBoundsConsumed?: () => void;
  /** A page is open over the map's left edge; the chrome moves clear of it. */
  panelOpen: boolean;
  /** A sheet is open beside that page (the Places filters). */
  sheetOpen?: boolean;
  /** The Places row under the pointer; its pin is lit. A channel, not a prop
   *  value, so a hover does not re-render the map (placeHighlight.ts). */
  placeHighlight: PlaceHighlight;
  /** A pin's FILL is its type's colour. */
  placeTypes: TPlaceType[];
  /** The Layers control, owned by App because App owns what it toggles. */
  layersButton?: ReactNode;
  mapTools: readonly MapTool[];
  /** Pinned notices about what the map shows right now. */
  notices?: ReactNode;
  // Fired once per topo overlay entry (jobId-layerName) whose PMTiles source
  // failed to load (e.g. the S3 object is gone). The entry's layers/source are
  // removed so MapLibre stops retrying; App surfaces the failure.
  onTopoSourceUnavailable?: (entryId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  /**
   * The map and its locate control, once it is safe to attach handlers to —
   * null before load, so the box-draw hook can key its effect on the map
   * itself rather than on a separate `mapLoaded` flag every call site would
   * have to remember to pass. State, not mapRef, because render reads it.
   */
  const [loaded, setLoaded] = useState<{
    map: maplibregl.Map;
    geolocate: maplibregl.GeolocateControl;
  } | null>(null);
  const mapLoaded = loaded !== null;
  const drawableMap = loaded?.map ?? null;
  const [is3D, setIs3D] = useState(false);
  const toast = useToast();
  // Touch/stylus input (coarse pointer) vs mouse — drives "Tap" vs "Click"
  // copy in the map-pick banners. Pointer capability, not
  // viewport width: a touch laptop at desktop width still gets "Tap".
  const isTouchInput = useMediaQuery("(pointer: coarse)");
  const pickVerb = isTouchInput ? "Tap" : "Click";
  const prevTopoKeyRef = useRef<string>("");

  const slopeBandsRef = useRef(slopeBands);

  // Keep refs up to date for use inside event handlers
  const selectPlaceRef = useRef(selectPlace);
  useEffect(() => {
    selectPlaceRef.current = selectPlace;
  }, [selectPlace]);

  // True whenever any coord-pick mode is active — read by once-on-load layer
  // handlers to suppress marker selection during picking.
  const pickModeRef = useRef(false);
  useEffect(() => {
    pickModeRef.current =
      pickingCoords ||
      (selectingFilterArea ?? false) ||
      // The topo bbox draw belongs here too and was missing: without it, the
      // click that anchors a corner over a place marker also opened that
      // place's panel behind the box being drawn.
      (selectingBbox ?? false) ||
      (selectingGeoPdfExtent ?? false);
  }, [
    pickingCoords,
    selectingFilterArea,
    selectingBbox,
    selectingGeoPdfExtent,
  ]);

  // Route draw/edit mode, read by the once-on-load layer handlers.
  const drawingRouteRef = useRef(false);
  useEffect(() => {
    drawingRouteRef.current = drawingRoute;
  }, [drawingRoute]);
  const selectTrackRef = useRef(selectTrack);
  useEffect(() => {
    selectTrackRef.current = selectTrack;
  }, [selectTrack]);
  const panelOpenRef = useRef(panelOpen);
  const sheetOpenRef = useRef(sheetOpen);
  useEffect(() => {
    panelOpenRef.current = panelOpen;
    sheetOpenRef.current = sheetOpen;
  }, [panelOpen, sheetOpen]);
  // "What is here?": the point being asked about, with the fix the browser
  // already had when it was asked (null: it never has to be asked for one).
  const [asked, setAsked] = useState<{
    point: MapPointCoord;
    from: MapPointCoord | null;
  } | null>(null);
  // The latest fix, in memory only: it feeds the distance and bearing in that
  // panel and goes nowhere else (see the GeolocateControl note below).
  const userFixRef = useRef<MapPointCoord | null>(null);
  // When the panel last closed, so the press that closed it (a click elsewhere
  // on the map) is not also read as a new question.
  const askedClosedAt = useRef(0);
  const closeAsked = useCallback(() => {
    askedClosedAt.current = Date.now();
    setAsked(null);
  }, []);
  // The river gauge pressed, if any; the drops come from the public file.
  const [gaugeId, setGaugeId] = useState<string | null>(null);
  const { file: gaugeFile, failed: gaugesFailed } = useGauges(showGauges);
  if (!showGauges && gaugeId) setGaugeId(null);
  const openGauge = gaugeFile?.gauges.find((g) => g.id === gaugeId);
  const closedGaugeRef = useRef<{ id: string; at: number } | null>(null);
  const closeGauge = useCallback((id: string) => {
    closedGaugeRef.current = { id, at: performance.now() };
    setGaugeId(null);
  }, []);
  const selectRouteRef = useRef(selectRoute);
  useEffect(() => {
    selectRouteRef.current = selectRoute;
  }, [selectRoute]);
  // Read inside the click handler, which is installed once per draw session:
  // without refs it would close over the first render's points and snap every
  // segment from the same stale vertex.
  // Read inside the map's one-shot load handler, which cannot see later props.
  const activeLayerIdRef = useRef(activeLayerId);
  useEffect(() => {
    activeLayerIdRef.current = activeLayerId;
  }, [activeLayerId]);
  const drawPointsRef = useRef(drawPoints);
  useEffect(() => {
    drawPointsRef.current = drawPoints;
  }, [drawPoints]);
  const snapModeRef = useRef(snapMode);
  useEffect(() => {
    snapModeRef.current = snapMode;
  }, [snapMode]);
  const onDrawSnapRef = useRef(onDrawSnap);
  useEffect(() => {
    onDrawSnapRef.current = onDrawSnap;
  }, [onDrawSnap]);
  const onDrawPointDeleteRef = useRef(onDrawPointDelete);
  useEffect(() => {
    onDrawPointDeleteRef.current = onDrawPointDelete;
  }, [onDrawPointDelete]);
  const onDrawPointInsertRef = useRef(onDrawPointInsert);
  useEffect(() => {
    onDrawPointInsertRef.current = onDrawPointInsert;
  }, [onDrawPointInsert]);
  // When a vertex handle was last pressed. The map's click handler consults it
  // to tell "the user interacted with a handle" from "the user clicked the
  // map": MapLibre delivers the map click even when the press landed on a
  // marker, and neither stopPropagation on the handle nor a target check on the
  // event reliably suppressed it — so a click meant to delete a point appended
  // one instead, and a drag appended one at the drop.
  const handlePressedAt = useRef(0);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const onDrawPointAddRef = useRef(onDrawPointAdd);
  useEffect(() => {
    onDrawPointAddRef.current = onDrawPointAdd;
  }, [onDrawPointAdd]);
  const onDrawPointMoveRef = useRef(onDrawPointMove);
  useEffect(() => {
    onDrawPointMoveRef.current = onDrawPointMove;
  }, [onDrawPointMove]);

  /**
   * Snap one segment and hand the run back, fire-and-forget.
   *
   * Reading the archive is a network round trip on a cold tile, so nothing
   * waits on it: the straight segment is already drawn, and `setFiller` behind
   * `onDrawSnap` drops a run whose anchors have since moved — which is what
   * makes a late result safe to apply to a draft the user has kept editing.
   */
  const snapBetweenRef = useRef((from: RoutePoint, to: RoutePoint) => {
    if (snapModeRef.current === "off") return;
    void fetchSnapLines(snapArchiveUrl(), snapModeRef.current, from, to)
      .then((lines) => {
        const between = snapSegment(lines, from, to);
        // `between` includes the graph nodes nearest both ends; drop them, or
        // the line jumps sideways onto the track at each end.
        if (between && between.length > 2) {
          onDrawSnapRef.current(from, to, between.slice(1, -1));
        }
      })
      .catch(() => {
        // Offline or unreachable archive: the straight line already drawn is
        // the right answer, and a toast per gesture would be noise.
      });
  });

  // The next vertex of the draft, from a click or from Enter on the focused map.
  const placeDrawPointRef = useRef((at: { lng: number; lat: number }) => {
    const tapped: [number, number] = [at.lng, at.lat];
    const previous = drawPointsRef.current[drawPointsRef.current.length - 1];
    // Snapping only ever ADDS intermediate points between the previous
    // vertex and this one — the user's own clicks stay exactly where they
    // put them, so a bad snap is undone by one Undo rather than by
    // reconstructing what they meant. The tapped point lands immediately and
    // the run fills in behind it; waiting would make every click feel laggy.
    onDrawPointAddRef.current(tapped);
    if (previous && snapModeRef.current !== "off")
      snapBetweenRef.current(previous, tapped);
  });

  const onMapBoundsChangeRef = useRef(onMapBoundsChange);
  useEffect(() => {
    onMapBoundsChangeRef.current = onMapBoundsChange;
  }, [onMapBoundsChange]);
  const onMapViewChangeRef = useRef(onMapViewChange);
  useEffect(() => {
    onMapViewChangeRef.current = onMapViewChange;
  }, [onMapViewChange]);

  // Topo overlay entries whose PMTiles source already failed this session.
  // Read by the once-on-load error handler (dedupe) and by the structural topo
  // effect (never re-add a known-missing source — stops the per-load retry
  // spam).
  const failedTopoSourcesRef = useRef<Set<string>>(new Set());
  // Topo entries whose transient (non-terminal) load error was already logged
  // this session — one console line per source, not one per flaky tile.
  const transientTopoSourcesRef = useRef<Set<string>>(new Set());
  // Where each Terrain source reads from: the statewide archive, or the router
  // for one set of sharpened areas. A change rebuilds the source.
  const terrainSourceFromRef = useRef(new globalThis.Map<string, string>());
  const onTopoSourceUnavailableRef = useRef(onTopoSourceUnavailable);
  useEffect(() => {
    onTopoSourceUnavailableRef.current = onTopoSourceUnavailable;
  }, [onTopoSourceUnavailable]);

  useEffect(() => {
    slopeBandsRef.current = slopeBands;
  }, [slopeBands]);

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        // Protomaps' own glyph + sprite set, not MapLibre's demotiles: the
        // generated vector basemap layers reference Noto Sans stacks that
        // demotiles does not serve, and a missing stack fails silently as
        // blank labels rather than an error.
        glyphs: `${BASEMAP_ASSETS_BASE_URL}/fonts/{fontstack}/{range}.pbf`,
        sprite: `${BASEMAP_ASSETS_BASE_URL}/sprites/v4/light`,
        sources: {},
        layers: [],
      },
      center: initialView ? [initialView.lng, initialView.lat] : INITIAL_CENTER,
      zoom: initialView?.zoom ?? INITIAL_ZOOM,
      bearing: initialView?.bearing ?? 0,
      pitch: initialView?.pitch ?? 0,
      touchPitch: false, // pinch-rotate is enough for 3D; touch-pitch is a nuisance
      maxPitch: 0,
      attributionControl: false,
    });

    // Zoom, compass and locate are MapChrome's buttons over the map, driving it
    // through its public API; MapLibre's NavigationControl is not added.
    //
    // "Where am I" is a primary question in the field. MapChrome's locate button
    // calls this control's `trigger()`; the control's own button is hidden
    // (Map.module.css) while it still draws the dot, the accuracy circle and
    // follow mode.
    //
    // Privacy: this is entirely browser-native. MapLibre reads the position via
    // navigator.geolocation and renders it as a map marker in this page — the
    // position is never sent to the API, and no analytics/telemetry observes it.
    const geolocate = new maplibregl.GeolocateControl({
      // High accuracy: the difference between the right side of a creek and
      // the wrong one. Costs battery, which is the correct trade for a
      // control the user taps deliberately rather than a background watch.
      positionOptions: { enableHighAccuracy: true, timeout: 10_000 },
      // Follow the user as they walk. Panning away drops the camera lock into
      // MapLibre's background state — the dot keeps updating but stops
      // recentring, so the control can't fight the user for the viewport
      // while they read the map ahead. Pressing it again re-locks.
      trackUserLocation: true,
      // Under canopy or in a slot, a confident-looking dot with 40 m of error
      // is worse than no dot. The accuracy circle makes the error legible.
      showAccuracyCircle: true,
      showUserLocation: true,
    });
    map.addControl(geolocate, "top-right");
    // The fix is kept in memory for "What is here?" and cleared when locating
    // stops, so a stale one never gives a distance. Never persisted or sent.
    geolocate.on("geolocate", (event) => {
      userFixRef.current = {
        latitude: event.coords.latitude,
        longitude: event.coords.longitude,
      };
    });
    geolocate.on("trackuserlocationend", () => {
      userFixRef.current = null;
    });
    // Compact: it collapses to an (i) once the map is moved, which OSMF's
    // attribution guideline allows while the credit stays one press away.
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.ScaleControl({
        unit: "metric",
        maxWidth: window.innerWidth <= MOBILE_MAX_WIDTH_PX ? 100 : 160,
      }),
      "bottom-left",
    );

    // A completed topo job whose S3 outputs are gone otherwise 404s on every
    // tile request, silently renders nothing, and retries each load.
    // Source errors propagated through MapLibre's Style carry the sourceId. Only
    // a DEFINITIVELY-missing archive (404/403) is terminal — tear its
    // layers/source down (stops the retries) and notify App so the Layers panel
    // can flag it. A transient error (network blip, 5xx, per-tile miss) is left
    // in place so MapLibre retries; one blip must not blacklist a healthy
    // overlay for the whole session.
    map.on("error", (event) => {
      const { sourceId } = event as { sourceId?: unknown };
      // The router's way of saying "draw the parent": not an error at all,
      // for a Terrain layer and for the 3D terrain source alike.
      if (isAbsentTerrainTile(event.error)) return;
      if (typeof sourceId !== "string" || !sourceId.startsWith("topo-src-")) {
        // Not ours — keep MapLibre's default behaviour of printing the error
        // (binding any "error" listener suppresses it otherwise).
        console.error(event.error);
        return;
      }
      const entryId = sourceId.slice("topo-src-".length);
      if (failedTopoSourcesRef.current.has(entryId)) return;
      if (!isTerminalTopoSourceError(event.error)) {
        // Non-terminal: do NOT tear down or blacklist — retrying is correct.
        // Log once per source (no URLs — only the source id) so a flaky
        // connection can't spam the console.
        if (!transientTopoSourcesRef.current.has(entryId)) {
          transientTopoSourcesRef.current.add(entryId);
          console.error(
            `Topo overlay source hit a transient error (will retry): ${sourceId}`,
          );
        }
        return;
      }

      failedTopoSourcesRef.current.add(entryId);
      // Log only the source id (job id + layer name) — no URLs.
      console.error(`Topo overlay source failed to load: ${sourceId}`);
      const ownedLayerIds = map
        .getStyle()
        .layers.map((l) => l.id)
        .filter((lid) => lid.startsWith(`topo-${entryId}-`));
      for (const lid of ownedLayerIds) {
        if (map.getLayer(lid)) map.removeLayer(lid);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      onTopoSourceUnavailableRef.current?.(entryId);
    });

    map.on("load", () => {
      // Add all base layers. Raster entries are one source + one layer each;
      // the Protomaps vector entry is one source plus the whole generated
      // style set, all added here so the basemap band sits below every place,
      // route and topo layer added later in this handler.
      BASE_LAYERS.forEach((layer) => {
        // Follow the ACTIVE layer, not index 0. The toggle effect below would
        // correct a mismatch a frame later, but the user would see the wrong
        // basemap flash first.
        const visibility =
          layer.id === activeLayerIdRef.current ? "visible" : "none";
        if (layer.kind === "vector") {
          addProtomapsBasemap(map, visibility);
          return;
        }
        map.addSource(layer.id, {
          type: "raster",
          tiles: layer.tiles,
          tileSize: 256,
          ...(layer.maxzoom != null && { maxzoom: layer.maxzoom }),
          attribution: layer.attribution,
        });
        map.addLayer({
          id: layer.id,
          type: "raster",
          source: layer.id,
          layout: { visibility },
        });
      });

      map.addSource(WORLDWIDE_TERRAIN_SOURCE, {
        type: "raster-dem",
        // The worldwide source in shared/src/demSources.ts. The NSW one is
        // added when 3D is switched on over NSW: see terrainSource.ts.
        tiles: [TERRARIUM.urlTemplate],
        encoding: "terrarium",
        attribution: TERRARIUM.creditHtml,
      });

      map.addSource("places", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Place track (GPX/KML) line source + layer. Added before the place
      // circle markers so the markers paint on top and stay clickable. Hidden
      // until the "Place Tracks" layer is toggled on.
      map.addSource("place-tracks", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // Invisible click/hover target, as `routes-hit` is for a route: a track
      // line opens its page, with the same verbs as its row.
      map.addLayer({
        id: "place-tracks-hit",
        type: "line",
        source: "place-tracks",
        layout: {
          visibility: "none",
          "line-cap": "round",
          "line-join": "round",
        },
        paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 18 },
      });
      map.addLayer({
        id: "place-tracks-lines",
        type: "line",
        source: "place-tracks",
        layout: {
          visibility: "none",
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": [
            "coalesce",
            ["get", "color"],
            readCssVar("--color-accent", "#3b82f6"),
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 2, 14, 4],
          "line-opacity": 0.9,
        },
      });

      // Standalone files: the user's own imports and the tracks Logjam GPS
      // recorded. Same source/layer shape as place-tracks — a different origin
      // for the list, the same line on the map. No zoom floor, for the same
      // reason place tracks have none: a track file is the thing you came to
      // look at, not incidental detail. Visibility is the list itself (an
      // untoggled file is not in the source), so this layer stays visible.
      map.addSource("standalone-tracks", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "standalone-tracks-hit",
        type: "line",
        source: "standalone-tracks",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 18 },
      });
      map.addLayer({
        id: "standalone-tracks-lines",
        type: "line",
        source: "standalone-tracks",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "coalesce",
            ["get", "color"],
            readCssVar("--color-accent", "#3b82f6"),
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 2, 14, 4],
          "line-opacity": 0.9,
        },
      });

      // User-authored routes. Same treatment as place-tracks (below the
      // markers so pins stay clickable), but the geometry is already in hand —
      // no per-feature fetch. Hidden until the "Ways" layer is toggled on.
      map.addSource("routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // The direction arrows ride their own source: one line per segment, which
      // is what keeps an arrow off the join between two of them. A separate
      // source rather than a filter on this one, because `routes` is also the
      // click target and nothing there should have to know about arrows.
      map.addSource("routes-arrows", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // Invisible click/hover target. A 3px line is a near-pixel-precision
      // gesture; this widens the hit area without widening what you see, which
      // is the standard MapLibre answer. Beneath the visible line so it can
      // never tint it.
      // Saved routes are local detail — a state-wide view of them is a smear of
      // lines, not information — so every routes-* layer drops out below zoom
      // SAVED_ROUTE_MIN_ZOOM. The hit target carries the same floor as the line
      // targets: a clickable line you cannot see is a click that does nothing.
      // The route being drawn/edited lives on route-draft and is never hidden.
      map.addLayer({
        id: "routes-hit",
        type: "line",
        source: "routes",
        minzoom: SAVED_ROUTE_MIN_ZOOM,
        layout: {
          visibility: "none",
          "line-cap": "round",
          "line-join": "round",
        },
        paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 18 },
      });
      map.addLayer({
        id: "routes-lines",
        type: "line",
        source: "routes",
        minzoom: SAVED_ROUTE_MIN_ZOOM,
        layout: {
          visibility: "none",
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 2, 14, 4],
          "line-opacity": 0.9,
        },
      });
      // Direction of travel, as arrowheads riding the line itself. Symbol
      // placement does the spacing and rotation natively — hand-placed markers
      // would have to be recomputed on every pan. Spaced generously so a
      // screenful of routes doesn't turn into a hedge.
      //
      // An SDF image, not a glyph. A font glyph's ink sits low in its advance
      // box: MapLibre centres a line-placed symbol on the box, so the arrow
      // would ride below the line, and with keep-upright off the error swaps
      // sides wherever a route doubles back — which reads as arrows wobbling
      // rather than as an offset. Logjam GPS and Logjam Web share the
      // arrowhead and its centring test in @logjam/shared
      // (shared/src/routeArrow.test.ts).
      map.addLayer({
        id: "routes-direction",
        type: "symbol",
        source: "routes-arrows",
        minzoom: ROUTE_ARROW_MIN_ZOOM,
        layout: {
          visibility: "none",
          "symbol-placement": "line",
          "symbol-spacing": 90,
          "icon-image": ROUTE_ARROW_IMAGE,
          "icon-size": ROUTE_ARROW_ICON_SIZE,
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-keep-upright": false,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": ["get", "color"],
          "icon-halo-color": "#ffffff",
          "icon-halo-width": 1,
          "icon-opacity": 0.9,
        },
      });

      // The route being drawn or edited. Dashed, so an unsaved line never
      // reads as a saved one, and unpinned above the saved routes.
      const initialDraftColor =
        drawColor || readCssVar("--color-accent", "#3b82f6");
      map.addSource("route-draft", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // SOLID. A route is a thing you are making; the measure tool's dotted
      // line is a thing you are asking (the `measuring` effect below).
      map.addLayer({
        id: "route-draft-line",
        type: "line",
        source: "route-draft",
        // The per-segment arrow features share this source; drawing them here
        // too would paint the line twice, joining each segment with two round
        // caps instead of one line-join — a notch on every tight corner.
        filter: ["!=", ["get", "kind"], ARROW_FEATURE_KIND],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": initialDraftColor,
          "line-width": 3,
        },
      });
      map.addLayer({
        id: "route-draft-direction",
        type: "symbol",
        source: "route-draft",
        filter: ["==", ["get", "kind"], ARROW_FEATURE_KIND],
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 90,
          "icon-image": ROUTE_ARROW_IMAGE,
          "icon-size": ROUTE_ARROW_ICON_SIZE,
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-keep-upright": false,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": initialDraftColor,
          "icon-halo-color": "#ffffff",
          "icon-halo-width": 1,
        },
      });
      // Ends read differently from the middle: START is filled, END is hollow
      // with a heavier ring. A hint at which way the line runs, not a badge —
      // the arrows above carry the direction, this just tells the two ends
      // apart when you are dragging one of them.
      map.addLayer({
        id: "route-draft-vertices",
        type: "circle",
        source: "route-draft",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["match", ["get", "role"], "middle", 4, 5.5],
          "circle-color": [
            "match",
            ["get", "role"],
            "start",
            initialDraftColor,
            "#ffffff",
          ],
          "circle-stroke-width": ["match", ["get", "role"], "middle", 2, 2.5],
          "circle-stroke-color": initialDraftColor,
        },
      });

      map.addSource("shared-places", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // The pin of the Places row under the pointer, lit from underneath.
      for (const [id, source] of [
        ["place-highlight", "places"],
        ["shared-place-highlight", "shared-places"],
      ] as const) {
        map.addLayer({
          id,
          type: "circle",
          source,
          filter: ["==", ["get", "id"], ""],
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              12,
              14,
              18,
            ],
            "circle-color": readCssVar("--color-accent", "#deb188"),
            "circle-opacity": 0.35,
            "circle-stroke-color": readCssVar("--color-accent", "#deb188"),
            "circle-stroke-width": 2,
          },
        });
      }

      map.addLayer({
        id: "place-circles",
        type: "circle",
        source: "places",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 4, 14, 10],
          "circle-color": PLACE_TYPE_COLORS[0],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });

      // The ring around a shared place, 2px clear of its pin. Also what keeps a
      // shared place reachable: your own copy of it sits on the SAME coordinate
      // and draws on top, so without the ring nothing of it shows or takes a
      // click. Transparent fill, so it adds no mass of its own.
      map.addLayer({
        id: "shared-place-halos",
        type: "circle",
        source: "shared-places",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            7.5,
            14,
            13.5,
          ],
          "circle-opacity": 0,
          "circle-stroke-color": SHARED_PLACE_COLOR,
          "circle-stroke-width": 1.5,
        },
      });

      map.addLayer({
        id: "shared-place-circles",
        type: "circle",
        source: "shared-places",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 4, 14, 10],
          "circle-color": readCssVar("--color-accent", "#3b82f6"),
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });

      map.addLayer({
        id: "place-labels",
        type: "symbol",
        source: "places",
        minzoom: MAP_LABEL_MIN_ZOOM,
        layout: {
          "text-field": PLACE_LABEL_FIELD,
          "text-font": ["Noto Sans Medium"],
          "text-size": 12,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
        },
        paint: {
          "text-color": MAP_INK.label,
          "text-halo-color": MAP_INK.casing,
          "text-halo-width": 1.5,
        },
      });

      map.addLayer({
        id: "shared-place-labels",
        type: "symbol",
        source: "shared-places",
        minzoom: MAP_LABEL_MIN_ZOOM,
        layout: {
          "text-field": PLACE_LABEL_FIELD,
          "text-font": ["Noto Sans Medium"],
          "text-size": 12,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
        },
        paint: {
          "text-color": MAP_INK.label,
          "text-halo-color": MAP_INK.casing,
          "text-halo-width": 1.5,
        },
      });

      applyPlaceThemePaint(map);

      map.addSource("gauges", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // One colour for every gauge: a drop says where a gauge is, never what
      // it read. A gauge with no recent reading is only fainter.
      map.addLayer(
        {
          id: GAUGE_LAYER,
          type: "symbol",
          source: "gauges",
          layout: {
            visibility: "none",
            "icon-image": GAUGE_ICON_IMAGE,
            "icon-size": GAUGE_ICON_SIZE,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            "icon-color": MAP_INK.gauge,
            "icon-opacity": ["case", ["get", "recent"], 1, 0.35],
            "icon-halo-color": MAP_INK.ring,
            "icon-halo-width": 1.5,
          },
        },
        GAUGE_BELOW,
      );
      // Under the pins, so a place's own name wins any collision with one.
      map.addLayer(
        {
          id: GAUGE_LABELS,
          type: "symbol",
          source: "gauges",
          minzoom: MAP_LABEL_MIN_ZOOM,
          layout: {
            visibility: "none",
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Medium"],
            "text-size": 12,
            "text-max-width": 10,
            "text-offset": [0, 1.2],
            "text-anchor": "top",
          },
          paint: {
            "text-color": MAP_INK.label,
            "text-halo-color": MAP_INK.casing,
            "text-halo-width": 1.5,
          },
        },
        GAUGE_BELOW,
      );
      map.on("click", GAUGE_LAYER, (e) => {
        if (pickModeRef.current || drawingRouteRef.current) return;
        const id = pressedGaugeId(map, [e.point.x, e.point.y]);
        if (
          id &&
          !pressClosedGauge(id, closedGaugeRef.current, performance.now())
        )
          setGaugeId(id);
      });
      map.on("mouseenter", GAUGE_LAYER, () => {
        if (pickModeRef.current) return;
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", GAUGE_LAYER, () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("click", "place-circles", (e) => {
        if (pickModeRef.current) return;
        if (!e.features?.length) return;
        const feature = e.features[0];
        const id = feature.properties?.id as string;
        if (feature.geometry.type !== "Point") return;
        selectPlaceRef.current(id);
      });

      // One registration over both layers, so a press on the pin (which is
      // inside the ring) selects once rather than once per layer.
      map.on("click", ["shared-place-halos", "shared-place-circles"], (e) => {
        if (pickModeRef.current) return;
        if (!e.features?.length) return;
        const feature = e.features[0];
        const id = feature.properties?.id as string;
        if (feature.geometry.type !== "Point") return;
        selectPlaceRef.current(id);
      });

      map.on("mouseenter", "place-circles", () => {
        if (pickModeRef.current) return;
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "place-circles", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on(
        "mouseenter",
        ["shared-place-halos", "shared-place-circles"],
        () => {
          if (pickModeRef.current) return;
          map.getCanvas().style.cursor = "pointer";
        },
      );
      map.on(
        "mouseleave",
        ["shared-place-halos", "shared-place-circles"],
        () => {
          map.getCanvas().style.cursor = "";
        },
      );

      setLoaded({ map, geolocate });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      // Reset mapLoaded so the place update effect re-runs when the map
      // reinitialises (required in React Strict Mode, which mounts twice).
      setLoaded(null);
    };
  }, []);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current;
    const onThemeChange = () => {
      applyPlaceThemePaint(map);
    };

    window.addEventListener("logjam-theme-change", onThemeChange);
    return () => {
      window.removeEventListener("logjam-theme-change", onThemeChange);
    };
  }, [mapLoaded]);

  // Fire onMapViewChange on load and after every pan/zoom so the dialog always
  // has the current map centre for extent initialisation.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    const fireViewChange = () => {
      const c = map.getCenter();
      onMapViewChangeRef.current?.({
        lat: c.lat,
        lng: c.lng,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
      // `getBounds` returns the axis-aligned box around the view, so a rotated
      // or pitched map reports MORE ground than is on screen. "Filter to the
      // current view" is a coarse convenience, and reporting slightly more than
      // is visible errs towards keeping places rather than hiding them.
      const bounds = map.getBounds();
      onMapBoundsChangeRef.current?.({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      });
    };

    fireViewChange(); // report initial centre immediately on load
    map.on("moveend", fireViewChange);
    return () => {
      map.off("moveend", fireViewChange);
    };
  }, [mapLoaded]);

  // Update place GeoJSON when data or filters change
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const typeColor = new globalThis.Map(
      placeTypes.map((type) => [type.id, type.color]),
    );
    const toFeatureCollection = (list: TPlace[], isOwned: boolean) => ({
      type: "FeatureCollection" as const,
      features: list.map((c) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [c.longitude, c.latitude],
        },
        properties: {
          id: c.id,
          name: c.name,
          done: isPlaceDoneByViewer(c, isOwned),
          color: typeColor.get(c.placeTypeId) ?? null,
        },
      })),
    });

    const ownedSource = mapRef.current.getSource(
      "places",
    ) as maplibregl.GeoJSONSource;
    if (ownedSource) {
      ownedSource.setData(
        toFeatureCollection(
          places.filter((c) => passesFilters(c, filters, true)),
          true,
        ),
      );
    }

    const sharedSource = mapRef.current.getSource(
      "shared-places",
    ) as maplibregl.GeoJSONSource;
    if (sharedSource) {
      sharedSource.setData(
        toFeatureCollection(
          sharedPlaces.filter((c) => passesFilters(c, filters, false)),
          false,
        ),
      );
    }
  }, [places, sharedPlaces, filters, mapLoaded, placeTypes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    return placeHighlight.subscribe((id) => {
      for (const layerId of ["place-highlight", "shared-place-highlight"]) {
        map.setFilter(layerId, ["==", ["get", "id"], id ?? ""]);
      }
    });
  }, [placeHighlight, mapLoaded]);

  // Fetch + parse place track files into the line layer when enabled. Parsing
  // is client-side (the API never echoes track contents — privacy rule); parsed
  // GeoJSON is cached by mediaId so toggling/re-renders don't refetch.
  // Keyed by mediaId. Plain object (not a JS Map) — `Map` is this component's name.
  // The cache holds PROMISES, not resolved values, so overlapping effect runs
  // (StrictMode double-invoke, rapid toggles) share one in-flight request
  // instead of each firing its own fetch (preventing duplicate fetches). Failures
  // resolve to null and stay cached, so a missing track file is fetched once
  // per session instead of retried on every load/toggle.
  //
  // The cached `url` is stored alongside each promise: `track.displayUrl` is a
  // PRESIGNED URL that rotates on refetch (e.g. after the old one expires and
  // the place media reloads). Keying only by mediaId would pin a stale/expired
  // URL forever, so one 403 would never retry even once a fresh working URL
  // arrives. On lookup we discard the entry when the URL has rotated; same-URL
  // failures stay cached (no retry spam).
  const trackGeoCacheRef = useRef<
    Record<
      string,
      { url: string; promise: Promise<GeoJSON.FeatureCollection | null> }
    >
  >({});
  // Media ids whose load failure was already surfaced — one toast per track
  // per session, not one per re-render.
  const failedTrackToastedRef = useRef<Set<string>>(new Set());

  // Fetch + parse a set of track files into features for one of the track
  // layers. Shared by both: a place's attached track and a standalone file are
  // the same file treated the same way, differing only in the id stamped on
  // the features and in which source the caller drops them.
  const loadTrackSource = useCallback(
    async (
      entries: {
        mediaId: string;
        color: string | null;
        displayUrl: string;
        stamp: Record<string, string>;
      }[],
      failureMessage: string,
    ): Promise<GeoJSON.Feature[]> => {
      const cache = trackGeoCacheRef.current;
      const collections = await Promise.all(
        entries.map((entry) => {
          // Keyed by id, colour AND stamp: a standalone file LINKED to a place
          // appears in both lists with different stamps, and one cache entry
          // per key keeps each layer's features stamped for its own layer.
          const cacheKey = trackGeoCacheKey(entry);
          let cached = cache[cacheKey];
          // Discard a cached entry whose presigned URL has rotated so the fresh
          // URL retries; same-URL failures stay cached.
          if (!cached || cached.url !== entry.displayUrl) {
            const promise = fetchTrackGeoJSON(
              entry.mediaId,
              entry.displayUrl,
              entry.color,
              entry.stamp,
            ).catch((err: unknown) => {
              // One bad track blanks only itself. Safe to log: the thrown
              // error carries the HTTP status, not the presigned URL whose
              // filename is the place's name (trackGeo.test.ts).
              console.error(err);
              if (!failedTrackToastedRef.current.has(entry.mediaId)) {
                failedTrackToastedRef.current.add(entry.mediaId);
                toast.error(messageFromError(err, failureMessage));
              }
              return null;
            });
            cached = { url: entry.displayUrl, promise };
            cache[cacheKey] = cached;
          }
          return cached.promise;
        }),
      );
      return collections.flatMap((fc) => (fc ? fc.features : []));
    },
    [toast],
  );

  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !showWays) return;
    let cancelled = false;
    void (async () => {
      const features = await loadTrackSource(
        placeTracks.map((track) => ({
          mediaId: track.mediaId,
          color: track.color,
          displayUrl: track.displayUrl,
          stamp: { placeId: track.placeId, mediaId: track.mediaId },
        })),
        "Couldn't load a place track file.",
      );
      if (cancelled) return;
      const source = mapRef.current?.getSource("place-tracks") as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData({ type: "FeatureCollection", features });
    })();
    return () => {
      cancelled = true;
    };
  }, [showWays, placeTracks, mapLoaded, loadTrackSource]);

  // Standalone files. The list is the visibility: whatever the user has toggled
  // on is what gets fetched and drawn.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    let cancelled = false;
    void (async () => {
      const features = await loadTrackSource(
        standaloneTracks.map((track) => ({
          mediaId: track.mediaId,
          color: track.color,
          displayUrl: track.displayUrl,
          stamp: { mediaId: track.mediaId },
        })),
        "Couldn't load one of your files.",
      );
      if (cancelled) return;
      const source = mapRef.current?.getSource("standalone-tracks") as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData({ type: "FeatureCollection", features });
    })();
    return () => {
      cancelled = true;
    };
  }, [standaloneTracks, mapLoaded, loadTrackSource]);

  // "What is here?": a press on EMPTY map asks (no tool armed and no pin, line
  // or feature under it), a right-click asks wherever it lands, and Enter on
  // the focused map asks about the middle of what is visible. The panel is
  // drawn by `MapPointPopover`; this only decides when it is asked.
  //
  // A tap asks and a press-and-hold commits (shared/DESIGN.md §3), so nothing
  // here writes anything: its verbs hand off to flows that confirm for
  // themselves.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    // Everything on the map that has a press of its own.
    const PRESSABLE = [...PRESSABLE_LAYERS, GAUGE_LAYER];
    // Long enough for a double-click to zoom without a panel flashing up.
    const SINGLE_PRESS_MS = 250;
    // Pressing the panel's own dismissal and the map in one gesture.
    const JUST_CLOSED_MS = 300;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => {
      if (pending) clearTimeout(pending);
      pending = null;
    };
    const armed = () => pickModeRef.current || drawingRouteRef.current;
    const ask = (latitude: number, longitude: number) =>
      setAsked({
        point: { latitude, longitude },
        from: userFixRef.current,
      });

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (armed() || Date.now() - askedClosedAt.current < JUST_CLOSED_MS)
        return;
      const layers = PRESSABLE.filter((id) => map.getLayer(id));
      if (map.queryRenderedFeatures(e.point, { layers }).length > 0) return;
      cancel();
      const { lat, lng } = e.lngLat;
      pending = setTimeout(() => {
        pending = null;
        ask(lat, lng);
      }, SINGLE_PRESS_MS);
    };
    const onContextMenu = (e: maplibregl.MapMouseEvent) => {
      if (armed()) return;
      e.originalEvent.preventDefault();
      cancel();
      ask(e.lngLat.lat, e.lngLat.lng);
    };
    // Enter on the focused map is a press on the middle of it: it asks what is
    // there, or, with a drawing tool armed, places the next point there. With
    // the arrow keys panning, that is either tool without a pointer.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || pickModeRef.current) return;
      event.preventDefault();
      // The middle of the map the user can SEE: the page and its sheet cover
      // the left of the canvas, and their widths are the layout's tokens.
      const root = getComputedStyle(document.documentElement);
      const width = (name: string) =>
        Number.parseFloat(root.getPropertyValue(name)) || 0;
      const narrow = window.innerWidth <= MOBILE_MAX_WIDTH_PX;
      const inset = narrow
        ? 0
        : (panelOpenRef.current ? width("--panel-width") : 0) +
          (sheetOpenRef.current ? width("--filter-sheet-width") : 0);
      const box = map.getContainer().getBoundingClientRect();
      const centre = map.unproject([
        inset + (box.width - inset) / 2,
        box.height / 2,
      ]);
      if (drawingRouteRef.current) placeDrawPointRef.current(centre);
      else ask(centre.lat, centre.lng);
    };
    const canvas = map.getCanvas();
    map.on("click", onClick);
    map.on("dblclick", cancel);
    map.on("movestart", cancel);
    map.on("contextmenu", onContextMenu);
    canvas.addEventListener("keydown", onKeyDown);
    return () => {
      cancel();
      map.off("click", onClick);
      map.off("dblclick", cancel);
      map.off("movestart", cancel);
      map.off("contextmenu", onContextMenu);
      canvas.removeEventListener("keydown", onKeyDown);
    };
  }, [mapLoaded]);

  // Coordinate picking mode
  const onCoordsPickedRef = useRef(onCoordsPicked);
  useEffect(() => {
    onCoordsPickedRef.current = onCoordsPicked;
  }, [onCoordsPicked]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    if (pickingCoords) {
      map.getCanvas().style.cursor = "crosshair";
      const handleClick = (e: maplibregl.MapMouseEvent) => {
        onCoordsPickedRef.current(e.lngLat.lat, e.lngLat.lng);
      };
      map.once("click", handleClick);
      return () => {
        map.getCanvas().style.cursor = "";
        map.off("click", handleClick);
      };
    } else {
      map.getCanvas().style.cursor = "";
    }
  }, [pickingCoords, mapLoaded]);

  // Toggle place layer visibility
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const vis = (show: boolean) => (show ? "visible" : "none");
    mapRef.current.setLayoutProperty(
      "place-circles",
      "visibility",
      vis(showPlaces),
    );
    mapRef.current.setLayoutProperty(
      "place-labels",
      "visibility",
      vis(showPlaces),
    );
    mapRef.current.setLayoutProperty(
      "shared-place-halos",
      "visibility",
      vis(showPlaces),
    );
    mapRef.current.setLayoutProperty(
      "shared-place-circles",
      "visibility",
      vis(showPlaces),
    );
    mapRef.current.setLayoutProperty(
      "shared-place-labels",
      "visibility",
      vis(showPlaces),
    );
    // "Ways" draws EVERY line, wherever it came from: routes drawn here, files
    // imported or recorded, and the tracks on places friends shared. One
    // toggle for all of them, because they are one kind of thing; whose each
    // one is shows on the line, not in the legend.
    //
    // The route being drawn stays visible even with the layer off — hiding your
    // own in-progress work would read as the tool being broken.
    for (const id of [
      "place-tracks-hit",
      "place-tracks-lines",
      "routes-hit",
      "routes-lines",
      "routes-direction",
      "standalone-tracks-hit",
      "standalone-tracks-lines",
    ]) {
      mapRef.current.setLayoutProperty(
        id,
        "visibility",
        vis(showWays || (drawingRoute && !measuring)),
      );
    }
  }, [showPlaces, showWays, drawingRoute, measuring, mapLoaded]);

  // The river gauge drops, drawn from the file while the layer is on.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    for (const id of [GAUGE_LAYER, GAUGE_LABELS])
      map.setLayoutProperty(id, "visibility", showGauges ? "visible" : "none");
    const now = Date.now();
    (map.getSource("gauges") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (gaugeFile?.gauges ?? []).map((g) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [g.lon, g.lat] },
        properties: {
          id: g.id,
          name: gaugeDisplayName(g.name),
          recent: latestGaugeReading(g, now) !== null,
        },
      })),
    });
  }, [showGauges, gaugeFile, mapLoaded]);

  // Push saved routes to the map. No fetch/parse step: geometry is inline.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const source = mapRef.current.getSource("routes") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    // The route being edited is drawn by the draft layer instead, so it isn't
    // painted twice (and stale) underneath the handles.
    const drawn = routes.filter((route) => route.id !== editingRouteId);
    source.setData({
      type: "FeatureCollection",
      features: drawn.map((route) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: route.points },
        properties: { id: route.id, name: route.name, color: route.color },
      })),
    });

    const arrows = mapRef.current.getSource("routes-arrows") as
      | maplibregl.GeoJSONSource
      | undefined;
    arrows?.setData({
      type: "FeatureCollection",
      features: drawn.flatMap(
        (route) =>
          arrowSegmentFeatures(route.points, {
            color: route.color,
          }) as GeoJSON.Feature[],
      ),
    });
  }, [routes, mapLoaded, editingRouteId]);

  // Draw/edit mode: click appends a vertex. Follows the coord-pick idiom
  // (crosshair cursor, handler torn down on exit), except the listener is
  // `on` rather than `once` — a route is many clicks, not one.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !drawingRoute) return;
    const map = mapRef.current;
    map.getCanvas().style.cursor = "crosshair";
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      // A click that landed on a vertex handle belongs to that handle (move or
      // remove), not to the map. stopPropagation on the handle is not enough:
      // MapLibre binds its own listener on the container ahead of the marker's,
      // so the map saw the click first and appended a point on top of the one
      // the user was trying to delete.
      if (Date.now() - handlePressedAt.current < HANDLE_CLICK_SUPPRESS_MS)
        return;
      placeDrawPointRef.current(e.lngLat);
    };
    map.on("click", handleClick);
    return () => {
      map.getCanvas().style.cursor = "";
      map.off("click", handleClick);
    };
  }, [drawingRoute, mapLoaded]);

  // Draft geometry: the line plus a point per vertex. Mirrors measureShape on
  // mobile — the line only exists once there are two ends.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const source = mapRef.current.getSource("route-draft") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData(
      drawingRoute
        ? draftFeatureCollection(drawPoints, drawAnchorIndices)
        : { type: "FeatureCollection", features: [] },
    );
  }, [drawPoints, drawAnchorIndices, drawingRoute, mapLoaded]);

  // A measurement is the same draft drawn DOTTED and without direction arrows:
  // a route is a thing you are making, a measurement a thing you are asking,
  // and it has no way it runs.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    if (!map.getLayer("route-draft-line")) return;
    map.setPaintProperty(
      "route-draft-line",
      "line-dasharray",
      // Round caps turn a near-zero dash into a dot.
      measuring ? [0.1, 2] : undefined,
    );
    map.setLayoutProperty(
      "route-draft-direction",
      "visibility",
      measuring ? "none" : "visible",
    );
  }, [measuring, mapLoaded]);

  // Update route draft colors dynamically when drawColor changes.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const effectiveColor = drawColor || readCssVar("--color-accent", "#3b82f6");
    if (map.getLayer("route-draft-line")) {
      map.setPaintProperty("route-draft-line", "line-color", effectiveColor);
    }
    if (map.getLayer("route-draft-direction")) {
      map.setPaintProperty(
        "route-draft-direction",
        "icon-color",
        effectiveColor,
      );
    }
    if (map.getLayer("route-draft-vertices")) {
      map.setPaintProperty(
        "route-draft-vertices",
        "circle-stroke-color",
        effectiveColor,
      );
      map.setPaintProperty("route-draft-vertices", "circle-color", [
        "match",
        ["get", "role"],
        "start",
        effectiveColor,
        "#ffffff",
      ]);
    }
  }, [drawColor, mapLoaded]);

  // Draggable vertex handles. MapLibre markers do the drag maths natively, so
  // this only has to keep one marker per vertex alive and report the drop.
  const vertexMarkersRef = useRef<maplibregl.Marker[]>([]);
  // `snapBetweenRef` requests are fire-and-forget network reads. If
  // one lands while the user is mid-drag of a handle, drawPoints/drawAnchorIndices
  // change and this effect's deps fire — tearing every marker down (including
  // the one under the user's finger) kills the native drag before `dragend`
  // ever runs (Marker.remove() unbinds the map's mousemove/mouseup listeners).
  // Set true on any handle's dragstart, cleared on its dragend; both the
  // rebuild body and the previous run's own cleanup check it before touching
  // the DOM markers, so an in-flight drag survives an async snap landing.
  // `dragend` itself commits a state change that re-fires this effect once
  // the gesture ends, performing the now-safe rebuild with fresh data.
  const draggingVertexRef = useRef(false);
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    if (draggingVertexRef.current) return;
    const map = mapRef.current;
    // Rebuild wholesale: the vertex count changes on nearly every gesture, and
    // a handful of markers is far cheaper than diffing them.
    for (const marker of vertexMarkersRef.current) marker.remove();
    vertexMarkersRef.current = [];
    if (!drawingRoute) return;

    // ONE HANDLE PER ANCHOR. Snapped filler gets none: it is geometry the tool
    // produced, not points the user placed, so a 1.5 km snapped run reads as
    // one segment with two ends rather than fifty draggable dots.
    drawAnchorIndices.forEach((pointIndex, anchorIndex) => {
      const point = drawPoints[pointIndex];
      if (!point) return;
      const el = document.createElement("div");
      el.className = classes.routeVertexHandle;
      el.title = "Drag to move · click to remove";
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(point)
        .addTo(map);
      // Delete rides an explicit click listener on the handle's own element,
      // NOT a zero-distance drag: MapLibre does not reliably run the drag
      // lifecycle for a plain click, so a click on a handle fell through to the
      // map and appended a point instead of removing one. stopPropagation is
      // what keeps it from reaching the map's own click handler.
      let movedDuringDrag = false;
      el.addEventListener("mousedown", () => {
        handlePressedAt.current = Date.now();
      });
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        handlePressedAt.current = Date.now();
        // A drag ends with a click too; only a click that moved nothing means
        // "remove this point".
        if (movedDuringDrag) {
          movedDuringDrag = false;
          return;
        }
        onDrawPointDeleteRef.current(anchorIndex);
      });
      marker.on("dragstart", () => {
        movedDuringDrag = false;
        draggingVertexRef.current = true;
      });
      // Repaint the line under the cursor on every frame. The preview is built
      // with the same `moveAnchor` the drop commits, so what you drag is
      // exactly what lands.
      marker.on("drag", () => {
        movedDuringDrag = true;
        const { lng, lat } = marker.getLngLat();
        previewDraft(
          map,
          moveAnchor(draftRef.current, anchorIndex, [lng, lat]),
        );
      });
      marker.on("dragend", () => {
        draggingVertexRef.current = false;
        handlePressedAt.current = Date.now();
        if (!movedDuringDrag) return;
        const { lng, lat } = marker.getLngLat();
        const moved: RoutePoint = [lng, lat];
        // Read the neighbours BEFORE committing — the commit is async through
        // React state, and their own coordinates don't change either way.
        const { anchors } = draftRef.current;
        const before = anchors[anchorIndex - 1];
        const after = anchors[anchorIndex + 1];
        onDrawPointMoveRef.current(anchorIndex, moved);
        // moveAnchor straightens both segments touching the anchor, so both
        // need re-snapping — a middle anchor has two. On drop, not per frame:
        // a drag is hundreds of frames and each one is an archive read.
        if (before) snapBetweenRef.current(before, moved);
        if (after) snapBetweenRef.current(moved, after);
      });
      vertexMarkersRef.current.push(marker);
    });

    return () => {
      // Skip teardown while a drag is active (see comment above the ref) —
      // otherwise this cleanup, registered before the drag even started,
      // still runs unconditionally the moment an async snap changes drawPoints.
      if (draggingVertexRef.current) return;
      for (const marker of vertexMarkersRef.current) marker.remove();
      vertexMarkersRef.current = [];
    };
  }, [drawPoints, drawAnchorIndices, drawingRoute, mapLoaded]);

  // Drag the drawn line between two anchors to introduce one there. Distinct
  // from clicking the map, which appends to the END of the route — this is how
  // you add detail to a segment you already placed.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !drawingRoute) return;
    const map = mapRef.current;
    // Where the press started, so a CLICK can be told from a DRAG. Without
    // this the gesture fired on any press near the line — and a vertex handle
    // sits exactly on the line, so clicking a handle to delete it inserted a
    // point instead.
    // `base` is the draft as it stood when the press began: every preview frame
    // inserts into THAT, so the new anchor is placed once and merely follows the
    // cursor rather than accumulating one insert per frame. `inserting` flips
    // when the press passes the drag threshold — until then it is still a click.
    let dragging: {
      segmentIndex: number;
      startX: number;
      startY: number;
      base: RouteDraft;
      inserting: boolean;
    } | null = null;

    // Grab radius in pixels, converted to degrees at the current zoom so the
    // hit test feels the same however far you are zoomed in.
    const GRAB_PIXELS = 12;
    function toleranceDegrees(): number {
      const centre = map.getCenter();
      const a = map.project(centre);
      const b = map.unproject([a.x + GRAB_PIXELS, a.y]);
      return Math.abs(b.lng - centre.lng);
    }

    const onDown = (e: maplibregl.MapMouseEvent) => {
      // A press that landed on a vertex handle belongs to that handle.
      if (Date.now() - handlePressedAt.current < HANDLE_CLICK_SUPPRESS_MS)
        return;
      const near = nearestSegment(draftRef.current, [
        e.lngLat.lng,
        e.lngLat.lat,
      ]);
      if (!near || near.distanceDegrees > toleranceDegrees()) return;
      // Take the gesture off the map so the drag doesn't pan it.
      e.preventDefault();
      dragging = {
        segmentIndex: near.index,
        startX: e.point.x,
        startY: e.point.y,
        base: draftRef.current,
        inserting: false,
      };
      map.getCanvas().style.cursor = "grabbing";
    };

    // Live preview, same as dragging an existing handle: the anchor appears as
    // soon as the press becomes a drag and the line tracks the cursor from
    // there. Committing per frame instead would push an undo entry per pixel.
    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (!dragging) return;
      // Only a press that actually travelled is a drag. A click on the line is
      // not a request for a new point.
      if (
        !dragging.inserting &&
        Math.hypot(e.point.x - dragging.startX, e.point.y - dragging.startY) <
          DRAG_INSERT_MIN_PIXELS
      ) {
        return;
      }
      dragging.inserting = true;
      previewDraft(
        map,
        insertAnchor(dragging.base, dragging.segmentIndex, [
          e.lngLat.lng,
          e.lngLat.lat,
        ]),
      );
    };

    const onUp = (e: maplibregl.MapMouseEvent) => {
      if (!dragging) return;
      const { segmentIndex, base, inserting } = dragging;
      dragging = null;
      map.getCanvas().style.cursor = "crosshair";
      if (!inserting) return;
      const inserted: RoutePoint = [e.lngLat.lng, e.lngLat.lat];
      onDrawPointInsertRef.current(segmentIndex, inserted);
      // insertAnchor splits the segment into two straight halves, exactly as
      // moveAnchor straightens the two either side of a moved handle — so both
      // need the same re-snap on drop that a handle drop does.
      const before = base.anchors[segmentIndex];
      const after = base.anchors[segmentIndex + 1];
      if (before) snapBetweenRef.current(before, inserted);
      if (after) snapBetweenRef.current(inserted, after);
    };

    map.on("mousedown", onDown);
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    return () => {
      map.off("mousedown", onDown);
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
    };
  }, [drawingRoute, mapLoaded]);

  // Click a route line to open its detail panel — suppressed while a pick or
  // draw mode owns the click. Bound to the invisible buffer layer, not the
  // drawn line, so the target is a fingertip rather than three pixels.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const handleClick = (
      e: maplibregl.MapMouseEvent & {
        features?: maplibregl.MapGeoJSONFeature[];
      },
    ) => {
      if (pickModeRef.current || drawingRouteRef.current) return;
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") selectRouteRef.current(id);
    };
    // The pointer only changes over something that is actually clickable.
    const handleEnter = () => {
      if (pickModeRef.current || drawingRouteRef.current) return;
      map.getCanvas().style.cursor = "pointer";
    };
    const handleLeave = () => {
      if (pickModeRef.current || drawingRouteRef.current) return;
      map.getCanvas().style.cursor = "";
    };
    const handleTrackClick = (
      e: maplibregl.MapMouseEvent & {
        features?: maplibregl.MapGeoJSONFeature[];
      },
    ) => {
      if (pickModeRef.current || drawingRouteRef.current) return;
      const id = e.features?.[0]?.properties?.mediaId;
      if (typeof id === "string") selectTrackRef.current(id);
    };
    const hitLayers = [
      "routes-hit",
      "place-tracks-hit",
      "standalone-tracks-hit",
    ];
    for (const layer of hitLayers) {
      map.on(
        "click",
        layer,
        layer === "routes-hit" ? handleClick : handleTrackClick,
      );
      map.on("mouseenter", layer, handleEnter);
      map.on("mouseleave", layer, handleLeave);
    }
    return () => {
      for (const layer of hitLayers) {
        map.off(
          "click",
          layer,
          layer === "routes-hit" ? handleClick : handleTrackClick,
        );
        map.off("mouseenter", layer, handleEnter);
        map.off("mouseleave", layer, handleLeave);
      }
    };
  }, [mapLoaded]);

  // Where the elevation profile's cursor sits along the line being read.
  //
  // TWO rules meet here, and only both together make the drag smooth. It is
  // SUBSCRIBED rather than a prop, so a pointer moving many times a second does
  // not re-render App, this component and the panel before the dot can move.
  // And it is a MARKER rather than a GeoJSON source, because `setData`
  // invalidates the source and MapLibre repaints the entire canvas for one dot:
  // measured at 72ms per pointer move, against 16ms for the same drag with the
  // write removed — the same cost as dragging over dead panel. A Marker is a
  // DOM node the library moves with a CSS transform; the canvas is untouched.
  // (DESIGN.md, which also records the three wrong guesses that preceded
  // this one.)
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const element = document.createElement("div");
    element.className = classes.hoverDot;
    const marker = new maplibregl.Marker({ element });
    let attached = false;
    const unsubscribe = routeHover.subscribe((hover) => {
      if (!hover) {
        if (attached) {
          marker.remove();
          attached = false;
        }
        return;
      }
      element.style.setProperty(
        "--dot",
        hover.color ?? readCssVar("--color-accent", "#3b82f6"),
      );
      marker.setLngLat(hover.position);
      if (!attached) {
        marker.addTo(map);
        attached = true;
      }
    });
    return () => {
      unsubscribe();
      marker.remove();
    };
  }, [routeHover, mapLoaded]);

  // Toggle base layer visibility
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    BASE_LAYERS.forEach((layer) => {
      const visibility = layer.id === activeLayerId ? "visible" : "none";
      if (layer.kind === "vector") {
        // The vector basemap is a band of ~70 layers, not one — toggling the
        // source id alone would silently do nothing.
        for (const id of protomapsLayerIds(map)) {
          map.setLayoutProperty(id, "visibility", visibility);
        }
        return;
      }
      map.setLayoutProperty(layer.id, "visibility", visibility);
    });
  }, [activeLayerId, mapLoaded]);

  // Topo bbox selection mode (rubber-band draw -> returns a lat/lng bbox).
  // useBoxDraw keeps the latest onBox itself, so an inline arrow is fine.
  useBoxDraw({
    map: drawableMap,
    enabled: selectingBbox ?? false,
    onBox: (bbox) => onBboxSelected?.(bbox),
  });

  // The Places filter's area. Same gesture, same helper; it differs from the
  // topo picker only in who receives the box.
  useBoxDraw({
    map: drawableMap,
    enabled: selectingFilterArea ?? false,
    onBox: (bbox) => onFilterAreaSelected?.(bbox),
  });

  // Lazily register the route arrowhead. MapLibre fires `styleimagemissing`
  // when a symbol layer references an icon-image that isn't loaded yet; this
  // avoids any ordering coupling with the route layers.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const onMissing = (e: { id: string }) => {
      const id = e.id;
      // The route arrowhead. Registered as an SDF, which is what lets ONE image
      // take each route's own colour through `icon-color` — a plain bitmap
      // ignores the tint and every route would share one arrow colour.
      const sdfUri =
        id === ROUTE_ARROW_IMAGE
          ? ROUTE_ARROW_SDF_URI
          : id === GAUGE_ICON_IMAGE
            ? GAUGE_ICON_SDF_URI
            : null;
      if (sdfUri) {
        if (map.hasImage(id)) return;
        const arrow = new Image();
        arrow.onload = () => {
          if (map.hasImage(id)) return;
          // Decode to raw RGBA here rather than handing MapLibre the element.
          // An SDF carries its distance field in the ALPHA channel and the
          // shader thresholds it; passing an HTMLImageElement leaves that
          // decode to the browser's image pipeline, so the arrows would render
          // as plain white triangles with the route line showing through their
          // soft edge without applying the tint.
          const canvas = document.createElement("canvas");
          canvas.width = arrow.naturalWidth;
          canvas.height = arrow.naturalHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(arrow, 0, 0);
          const { width, height, data } = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          map.addImage(
            id,
            { width, height, data: new Uint8Array(data) },
            { sdf: true },
          );
        };
        arrow.src = sdfUri;
        return;
      }
    };
    map.on("styleimagemissing", onMissing);
    return () => {
      map.off("styleimagemissing", onMissing);
    };
  }, [mapLoaded]);

  // Topo overlay layers (PMTiles — raster and vector): adds and removes
  // sources/layers when the layer set changes.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const layers = topoLayers ?? [];
    const vs = nswContourStyle(activeLayerId);

    // Skip if the layer set is unchanged (avoids flicker from
    // new array references with identical contents).
    // Over the vector basemap the Terrain group goes inside it, under its roads
    // and labels (shared TERRAIN_BASEMAP_ANCHORS). Every other topo layer, and
    // the group over a raster basemap, stacks over the basemap, under the routes.
    const inBasemap =
      BASE_LAYERS.find((b) => b.id === activeLayerId)?.kind === "vector";
    const topoKey =
      layers.map((l) => `${l.id}:${l.pmtilesUrl}`).join("|") + "::" + inBasemap;
    if (topoKey === prevTopoKeyRef.current) return;
    prevTopoKeyRef.current = topoKey;

    // Map each entry id → the set of MapLibre layer ids it owns
    const activeIds = new Set(layers.map((l) => l.id));

    // Recoverable blacklist: when a failed entry's toggle turns off it leaves
    // `layers`, so drop it from the failed/transient sets. Re-enabling it should
    // RETRY the source (a genuinely-missing archive will just fail terminally
    // again) rather than stay permanently blacklisted from a past error.
    for (const failedId of [...failedTopoSourcesRef.current]) {
      if (!activeIds.has(failedId))
        failedTopoSourcesRef.current.delete(failedId);
    }
    for (const transientId of [...transientTopoSourcesRef.current]) {
      if (!activeIds.has(transientId)) {
        transientTopoSourcesRef.current.delete(transientId);
      }
    }

    // Helper: get all MapLibre layer ids owned by a topo entry id
    const ownedLayerIds = (entryId: string): string[] =>
      map
        .getStyle()
        .layers.map((l) => l.id)
        .filter((lid) => lid.startsWith(`topo-${entryId}-`));

    // Remove layers/sources no longer in topoLayers.
    const allTopoLayerIds = map
      .getStyle()
      .layers.map((l) => l.id)
      .filter((lid) => lid.startsWith("topo-"));
    for (const lid of allTopoLayerIds) {
      // Extract entry id: "topo-<entryId>-<suffix>"
      const withoutPrefix = lid.replace(/^topo-/, "");
      const dashIdx = withoutPrefix.indexOf("-");
      if (dashIdx < 0) continue;
      const entryId = withoutPrefix.slice(0, dashIdx);
      if (!activeIds.has(entryId) && map.getLayer(lid)) map.removeLayer(lid);
    }
    // Remove orphaned sources
    for (const entryId of [
      ...(map.getStyle().sources ? Object.keys(map.getStyle().sources) : []),
    ]) {
      if (entryId.startsWith("topo-src-")) {
        const id = entryId.replace("topo-src-", "");
        if (!activeIds.has(id)) {
          map.removeSource(entryId);
        }
      }
    }

    // Add sources + layers for new entries
    layers.forEach(({ id, pmtilesUrl, format, attribution, tiles }) => {
      // Known-missing source (PMTiles load already failed this session) — do
      // not re-add it on layer toggles, or the 404 retry spam returns.
      if (failedTopoSourcesRef.current.has(id)) return;
      const srcId = `topo-src-${id}`;
      const fmt = format ?? "raster";
      // A Terrain source made for another set of areas (or for none) has the
      // wrong zooms and holds tiles from the wrong archives: rebuild it.
      if (TERRAIN_LAYER_KEYS.some((key) => TERRAIN_ENTRIES[key].id === id)) {
        const reads = tiles?.template ?? pmtilesUrl;
        const before = terrainSourceFromRef.current.get(srcId);
        if (before !== undefined && before !== reads && map.getSource(srcId)) {
          for (const lid of ownedLayerIds(id))
            if (map.getLayer(lid)) map.removeLayer(lid);
          map.removeSource(srcId);
        }
        terrainSourceFromRef.current.set(srcId, reads);
      }
      // An archive's own TileJSON, or the router's tiles with its zooms.
      const from = tiles
        ? {
            tiles: [tiles.template],
            minzoom: tiles.minzoom,
            maxzoom: tiles.maxzoom,
            bounds: [...tiles.bounds] as [number, number, number, number],
          }
        : { url: `pmtiles://${pmtilesUrl}` };

      if (fmt === "slope" || fmt === "hillshade") {
        if (!map.getSource(srcId)) {
          map.addSource(srcId, {
            type: "raster-dem",
            ...from,
            tileSize: 256,
            encoding: "terrarium",
            attribution,
          });
        }
        const layerId = `topo-${id}-dem`;
        if (!map.getLayer(layerId)) {
          map.addLayer(
            fmt === "slope"
              ? {
                  id: layerId,
                  type: "color-relief",
                  source: srcId,
                  paint: {
                    "color-relief-color": slopeReliefColor(
                      slopeBandsRef.current ?? [],
                    ) as maplibregl.ExpressionSpecification,
                  },
                }
              : { id: layerId, type: "hillshade", source: srcId },
          );
        }
        return;
      }

      if (!map.getSource(srcId)) {
        if (fmt === "raster") {
          map.addSource(srcId, {
            type: "raster",
            url: `pmtiles://${pmtilesUrl}`,
            tileSize: 256,
            attribution,
          });
        } else {
          map.addSource(srcId, {
            type: "vector",
            ...from,
            attribution,
          });
        }
      }

      if (fmt === "land") {
        if (!map.getLayer(LAND_FILL_LAYER)) {
          map.addLayer({
            id: LAND_FILL_LAYER,
            type: "fill",
            source: srcId,
            "source-layer": NSW_LAND.sourceLayer,
            paint: {
              "fill-color": landColor() as maplibregl.ExpressionSpecification,
              "fill-opacity":
                landFillOpacity() as maplibregl.ExpressionSpecification,
              // Tiles join in the middle of a holding, and an antialiased edge
              // there would draw the tile grid across the tint.
              "fill-antialias": false,
            },
          });
        }
        LAND_EDGE_LINES.forEach(({ width, offset, blur, opacity }, i) => {
          if (map.getLayer(`${LAND_EDGE_LAYER}-${i}`)) return;
          map.addLayer({
            id: `${LAND_EDGE_LAYER}-${i}`,
            type: "line",
            source: srcId,
            "source-layer": NSW_LAND.sourceLayer,
            minzoom: LAND_EDGE_MINZOOM,
            paint: {
              "line-color": landColor() as maplibregl.ExpressionSpecification,
              "line-width": width,
              "line-offset": offset,
              "line-blur": blur,
              "line-opacity": landEdgeOpacity(
                opacity,
              ) as maplibregl.ExpressionSpecification,
            },
          });
        });
        return;
      }

      if (fmt === "raster") {
        const layerId = `topo-${id}-raster`;
        if (!map.getLayer(layerId)) {
          map.addLayer({
            id: layerId,
            type: "raster",
            source: srcId,
            paint: { "raster-opacity": 1, "raster-resampling": "nearest" },
          });
        }
      } else {
        // The only vector entry is the statewide contours.
        // Minor contours (5m + 10m): elevation not divisible by 50
        const minorId = `topo-${id}-minor`;
        if (!map.getLayer(minorId)) {
          map.addLayer({
            id: minorId,
            type: "line",
            source: srcId,
            "source-layer": "contours",
            filter: ["!=", ["%", ["to-number", ["get", "elev"]], 50], 0],
            minzoom: 14,
          });
        }
        // Major contours (50m): elevation divisible by 50
        const majorId = `topo-${id}-major`;
        if (!map.getLayer(majorId)) {
          map.addLayer({
            id: majorId,
            type: "line",
            source: srcId,
            "source-layer": "contours",
            filter: ["==", ["%", ["to-number", ["get", "elev"]], 50], 0],
          });
        }
        // Elevation labels on major contours at z12+
        const labelsId = `topo-${id}-labels`;
        if (!map.getLayer(labelsId)) {
          map.addLayer({
            id: labelsId,
            type: "symbol",
            source: srcId,
            "source-layer": "contours",
            filter: ["==", ["%", ["to-number", ["get", "elev"]], 50], 0],
            minzoom: 12,
            layout: {
              "text-field": ["concat", ["to-string", ["get", "elev"]], "m"],
              "text-font": ["Noto Sans Medium"],
              "text-size": labelTextSizeExpr(vs.labelScale ?? 1),
              "symbol-placement": "line",
              // LAZ-derived contours are VERY knobbly — even 90° left few
              // placement spots until z18, then labels flooded in at once. The
              // real fix is smoothing the geometry in the topo pipeline; until
              // then 150° lets labels place along the wiggly runs at low zoom
              // (they follow the curve, so they read a little jagged). Bump the
              // pipeline-side smoothing if this looks too messy.
              "text-max-angle": 150,
            },
            paint: {
              "text-halo-color": "rgba(255, 255, 255, 0.8)",
              "text-halo-width": 1.5,
            },
          });
        }
      }
    });

    // Paint freshly created (or rebuilt) layers with the current style so they
    // never flash a default colour before the paint effect runs.
    if (layers.some(({ id }) => id === TERRAIN_ENTRIES.contours.id))
      applyContourPaint(map, TERRAIN_ENTRIES.contours.id, vs);

    // In the topoLayers order, each entry's layers as a group.
    stackTopoLayers(
      map,
      layers.map(({ id }) => ownedLayerIds(id)),
    );
    if (inBasemap)
      moveTerrainIntoBasemap(
        map,
        Object.fromEntries(
          TERRAIN_LAYER_KEYS.map((key) => [
            key,
            ownedLayerIds(TERRAIN_ENTRIES[key].id),
          ]),
        ) as Record<TerrainLayerKey, string[]>,
        PROTOMAPS_LAYER_PREFIX,
      );
  }, [topoLayers, mapLoaded, activeLayerId]);

  // The contours' look follows the basemap: a paint change, never a new layer.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    if ((topoLayers ?? []).some(({ id }) => id === TERRAIN_ENTRIES.contours.id))
      applyContourPaint(
        mapRef.current,
        TERRAIN_ENTRIES.contours.id,
        nswContourStyle(activeLayerId),
      );
  }, [topoLayers, mapLoaded, activeLayerId]);

  // The slope bands, live, the same way: a paint change, never a new layer.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    for (const { id, format } of topoLayers ?? []) {
      const layerId = `topo-${id}-dem`;
      if (format === "slope" && map.getLayer(layerId))
        map.setPaintProperty(
          layerId,
          "color-relief-color",
          slopeReliefColor(
            slopeBands ?? [],
          ) as maplibregl.ExpressionSpecification,
        );
    }
  }, [topoLayers, slopeBands, mapLoaded]);

  // Fly to a topo job's bbox when requested from App.tsx
  const onTopoFlyConsumedRef = useRef(onTopoFlyConsumed);
  useEffect(() => {
    onTopoFlyConsumedRef.current = onTopoFlyConsumed;
  }, [onTopoFlyConsumed]);

  useEffect(() => {
    if (!topoFlyTarget || !mapLoaded || !mapRef.current) return;
    const pairs = collectLngLatPairs(topoFlyTarget.coordinates).filter(
      ([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat),
    );
    if (pairs.length === 0) {
      // No usable coordinates (empty/malformed footprint) — consume the request
      // so it doesn't get retried, but don't fly into a NaN bounds.
      console.warn(
        "topoFlyTarget had no valid coordinates",
        topoFlyTarget.type,
      );
      onTopoFlyConsumedRef.current?.();
      return;
    }
    const lngs = pairs.map((p) => p[0]);
    const lats = pairs.map((p) => p[1]);
    mapRef.current.fitBounds(
      [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ],
      { padding: 80, duration: 1200 },
    );
    onTopoFlyConsumedRef.current?.();
  }, [topoFlyTarget, mapLoaded]);

  const onFlyToBoundsConsumedRef = useRef(onFlyToBoundsConsumed);
  useEffect(() => {
    onFlyToBoundsConsumedRef.current = onFlyToBoundsConsumed;
  }, [onFlyToBoundsConsumed]);

  // A way's extent, fitted rather than centred: a line has a length, and
  // dropping the camera on its midpoint at a fixed zoom shows either a fraction
  // of it or a great deal of nothing. Same padding as the topo footprint fly.
  useEffect(() => {
    if (!flyToBounds || !mapLoaded || !mapRef.current) return;
    const [west, south, east, north] = flyToBounds;
    if ([west, south, east, north].every((value) => Number.isFinite(value))) {
      mapRef.current.fitBounds([west, south, east, north], {
        padding: 80,
        duration: 1200,
        maxZoom: 16,
      });
    } else {
      // Never the coordinates themselves (privacy rule) — just that it was skipped.
      console.warn("Skipping fit-to-way: bounds out of range");
    }
    onFlyToBoundsConsumedRef.current?.();
  }, [flyToBounds, mapLoaded]);

  const onFlyToPlaceConsumedRef = useRef(onFlyToPlaceConsumed);
  useEffect(() => {
    onFlyToPlaceConsumedRef.current = onFlyToPlaceConsumed;
  }, [onFlyToPlaceConsumed]);

  useEffect(() => {
    if (!flyToPlace || !mapLoaded || !mapRef.current) return;
    // Defensive guard: an out-of-range record must not crash Logjam Web.
    // MapLibre's flyTo throws "Invalid LngLat" for lat outside [-90,90] (or
    // lng outside [-180,180]), which would escape to the RootErrorBoundary
    // and make the record unmanageable — you couldn't even open it to fix or
    // delete it. Skip the fly-to (still selecting the place) so the detail
    // panel opens and the record can be edited/deleted. Validation blocks
    // such records at creation (@logjam/shared placeValidation.test.ts); this
    // covers any that already exist.
    if (isValidLatitude(flyToPlace.lat) && isValidLongitude(flyToPlace.lng)) {
      mapRef.current.flyTo({
        center: [flyToPlace.lng, flyToPlace.lat],
        zoom: 16,
        duration: 1500,
      });
    } else {
      // The warning names no coordinate: they are the place's.
      console.warn("Skipping fly-to: place coordinates out of range");
    }
    onFlyToPlaceConsumedRef.current?.();
  }, [flyToPlace, mapLoaded]);

  // GeoPDF extent selection: ref for overlay rectangle
  const geoPdfFrameRef = useRef<HTMLDivElement>(null);

  // Refs used to detect whether the user has moved the map since extent
  // selection activated. If they haven't, we return the initial extent exactly
  // (rather than re-deriving it via unproject, which introduces floating-point drift).
  const geoPdfInitialExtentRef = useRef<TBbox | undefined>(undefined);
  const geoPdfInitialScaleRef = useRef<number | undefined>(undefined);
  const geoPdfPaperDimensionsRef = useRef<{ w: number; h: number }>({
    w: 210,
    h: 297,
  });
  const geoPdfFitBoundsSettledRef = useRef(false);
  const geoPdfUserPannedRef = useRef(false);
  const geoPdfUserZoomedRef = useRef(false);

  // Set once the opening fit has landed the frame where its CSS size and the
  // kept scale agree, or once Keep is ticked (it keeps the scale of the frame
  // as it is); from then on a kept scale sizes it. Sizing during the opening
  // ease would pop the frame to the old zoom's size and shrink it back.
  const geoPdfFrameMeasuredRef = useRef(false);

  // The scale the frame is held at, so zooming changes how big the frame
  // looks and not the scale; or null, when the frame stays put on screen and
  // zooming changes the scale (geoPdfFrame.ts).
  const [geoPdfKeptScale, setGeoPdfKeptScale] = useState<number | null>(null);
  const [geoPdfKeptScaleFor, setGeoPdfKeptScaleFor] = useState(false);
  if ((selectingGeoPdfExtent ?? false) !== geoPdfKeptScaleFor) {
    setGeoPdfKeptScaleFor(selectingGeoPdfExtent ?? false);
    if (selectingGeoPdfExtent)
      setGeoPdfKeptScale(keptScaleOnEntry(geoPdfInitialScale));
  }
  // The scale read out on the Keep checkbox. Written on every map move, so
  // straight to the DOM: through state it would re-render this whole
  // component each frame (frontend/DESIGN.md, Performance).
  const geoPdfScaleTextRef = useRef<HTMLSpanElement>(null);

  // When extent selection activates: position the map so the on-screen frame
  // visually matches the initial extent (or scale × paper) — that way the
  // dashed rectangle the user sees is exactly the geographic area they'll get.
  useEffect(() => {
    if (!selectingGeoPdfExtent) {
      geoPdfInitialExtentRef.current = undefined;
      geoPdfFitBoundsSettledRef.current = false;
      geoPdfFrameMeasuredRef.current = false;
      geoPdfUserPannedRef.current = false;
      geoPdfUserZoomedRef.current = false;
      return;
    }

    geoPdfInitialExtentRef.current = geoPdfInitialExtent;
    geoPdfInitialScaleRef.current = geoPdfInitialScale;
    geoPdfPaperDimensionsRef.current = geoPdfPaperDimensions ?? {
      w: 210,
      h: 297,
    };
    geoPdfFitBoundsSettledRef.current = false;
    geoPdfFrameMeasuredRef.current = false;
    geoPdfUserPannedRef.current = false;
    geoPdfUserZoomedRef.current = false;

    const map = mapRef.current;
    if (!map) {
      geoPdfFitBoundsSettledRef.current = true;
      geoPdfFrameMeasuredRef.current = true;
      return;
    }

    // Determine the geographic centre and target width (metres) we want the
    // on-screen frame to represent.
    let targetCenter: [number, number];
    let targetWidthM: number;
    if (geoPdfInitialExtent) {
      const cLat = (geoPdfInitialExtent.north + geoPdfInitialExtent.south) / 2;
      const cLng = (geoPdfInitialExtent.east + geoPdfInitialExtent.west) / 2;
      targetCenter = [cLng, cLat];
      targetWidthM =
        (geoPdfInitialExtent.east - geoPdfInitialExtent.west) *
        111320 *
        Math.cos((cLat * Math.PI) / 180);
    } else if (geoPdfInitialScale && geoPdfPaperDimensions) {
      const c = map.getCenter();
      targetCenter = [c.lng, c.lat];
      targetWidthM = geoPdfInitialScale * (geoPdfPaperDimensions.w / 1000);
    } else {
      geoPdfFitBoundsSettledRef.current = true;
      geoPdfFrameMeasuredRef.current = true;
      return;
    }

    // Wait one frame so the frame element is in the DOM and measurable.
    let stopWaiting = () => {};
    const rafId = requestAnimationFrame(() => {
      const frameEl = geoPdfFrameRef.current;
      const m = mapRef.current;
      if (!frameEl || !m) {
        geoPdfFitBoundsSettledRef.current = true;
        geoPdfFrameMeasuredRef.current = true;
        return;
      }
      const framePxW = frameEl.getBoundingClientRect().width;
      if (framePxW <= 0) {
        geoPdfFitBoundsSettledRef.current = true;
        geoPdfFrameMeasuredRef.current = true;
        return;
      }

      // The zoom at which metersPerPixel × framePxW = targetWidthM.
      const targetZoom = Math.log2(
        metersPerPixel(targetCenter[1], 0) / (targetWidthM / framePxW),
      );

      m.easeTo({
        center: targetCenter,
        zoom: targetZoom,
        duration: 600,
      });

      stopWaiting = afterEase(m, () => {
        geoPdfFitBoundsSettledRef.current = true;
        geoPdfFrameMeasuredRef.current = true;
      });
    });

    return () => {
      cancelAnimationFrame(rafId);
      stopWaiting();
    };
  }, [
    selectingGeoPdfExtent,
    geoPdfInitialExtent,
    geoPdfInitialScale,
    geoPdfPaperDimensions,
  ]);

  // Track user-initiated map movement during extent selection.
  useEffect(() => {
    if (!selectingGeoPdfExtent || !mapRef.current) return;
    const map = mapRef.current;
    const onPanStart = () => {
      // Only count panning that occurs after fitBounds has settled.
      if (geoPdfFitBoundsSettledRef.current) {
        geoPdfUserPannedRef.current = true;
      }
    };
    const onZoomStart = () => {
      // Only count zooming that occurs after fitBounds has settled.
      if (geoPdfFitBoundsSettledRef.current) {
        geoPdfUserZoomedRef.current = true;
      }
    };
    map.on("movestart", onPanStart);
    map.on("zoomstart", onZoomStart);
    return () => {
      map.off("movestart", onPanStart);
      map.off("zoomstart", onZoomStart);
    };
  }, [selectingGeoPdfExtent]);

  const onGeoPdfExtentConfirmedRef = useRef(onGeoPdfExtentConfirmed);
  useEffect(() => {
    onGeoPdfExtentConfirmedRef.current = onGeoPdfExtentConfirmed;
  }, [onGeoPdfExtentConfirmed]);

  const geoPdfPick = useCallback(
    (): FramePick => ({
      kept: geoPdfKeptScale,
      initialScale: geoPdfInitialScaleRef.current,
      initialExtent: geoPdfInitialExtentRef.current,
      zoomed: geoPdfUserZoomedRef.current,
    }),
    [geoPdfKeptScale],
  );

  // The frame's ground width at its vertical centre, over the paper's width.
  const measureGeoPdfScale = useCallback((): number | null => {
    const map = mapRef.current;
    const frame = geoPdfFrameRef.current;
    const container = containerRef.current;
    if (!map || !frame || !container) return null;
    const mapRect = container.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const centerY = (frameRect.top + frameRect.bottom) / 2 - mapRect.top;
    const leftMid = map.unproject([frameRect.left - mapRect.left, centerY]);
    const rightMid = map.unproject([frameRect.right - mapRect.left, centerY]);
    const METERS_PER_DEG_LON_EQUATOR = 111320;
    const geoWidthM =
      (rightMid.lng - leftMid.lng) *
      METERS_PER_DEG_LON_EQUATOR *
      Math.cos(((leftMid.lat + rightMid.lat) / 2) * (Math.PI / 180));
    return geoWidthM / (geoPdfPaperDimensionsRef.current.w / 1000);
  }, []);

  // While a scale is kept, the frame is sized from it on every move, once
  // geoPdfFrameMeasuredRef allows. Unkept, the frame keeps whatever size it has, so letting go
  // of the scale never jumps the frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!selectingGeoPdfExtent || !map) return;
    const update = () => {
      const frame = geoPdfFrameRef.current;
      if (frame && geoPdfKeptScale !== null && geoPdfFrameMeasuredRef.current) {
        const px = keptFrameSizePx(
          geoPdfKeptScale,
          geoPdfPaperDimensionsRef.current,
          map.getZoom(),
          map.getCenter().lat,
        );
        frame.style.width = `${px.w}px`;
        frame.style.height = `${px.h}px`;
      }
      const scale = scaleNow(geoPdfPick(), measureGeoPdfScale);
      if (geoPdfScaleTextRef.current && scale !== null)
        geoPdfScaleTextRef.current.textContent =
          Math.round(scale).toLocaleString();
    };
    update();
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [selectingGeoPdfExtent, geoPdfKeptScale, geoPdfPick, measureGeoPdfScale]);

  const setGeoPdfKeepScale = (keep: boolean) => {
    const pick = geoPdfPick();
    if (keep) {
      const scale = keepScale(pick, measureGeoPdfScale);
      if (scale === null) return;
      geoPdfFrameMeasuredRef.current = true;
      setGeoPdfKeptScale(scale);
      return;
    }
    if (pick.kept === null) return;
    const next = letGo(
      { ...pick, kept: pick.kept },
      mapRef.current?.isZooming() ?? false,
    );
    geoPdfInitialScaleRef.current = next.initialScale;
    geoPdfInitialExtentRef.current = next.initialExtent;
    geoPdfUserZoomedRef.current = next.zoomed;
    setGeoPdfKeptScale(null);
  };

  const handleConfirmGeoPdfExtent = useCallback(() => {
    if (!mapRef.current || !geoPdfFrameRef.current || !containerRef.current)
      return;

    const pick = geoPdfPick();
    const unmoved = unmovedPick(pick, geoPdfUserPannedRef.current);
    if (unmoved) {
      onGeoPdfExtentConfirmedRef.current?.(unmoved.extent, unmoved.scale);
      return;
    }

    const map = mapRef.current;
    const mapRect = containerRef.current.getBoundingClientRect();
    const frameRect = geoPdfFrameRef.current.getBoundingClientRect();

    // Always unproject only the center of the frame — this is the one
    // coordinate we trust from the projection, avoiding the trapezoid
    // distortion that comes from unprojecting all four corners independently.
    const centerX = (frameRect.left + frameRect.right) / 2 - mapRect.left;
    const centerY = (frameRect.top + frameRect.bottom) / 2 - mapRect.top;
    const center = map.unproject([centerX, centerY]);
    const scale = scaleNow(pick, measureGeoPdfScale);
    if (scale === null) return;

    // Compute a consistent extent from center + scale + paper dimensions.
    const paper = geoPdfPaperDimensionsRef.current;
    const widthM = scale * (paper.w / 1000);
    const heightM = scale * (paper.h / 1000);
    const bounds = extentFromCentreAndSize(
      center.lat,
      center.lng,
      widthM,
      heightM,
    );

    onGeoPdfExtentConfirmedRef.current?.(bounds, scale);
  }, [geoPdfPick, measureGeoPdfScale]);

  // Toggle 3d Terrain
  // Choosing the terrain source is asynchronous, and the answer applies only
  // if no toggle has happened since it was asked for. A count, not a flag: off
  // then on again looks the same to a flag, and an answer from the first "on"
  // would replace the terrain the second one chose somewhere else.
  const terrainToggleRef = useRef(0);
  const sharpenedAreasRef = useRef(sharpenedAreas ?? []);
  useEffect(() => {
    sharpenedAreasRef.current = sharpenedAreas ?? [];
  }, [sharpenedAreas]);
  // Set on switching 3D on, cleared when the tilt runs, so a change of areas
  // before the map goes idle still tilts.
  const pendingTiltRef = useRef(false);
  const applyTerrainNow = (map: maplibregl.Map, toggle: number) => {
    const tilt = pendingTiltRef.current
      ? () => {
          pendingTiltRef.current = false;
          map.easeTo({ pitch: 30, duration: 1200 });
        }
      : undefined;
    void applyTerrain(
      map,
      sharpenedAreasRef.current,
      async (url) => {
        const archive = new PMTiles(url);
        await archive.getHeader();
        // Hand the opened archive to the protocol, so it is not opened twice.
        pmtilesProtocol.add(archive);
      },
      window.location.origin,
      // The map may have been removed, or 3D toggled, while this waited.
      () => toggle === terrainToggleRef.current && mapRef.current === map,
      tilt,
    );
  };
  // A change of areas while 3D is on draws terrain again from the new set:
  // `useTerrainReapply.test.ts` (the trigger) and `terrainSource.test.ts`
  // ("applyTerrain": the new source, the old one removed).
  useTerrainReapply(areasKey(sharpenedAreas ?? []), is3D, () => {
    const map = mapRef.current;
    if (map) applyTerrainNow(map, ++terrainToggleRef.current);
  });
  const toggleTerrain = () => {
    const map = mapRef.current;
    if (!map) return;
    const toggle = ++terrainToggleRef.current;
    if (is3D) {
      // Turning off — nothing to wait for, flatten immediately
      pendingTiltRef.current = false;
      map.setTerrain(null);
      map.setMaxPitch(0);
      map.touchPitch.disable();
      map.easeTo({ pitch: 0, duration: 1000 });
    } else {
      // Toast to inform user about movement controls in 3D mode
      if (window.matchMedia("(pointer: coarse)").matches) {
        toast.info("Use two fingers to pan and pinch to zoom in 3D mode.");
      } else {
        toast.info(
          "Use right-click + drag (OR Ctrl + drag) to pan and scroll to zoom in 3D mode.",
        );
      }
      map.setMaxPitch(60);
      map.touchPitch.enable();
      pendingTiltRef.current = true;
      applyTerrainNow(map, toggle);
    }

    setIs3D(!is3D);
  };

  return (
    <div
      id="map"
      className={classes.map}
      data-panel-open={panelOpen}
      data-sheet-open={sheetOpen}
    >
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      <MapChrome
        map={drawableMap}
        geolocate={loaded?.geolocate ?? null}
        is3D={is3D}
        onToggle3D={toggleTerrain}
        layersButton={layersButton}
        tools={mapTools}
        notices={notices}
        search={
          // Always available, including during pick modes for a quick fly-to.
          <MapSearchBox
            places={places}
            sharedPlaces={sharedPlaces}
            onSelectPlace={(place) => {
              selectPlaceRef.current(place.id);
            }}
            onSelectGauge={(gauge) => {
              onShowGauges();
              // After the flight: a gauge's panel closes when the map moves.
              mapRef.current?.once("moveend", () => setGaugeId(gauge.id));
              mapRef.current?.flyTo({
                center: [gauge.lon, gauge.lat],
                zoom: 13,
                duration: 1200,
              });
            }}
            onSelectLocation={(lat, lon) =>
              mapRef.current?.flyTo({
                center: [lon, lat],
                zoom: 13,
                duration: 1200,
              })
            }
          />
        }
      />
      {asked && drawableMap && (
        <MapPointPopover
          key={`${asked.point.latitude},${asked.point.longitude}`}
          map={drawableMap}
          point={asked.point}
          from={asked.from}
          onClose={closeAsked}
          onAddPlace={onAddPlaceAt}
          onMeasure={onMeasureFrom}
        />
      )}
      {openGauge && gaugeFile && drawableMap && showGauges && (
        <GaugePopover
          key={`${openGauge.id}:${gaugeFile.generatedAt}`}
          map={drawableMap}
          gauge={openGauge}
          attribution={gaugeFile.attribution}
          generatedAt={gaugeFile.generatedAt}
          onClose={closeGauge}
        />
      )}
      <GaugeLoadNotice
        failed={gaugesFailed}
        modeActive={
          pickingCoords ||
          selectingBbox ||
          selectingGeoPdfExtent ||
          drawingRoute
        }
        className={classes.pickBanner}
      />
      {pickingCoords && (
        <>
          <div className={classes.pickBanner}>
            <Notice>{pickVerb} the map to select a location</Notice>
          </div>
          <div className={classes.geoPdfConfirmBar}>
            <Button onClick={onCancelPickCoords}>Cancel</Button>
          </div>
        </>
      )}
      {selectingBbox && (
        <div className={classes.pickBanner}>
          <Notice>
            {pickVerb} to set a corner, then {pickVerb.toLowerCase()} again to
            define the area
          </Notice>
        </div>
      )}
      {selectingBbox && onBboxCancelled && (
        <div className={classes.geoPdfConfirmBar}>
          <Button onClick={onBboxCancelled}>Cancel</Button>
        </div>
      )}
      {selectingGeoPdfExtent && (
        <>
          <div className={classes.pickBanner}>
            <Notice>
              {geoPdfKeptScale !== null
                ? "Drag the map to place the area"
                : "Pan and zoom the map to fit the area"}
            </Notice>
          </div>
          <div
            ref={geoPdfFrameRef}
            className={classes.geoPdfOverlayFrame}
            style={{ aspectRatio: `${geoPdfPaperAspect ?? 210 / 297}` }}
          />
          <div className={classes.geoPdfConfirmBar}>
            <Checkbox
              card
              label={
                <>
                  Keep 1:
                  <span ref={geoPdfScaleTextRef} />
                </>
              }
              checked={geoPdfKeptScale !== null}
              onChange={setGeoPdfKeepScale}
            />
            <Button variant="filled" onClick={handleConfirmGeoPdfExtent}>
              Confirm area
            </Button>
            <Button onClick={onGeoPdfExtentCancelled}>Cancel</Button>
          </div>
        </>
      )}
    </div>
  );
}

export default Map;
