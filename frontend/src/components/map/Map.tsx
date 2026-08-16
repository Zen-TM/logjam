import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl, { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker?url";

// Use the pre-built CSP worker instead of the default inline blob worker.
// Vite's production minification can corrupt the blob worker code, causing
// "on is not defined" errors and breaking GeoJSON source processing.
setWorkerUrl(maplibreWorkerUrl);
import { Protocol } from "pmtiles";
import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import {
  draftAnchorIndices,
  draftPoints,
  fetchSnapLines,
  insertAnchor,
  moveAnchor,
  nearestSegment,
  snapSegment,
  type RouteDraft,
  type RoutePoint,
  type SnapMode,
} from "@logjam/shared";

export type { SnapMode };

// Register PMTiles protocol for serving topo overlay layers from S3
const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile.bind(pmtilesProtocol));

// Decide whether a MapLibre source error means the PMTiles archive is
// DEFINITIVELY gone (tear the overlay down + blacklist it) versus a transient
// blip we should let MapLibre retry (LAYERS-1). MapLibre fires "error" for ANY
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
import { useMediaQuery } from "@mui/material";
import classes from "./Map.module.css";
import MapSearchBox from "./MapSearchBox";
import { MOBILE_MAX_WIDTH_PX } from "../../useIsMobile";
import type {
  TCanyon,
  TFilters,
  CanyonTrack,
  TRoute,
  TWaypoint,
} from "../../canyonUtils";
import type { GeoJsonPolygonal } from "../../topoLayerTypes";
import { passesFilters, isCanyonDoneByViewer } from "../../canyonUtils";
import { fetchTrackGeoJSON } from "../media/trackGeo";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import {
  BASEMAP_CATALOG,
  extentFromCentreAndSize,
  OSM_LINE_FEATURE_KEYS,
  OSM_POINT_FEATURE_KEYS,
  OSM_POINT_ICON,
  OSM_POINT_ICON_NATURAL_PX,
  iconTargetPx,
  rgbaCssFromHex,
  contourWidthStops,
  featureLineWidthStops,
  DEM_ATTRIBUTION_HTML,
  DEM_TILE_URL_TEMPLATE,
  isValidLatitude,
  isValidLongitude,
  waypointColor,
  type OsmFeatureKey,
  type OsmPointFeatureKey,
  type OsmFeatureStyle,
  type VectorStyleSettings,
} from "@logjam/shared";

// How long after touching a vertex handle the map ignores its own click. Long
// enough to cover the press-release of a deliberate click, short enough that a
// genuine map click straight afterwards still registers.
const HANDLE_CLICK_SUPPRESS_MS = 400;

/** Movement below this is a click, not a drag, so it inserts nothing. */
const DRAG_INSERT_MIN_PIXELS = 6;

/**
 * Zoom below which saved routes stop drawing. 7 is where the route line-width
 * ramp starts and is the app's initial zoom, so a first load still shows them
 * while a state- or continent-wide view isn't hazed over with lines.
 */
// Saved routes vanish below this. z7 is most of NSW — a threshold you had to
// go looking for — where z10 is roughly a 50 km view, past the point a few
// kilometres of route says anything about where it goes.
const ROUTE_MIN_ZOOM = 10;
/** Waypoint names only once the view is local enough to read them. */
const WAYPOINT_LABEL_MIN_ZOOM = 11;

const SIDEBAR_TRANSITION_MS = 300;
const INITIAL_CENTER: [number, number] = [151.2093, -33.8688];
const INITIAL_ZOOM = 7;

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/**
 * Collect every [lng, lat] position out of a GeoJSON geometry's `coordinates`,
 * regardless of nesting depth. A topo footprint is a Polygon for a contiguous
 * capture but a MultiPolygon for a disconnected one — the extra nesting level
 * meant a plain `.flat()` left rings (not positions), so Math.min(...) of arrays
 * produced NaN and fitBounds threw "Invalid LngLat object: (NaN, NaN)". Walking
 * to the numeric leaf pairs handles Polygon, MultiPolygon, and GeometryCollection
 * coordinate shapes alike.
 */
function collectLngLatPairs(node: unknown): [number, number][] {
  if (!Array.isArray(node)) return [];
  if (typeof node[0] === "number" && typeof node[1] === "number") {
    return [[node[0], node[1]]];
  }
  return node.flatMap(collectLngLatPairs);
}

function applyCanyonThemePaint(map: maplibregl.Map) {
  const owned = readCssVar("--owned-canyon-color", "#f97316");
  const completed = readCssVar("--completed-canyon-color", "#22c55e");
  const shared = readCssVar("--shared-canyon-color", "#629bf8");
  const label = readCssVar("--theme-text-primary", "#ffffff");
  const halo = readCssVar("--theme-bonus-2", "#1a1a1a");

  if (map.getLayer("canyon-circles")) {
    // Completed (owned + logged trip) canyons render green; the rest stay orange.
    map.setPaintProperty("canyon-circles", "circle-color", [
      "case",
      ["==", ["get", "done"], true],
      completed,
      owned,
    ]);
  }
  if (map.getLayer("shared-canyon-circles")) {
    map.setPaintProperty("shared-canyon-circles", "circle-color", shared);
  }
  if (map.getLayer("canyon-labels")) {
    map.setPaintProperty("canyon-labels", "text-color", label);
    map.setPaintProperty("canyon-labels", "text-halo-color", halo);
  }
  if (map.getLayer("shared-canyon-labels")) {
    map.setPaintProperty("shared-canyon-labels", "text-color", label);
    map.setPaintProperty("shared-canyon-labels", "text-halo-color", halo);
  }
}

// Protomaps glyph + sprite assets. Mobile vendors these into the app bundle
// because offline regions must render labels with zero network; the web map
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
export const BASE_LAYERS = BASEMAP_CATALOG.map((entry) => ({
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
 * Light flavor only: the web app has no dark theme (index.css carries a single
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

export type TBbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

// ── Vector style helpers ──────────────────────────────────────────────────
// Colour + width math lives in @logjam/shared so the live overlay and the
// GeoPDF canvas renderer stay in lockstep. These thin wrappers adapt the shared
// pure helpers into MapLibre paint expressions.

// Convert #RRGGBBAA → rgba(r,g,b,a) CSS string that MapLibre's paint expressions
// accept.
function rgbaCss(hex: string): string {
  return rgbaCssFromHex(hex);
}

// Pixel width interpolate(z12 → z18) for line features. widthZ18 is the
// reference width in pixels at the maximum-detail zoom.
function lineWidthInterp(widthZ18: number): maplibregl.ExpressionSpecification {
  const { z12, z18 } = featureLineWidthStops(widthZ18);
  return ["interpolate", ["linear"], ["zoom"], 12, z12, 18, z18];
}

// Contour width is specified in ground metres by the user; convert to a pixel
// width via the shared stops (default 18 m → ≈2.25 px, default 8 m → ≈1 px).
function contourPixelWidth(widthM: number): maplibregl.ExpressionSpecification {
  const { z12, z18 } = contourWidthStops(widthM);
  return ["interpolate", ["linear"], ["zoom"], 12, z12, 18, z18];
}

// icon-size for a point category: scale the 24×24 source PNG so its on-screen
// edge ≈ iconTargetPx (mirrors the Python/MBTiles sizing) across z12→z18.
function iconSizeInterp(sizeZ18: number): maplibregl.ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    12,
    iconTargetPx(sizeZ18, 12) / OSM_POINT_ICON_NATURAL_PX,
    18,
    iconTargetPx(sizeZ18, 18) / OSM_POINT_ICON_NATURAL_PX,
  ];
}

// Canyon map labels: ellipsize a name past this length so a pathological
// long name (e.g. a 250-char single token that can't line-wrap) can't render
// as one full-map-width label (CANYON-7). The detail-panel header truncates
// separately via CSS.
const MAX_LABEL_CHARS = 40;
const CANYON_LABEL_FIELD: maplibregl.ExpressionSpecification = [
  "case",
  [">", ["length", ["get", "name"]], MAX_LABEL_CHARS],
  ["concat", ["slice", ["get", "name"], 0, MAX_LABEL_CHARS], "…"],
  ["get", "name"],
];

// Fallback when vectorStyle has not yet loaded — keeps the legacy default look
// rather than rendering invisible layers.
const VECTOR_STYLE_FALLBACK: VectorStyleSettings = {
  contours: {
    majorColour: "#503c28dc",
    minorColour: "#785a3ca0",
    majorWidthM: 18,
    minorWidthM: 8,
  },
  features: {
    waterway:  { enabled: true,  colour: "#2878dcdc", widthZ18: 3 },
    track:     { enabled: true,  colour: "#a0641edc", widthZ18: 2 },
    road:      { enabled: true,  colour: "#505050e6", widthZ18: 4 },
    building:  { enabled: true,  colour: "#a08c78c8", widthZ18: 2 },
    power:     { enabled: true,  colour: "#c8a000c8", widthZ18: 1 },
    campsite:  { enabled: true,  colour: "#00a050e6", widthZ18: 14 },
    peak:      { enabled: true,  colour: "#503214f0", widthZ18: 12 },
    spring:    { enabled: true,  colour: "#1e5ad2e6", widthZ18: 8 },
    gate:      { enabled: true,  colour: "#464646dc", widthZ18: 10 },
    cave:      { enabled: true,  colour: "#3c1e0ae6", widthZ18: 10 },
    bridge:    { enabled: false, colour: "#403028e6", widthZ18: 3 },
    ford:      { enabled: false, colour: "#1e90ffe6", widthZ18: 8 },
    waterfall: { enabled: false, colour: "#1e6ad2f0", widthZ18: 10 },
    trailhead: { enabled: false, colour: "#a04020e6", widthZ18: 12 },
    viewpoint: { enabled: false, colour: "#806020e6", widthZ18: 12 },
    hut:       { enabled: false, colour: "#503820e6", widthZ18: 12 },
  },
  labelScale: 1,
};

const OSM_LINE_KEY_SET = new Set<OsmFeatureKey>(OSM_LINE_FEATURE_KEYS);

function feat(vs: VectorStyleSettings, key: OsmFeatureKey): OsmFeatureStyle {
  return vs.features[key];
}

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

// Apply every user-controllable colour/width to one topo entry's vector layers
// in place via setPaintProperty. This is the single source of the style→paint
// mapping: it's called both when layers are first created (structural effect)
// and on every live VectorStyleSettings change (paint effect), so colour/width
// edits never require dropping and recreating layers. Each set is guarded by
// getLayer, so it's a no-op for a layer that doesn't exist (disabled category,
// raster entry, or not yet created).
function applyVectorPaint(
  map: maplibregl.Map,
  entryId: string,
  isContours: boolean,
  vs: VectorStyleSettings,
): void {
  const setPaint = (
    lid: string,
    prop: string,
    value: string | number | maplibregl.ExpressionSpecification,
  ): void => {
    if (map.getLayer(lid)) map.setPaintProperty(lid, prop, value);
  };
  // text-size is a layout property, not paint. setLayoutProperty triggers a
  // relayout (cheap for the handful of label layers) and never recreates them.
  const sizeExpr = labelTextSizeExpr(vs.labelScale ?? 1);
  const setLabelSize = (lid: string): void => {
    if (map.getLayer(lid)) map.setLayoutProperty(lid, "text-size", sizeExpr);
  };

  if (isContours) {
    setPaint(`topo-${entryId}-minor`, "line-color", rgbaCss(vs.contours.minorColour));
    setPaint(`topo-${entryId}-minor`, "line-width", contourPixelWidth(vs.contours.minorWidthM));
    setPaint(`topo-${entryId}-major`, "line-color", rgbaCss(vs.contours.majorColour));
    setPaint(`topo-${entryId}-major`, "line-width", contourPixelWidth(vs.contours.majorWidthM));
    setPaint(`topo-${entryId}-labels`, "text-color", rgbaCss(vs.contours.majorColour));
    setLabelSize(`topo-${entryId}-labels`);
    return;
  }

  // Line features with name labels — label text follows the line colour.
  for (const key of ["waterway", "track", "road"] as const) {
    const colour = rgbaCss(feat(vs, key).colour);
    setPaint(`topo-${entryId}-${key}`, "line-color", colour);
    setPaint(`topo-${entryId}-${key}`, "line-width", lineWidthInterp(feat(vs, key).widthZ18));
    setPaint(`topo-${entryId}-${key}-label`, "text-color", colour);
    setLabelSize(`topo-${entryId}-${key}-label`);
  }

  // Power lines: raw pixel width (no zoom interpolation), no labels.
  setPaint(`topo-${entryId}-power`, "line-color", rgbaCss(feat(vs, "power").colour));
  setPaint(`topo-${entryId}-power`, "line-width", feat(vs, "power").widthZ18);

  // Buildings: translucent fill + matching outline, no width control.
  const buildingColour = rgbaCss(feat(vs, "building").colour);
  setPaint(`topo-${entryId}-building`, "fill-color", buildingColour);
  setPaint(`topo-${entryId}-building`, "fill-outline-color", buildingColour);

  // Point feature name labels follow the category colour (icons are fixed PNGs).
  for (const key of OSM_POINT_FEATURE_KEYS) {
    setPaint(`topo-${entryId}-${key}-label`, "text-color", rgbaCss(feat(vs, key).colour));
    setLabelSize(`topo-${entryId}-${key}-label`);
  }
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
  canyons,
  sharedCanyons,
  selectCanyon,
  pickingCoords,
  waypoints,
  showWaypoints,
  onSelectWaypoint,
  onCoordsPicked,
  onCancelPickCoords,
  showOwnedCanyons,
  showSharedCanyons,
  showCanyonTracks,
  canyonTracks,
  showRoutes,
  routes,
  selectRoute,
  routeHoverPosition,
  drawingRoute,
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
  selectingArea,
  onAreaSelected,
  selectingBbox,
  onBboxSelected,
  topoLayers,
  vectorStyle,
  activeLayerId,
  selectingGeoPdfExtent,
  geoPdfPaperAspect,
  geoPdfPaperDimensions,
  geoPdfInitialExtent,
  geoPdfInitialScale,
  onGeoPdfExtentConfirmed,
  onGeoPdfExtentCancelled,
  onMapViewChange,
  initialView,
  topoFlyTarget,
  onTopoFlyConsumed,
  flyToCanyon,
  onFlyToCanyonConsumed,
  sidebarOpen,
  onTopoSourceUnavailable,
}: {
  filters: TFilters;
  canyons: TCanyon[];
  sharedCanyons: TCanyon[];
  selectCanyon: (id: string | null) => void;
  pickingCoords: boolean;
  /** Marked points, drawn when the Waypoints layer is on. */
  waypoints: TWaypoint[];
  showWaypoints: boolean;
  onSelectWaypoint: (id: string) => void;
  onCoordsPicked: (lat: number, lng: number) => void;
  onCancelPickCoords: () => void;
  showOwnedCanyons: boolean;
  showSharedCanyons: boolean;
  showCanyonTracks: boolean;
  canyonTracks: CanyonTrack[];
  // User-authored routes. Geometry arrives inline, so unlike canyonTracks
  // there is nothing to fetch and parse per feature.
  showRoutes: boolean;
  routes: TRoute[];
  selectRoute: (id: string) => void;
  /** Position along a route under the elevation-profile cursor, marked on the
   * map so the chart and the ground read as the same place. */
  routeHoverPosition: [number, number] | null;
  // Draw/edit mode. The vertex list lives in App so the HUD can render the
  // running distance and drive undo; the map only reports gestures.
  drawingRoute: boolean;
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
  selectingArea: boolean;
  onAreaSelected: (ids: string[]) => void;
  selectingBbox?: boolean;
  onBboxSelected?: (bbox: TBbox) => void;
  topoLayers?: {
    id: string;
    pmtilesUrl: string;
    format?: "raster" | "vector";
    attribution?: string;
  }[];
  vectorStyle?: VectorStyleSettings | null;
  activeLayerId: string;
  selectingGeoPdfExtent?: boolean;
  geoPdfPaperAspect?: number;
  geoPdfPaperDimensions?: { w: number; h: number };
  geoPdfInitialExtent?: TBbox;
  geoPdfInitialScale?: number;
  onGeoPdfExtentConfirmed?: (extent: TBbox, scale: number) => void;
  onGeoPdfExtentCancelled?: () => void;
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
  flyToCanyon?: { lat: number; lng: number } | null;
  onFlyToCanyonConsumed?: () => void;
  sidebarOpen?: boolean;
  // Fired once per topo overlay entry (jobId-layerName) whose PMTiles source
  // failed to load (e.g. the S3 object is gone). The entry's layers/source are
  // removed so MapLibre stops retrying; App surfaces the failure (LAYERS-1).
  onTopoSourceUnavailable?: (entryId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const toast = useToast();
  // Touch/stylus input (coarse pointer) vs mouse — drives "Tap" vs "Click"
  // copy in the map-pick banners (MOBILE-12a). Pointer capability, not
  // viewport width: a touch laptop at desktop width still gets "Tap".
  const isTouchInput = useMediaQuery("(pointer: coarse)");
  const pickVerb = isTouchInput ? "Tap" : "Click";
  const prevTopoKeyRef = useRef<string>("");
  const prevEnabledKeyRef = useRef<string>("");

  // Live vector style read by the structural topo effect without being a dep
  // (so colour/width edits don't recreate layers — the paint effect handles
  // those). The structural effect re-runs only when `enabledKey` flips.
  const vectorStyleRef = useRef(vectorStyle);
  const enabledKey = vectorStyle
    ? Object.values(vectorStyle.features).map((f) => (f.enabled ? "1" : "0")).join("")
    : "";

  // Keep refs up to date for use inside event handlers
  const selectCanyonRef = useRef(selectCanyon);
  useEffect(() => {
    selectCanyonRef.current = selectCanyon;
  }, [selectCanyon]);

  // True whenever any coord-pick mode is active — read by once-on-load layer
  // handlers to suppress marker selection during picking.
  const pickModeRef = useRef(false);
  useEffect(() => {
    pickModeRef.current =
      pickingCoords || selectingArea || (selectingGeoPdfExtent ?? false);
  }, [pickingCoords, selectingArea, selectingGeoPdfExtent]);

  // Route draw/edit mode, read by the once-on-load layer handlers.
  const drawingRouteRef = useRef(false);
  useEffect(() => {
    drawingRouteRef.current = drawingRoute;
  }, [drawingRoute]);
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

  const onMapViewChangeRef = useRef(onMapViewChange);
  useEffect(() => {
    onMapViewChangeRef.current = onMapViewChange;
  }, [onMapViewChange]);

  // Topo overlay entries whose PMTiles source already failed this session.
  // Read by the once-on-load error handler (dedupe) and by the structural topo
  // effect (never re-add a known-missing source — stops the per-load retry
  // spam of LAYERS-1).
  const failedTopoSourcesRef = useRef<Set<string>>(new Set());
  // Topo entries whose transient (non-terminal) load error was already logged
  // this session — one console line per source, not one per flaky tile.
  const transientTopoSourcesRef = useRef<Set<string>>(new Set());
  const onTopoSourceUnavailableRef = useRef(onTopoSourceUnavailable);
  useEffect(() => {
    onTopoSourceUnavailableRef.current = onTopoSourceUnavailable;
  }, [onTopoSourceUnavailable]);

  useEffect(() => {
    vectorStyleRef.current = vectorStyle;
  }, [vectorStyle]);

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
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    // "Where am I" is a primary question in the field, so the geolocate control
    // sits with the navigation control rather than in a panel.
    //
    // Privacy: this is entirely browser-native. MapLibre reads the position via
    // navigator.geolocation and renders it as a map marker in this page — the
    // position is never sent to the API, and no analytics/telemetry observes it.
    // Keep it that way: do not wire the `geolocate` event to anything that
    // persists or transmits the coordinates.
    map.addControl(
      new maplibregl.GeolocateControl({
        // High accuracy: the difference between the right side of a creek and
        // the wrong one. Costs battery, which is the correct trade for a
        // control the user taps deliberately rather than a background watch.
        positionOptions: { enableHighAccuracy: true, timeout: 10_000 },
        // Follow the user as they walk. Panning away drops the camera lock into
        // MapLibre's background state — the dot keeps updating but stops
        // recentring, so the control can't fight the user for the viewport
        // while they read the map ahead. Tapping it again re-locks.
        trackUserLocation: true,
        // Under canopy or in a slot, a confident-looking dot with 40 m of error
        // is worse than no dot. The accuracy circle makes the error legible.
        showAccuracyCircle: true,
        showUserLocation: true,
      }),
      "top-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-left",
    );
    map.addControl(
      // Narrower on phone-sized viewports (MOBILE-10) so the scale bar can't
      // grow wide enough to collide with the bottom-left attribution control,
      // which starts in its expanded (non-icon) state until first dragged.
      new maplibregl.ScaleControl({
        unit: "metric",
        maxWidth: window.innerWidth <= MOBILE_MAX_WIDTH_PX ? 100 : 200,
      }),
      "bottom-right",
    );

    // A completed topo job whose S3 outputs are gone otherwise 404s on every
    // tile request, silently renders nothing, and retries each load (LAYERS-1).
    // Source errors propagated through MapLibre's Style carry the sourceId. Only
    // a DEFINITIVELY-missing archive (404/403) is terminal — tear its
    // layers/source down (stops the retries) and notify App so the Layers panel
    // can flag it. A transient error (network blip, 5xx, per-tile miss) is left
    // in place so MapLibre retries; one blip must not blacklist a healthy
    // overlay for the whole session.
    map.on("error", (event) => {
      const { sourceId } = event as { sourceId?: unknown };
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
      // style set, all added here so the basemap band sits below every canyon,
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

      // 3D Terrain - Soruce DEM for 3d Terrain
      map.addSource("3d-terrain-dem", {
        type: "raster-dem",
        // Same tile set, same credit, as the elevation profiles and the
        // mobile offline DEM — one definition in shared/src/demTiles.ts.
        tiles: [DEM_TILE_URL_TEMPLATE],
        encoding: "terrarium",
        attribution: DEM_ATTRIBUTION_HTML,
      });

      // Owned canyon GeoJSON source (starts empty)
      map.addSource("canyons", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Canyon track (GPX/KML) line source + layer. Added before the canyon
      // circle markers so the markers paint on top and stay clickable. Hidden
      // until the "Canyon Tracks" layer is toggled on.
      map.addSource("canyon-tracks", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "canyon-tracks-lines",
        type: "line",
        source: "canyon-tracks",
        layout: {
          visibility: "none",
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": [
            "coalesce",
            ["get", "color"],
            readCssVar("--theme-accent", "#3b82f6"),
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 2, 14, 4],
          "line-opacity": 0.9,
        },
      });

      // User-authored routes. Same treatment as canyon-tracks (below the
      // markers so pins stay clickable), but the geometry is already in hand —
      // no per-feature fetch. Hidden until the "Routes" layer is toggled on.
      map.addSource("routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // Invisible click/hover target. A 3px line is a near-pixel-precision
      // gesture; this widens the hit area without widening what you see, which
      // is the standard MapLibre answer. Beneath the visible line so it can
      // never tint it.
      // Saved routes are local detail — a state-wide view of them is a smear of
      // lines, not information — so every routes-* layer drops out below zoom
      // ROUTE_MIN_ZOOM. The hit target carries the same floor as the line it
      // targets: a clickable line you cannot see is a click that does nothing.
      // The route being drawn/edited lives on route-draft and is never hidden.
      map.addLayer({
        id: "routes-hit",
        type: "line",
        source: "routes",
        minzoom: ROUTE_MIN_ZOOM,
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
        minzoom: ROUTE_MIN_ZOOM,
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
      // Waypoints: the marked points. Circles rather than a symbol layer — the
      // colour IS the information (waypointColor, shared with mobile so a
      // carpark is the same blue on both), and an icon set would need sprite
      // work for four tags. Above the route lines so a pin sitting on a line
      // stays clickable, below the canyon markers so a canyon still wins.
      map.addSource("waypoints", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "waypoints-markers",
        type: "circle",
        source: "waypoints",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 14, 6],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      // Labels only once the map is local enough for them to mean something —
      // a state-wide view of every waypoint name is a smear, the same reason
      // the route layers have a floor.
      map.addLayer({
        id: "waypoints-labels",
        type: "symbol",
        source: "waypoints",
        minzoom: WAYPOINT_LABEL_MIN_ZOOM,
        layout: {
          visibility: "none",
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Medium"],
          "text-size": 11,
          "text-anchor": "top",
          "text-offset": [0, 0.7],
          "text-optional": true,
        },
        paint: {
          "text-color": readCssVar("--theme-text-primary", "#ffffff"),
          "text-halo-color": readCssVar("--theme-primary", "#000000"),
          "text-halo-width": 1.2,
        },
      });

      // Direction of travel, as chevrons riding the line itself. Symbol
      // placement does the spacing and rotation natively — hand-placed markers
      // would have to be recomputed on every pan. Held back to zoom 11+ and
      // spaced generously so a screenful of routes doesn't turn into a hedge.
      map.addLayer({
        id: "routes-direction",
        type: "symbol",
        source: "routes",
        minzoom: 11,
        layout: {
          visibility: "none",
          "symbol-placement": "line",
          "symbol-spacing": 90,
          "text-field": "›",
          "text-font": ["Noto Sans Medium"],
          "text-size": 16,
          "text-rotation-alignment": "map",
          "text-keep-upright": false,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": ["get", "color"],
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
          "text-opacity": 0.75,
        },
      });

      // The route being drawn or edited. Dashed, so an unsaved line never
      // reads as a saved one, and unpinned above the saved routes.
      map.addSource("route-draft", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // SOLID. A route is a thing you are making; the measure tool's dotted
      // line is a thing you are asking.
      map.addLayer({
        id: "route-draft-line",
        type: "line",
        source: "route-draft",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": readCssVar("--theme-accent", "#3b82f6"),
          "line-width": 3,
        },
      });
      map.addLayer({
        id: "route-draft-direction",
        type: "symbol",
        source: "route-draft",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 90,
          "text-field": "›",
          "text-font": ["Noto Sans Medium"],
          "text-size": 16,
          "text-rotation-alignment": "map",
          "text-keep-upright": false,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": readCssVar("--theme-accent", "#3b82f6"),
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
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
            readCssVar("--theme-accent", "#3b82f6"),
            "#ffffff",
          ],
          "circle-stroke-width": ["match", ["get", "role"], "middle", 2, 2.5],
          "circle-stroke-color": readCssVar("--theme-accent", "#3b82f6"),
        },
      });

      // Where the elevation-profile cursor sits along a route. Its own source
      // so moving it never re-uploads route geometry.
      map.addSource("route-hover", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-hover-point",
        type: "circle",
        source: "route-hover",
        paint: {
          "circle-radius": 6,
          "circle-color": readCssVar("--theme-accent", "#3b82f6"),
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Shared canyon GeoJSON source (starts empty)
      map.addSource("shared-canyons", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Owned canyon circle markers (orange)
      map.addLayer({
        id: "canyon-circles",
        type: "circle",
        source: "canyons",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 4, 14, 10],
          "circle-color": readCssVar("--theme-bonus-3", "#f97316"),
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });

      // Shared canyon circle markers (blue)
      map.addLayer({
        id: "shared-canyon-circles",
        type: "circle",
        source: "shared-canyons",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 4, 14, 10],
          "circle-color": readCssVar("--theme-accent", "#3b82f6"),
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });

      // Owned canyon name labels visible at zoom 9+
      map.addLayer({
        id: "canyon-labels",
        type: "symbol",
        source: "canyons",
        minzoom: 9,
        layout: {
          "text-field": CANYON_LABEL_FIELD,
          "text-font": ["Noto Sans Medium"],
          "text-size": 12,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
        },
        paint: {
          "text-color": readCssVar("--theme-text-primary", "#ffffff"),
          "text-halo-color": readCssVar("--theme-bonus-2", "#1a1a1a"),
          "text-halo-width": 1.5,
        },
      });

      // Shared canyon name labels visible at zoom 9+
      map.addLayer({
        id: "shared-canyon-labels",
        type: "symbol",
        source: "shared-canyons",
        minzoom: 9,
        layout: {
          "text-field": CANYON_LABEL_FIELD,
          "text-font": ["Noto Sans Medium"],
          "text-size": 12,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
        },
        paint: {
          "text-color": readCssVar("--theme-text-primary", "#ffffff"),
          "text-halo-color": readCssVar("--theme-bonus-2", "#1a1a1a"),
          "text-halo-width": 1.5,
        },
      });

      applyCanyonThemePaint(map);

      // Click to select canyon
      map.on("click", "canyon-circles", (e) => {
        if (pickModeRef.current) return;
        if (!e.features?.length) return;
        const feature = e.features[0];
        const id = feature.properties?.id as string;
        if (feature.geometry.type !== "Point") return;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        selectCanyonRef.current(id);
        // Guard flyTo against an out-of-range legacy marker (CANYON-1) so a
        // click still selects it instead of throwing "Invalid LngLat".
        if (isValidLatitude(lat) && isValidLongitude(lng)) {
          setTimeout(() => {
            map.flyTo({ center: [lng, lat], zoom: 16, duration: 1500 });
          }, SIDEBAR_TRANSITION_MS);
        }
      });

      map.on("click", "shared-canyon-circles", (e) => {
        if (pickModeRef.current) return;
        if (!e.features?.length) return;
        const feature = e.features[0];
        const id = feature.properties?.id as string;
        if (feature.geometry.type !== "Point") return;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        selectCanyonRef.current(id);
        // Guard flyTo against an out-of-range legacy marker (CANYON-1).
        if (isValidLatitude(lat) && isValidLongitude(lng)) {
          setTimeout(() => {
            map.flyTo({ center: [lng, lat], zoom: 16, duration: 1500 });
          }, SIDEBAR_TRANSITION_MS);
        }
      });

      map.on("mouseenter", "canyon-circles", () => {
        if (pickModeRef.current) return;
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "canyon-circles", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", "shared-canyon-circles", () => {
        if (pickModeRef.current) return;
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "shared-canyon-circles", () => {
        map.getCanvas().style.cursor = "";
      });

      setMapLoaded(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      // Reset mapLoaded so the canyon update effect re-runs when the map
      // reinitialises (required in React Strict Mode, which mounts twice).
      setMapLoaded(false);
    };
  }, []);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current;
    const onThemeChange = () => {
      applyCanyonThemePaint(map);
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
    };

    fireViewChange(); // report initial centre immediately on load
    map.on("moveend", fireViewChange);
    return () => {
      map.off("moveend", fireViewChange);
    };
  }, [mapLoaded]);

  // Update canyon GeoJSON when data or filters change
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const toFeatureCollection = (list: TCanyon[], isOwned: boolean) => ({
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
          done: isCanyonDoneByViewer(c, isOwned),
        },
      })),
    });

    const ownedSource = mapRef.current.getSource(
      "canyons",
    ) as maplibregl.GeoJSONSource;
    if (ownedSource) {
      ownedSource.setData(
        toFeatureCollection(
          canyons.filter((c) => passesFilters(c, filters, true)),
          true,
        ),
      );
    }

    const sharedSource = mapRef.current.getSource(
      "shared-canyons",
    ) as maplibregl.GeoJSONSource;
    if (sharedSource) {
      sharedSource.setData(
        toFeatureCollection(
          sharedCanyons.filter((c) => passesFilters(c, filters, false)),
          false,
        ),
      );
    }
  }, [canyons, sharedCanyons, filters, mapLoaded]);

  // Fetch + parse canyon track files into the line layer when enabled. Parsing
  // is client-side (the API never echoes track contents — privacy rule); parsed
  // GeoJSON is cached by mediaId so toggling/re-renders don't refetch.
  // Keyed by mediaId. Plain object (not a JS Map) — `Map` is this component's name.
  // The cache holds PROMISES, not resolved values, so overlapping effect runs
  // (StrictMode double-invoke, rapid toggles) share one in-flight request
  // instead of each firing its own fetch (LAYERS-2 duplicate fetch). Failures
  // resolve to null and stay cached, so a missing track file is fetched once
  // per session instead of retried on every load/toggle.
  //
  // The cached `url` is stored alongside each promise: `track.displayUrl` is a
  // PRESIGNED URL that rotates on refetch (e.g. after the old one expires and
  // the canyon media reloads). Keying only by mediaId would pin a stale/expired
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
  // per session, not one per re-render (LAYERS-2 silent-404 fix).
  const failedTrackToastedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !showCanyonTracks) return;
    let cancelled = false;
    void (async () => {
      const cache = trackGeoCacheRef.current;
      const collections = await Promise.all(
        canyonTracks.map((track) => {
          let entry = cache[track.mediaId];
          // Discard a cached entry whose presigned URL has rotated so the fresh
          // URL retries; same-URL failures stay cached (LAYERS-2).
          if (!entry || entry.url !== track.displayUrl) {
            const promise = fetchTrackGeoJSON(
              track.displayUrl,
              track.color,
              track.canyonId,
            ).catch((err: unknown) => {
              // One bad track must not blank the whole layer. The thrown error
              // carries only the HTTP status — never log the presigned URL,
              // whose canyon-name-derived filename must stay out of logs
              // (privacy rule).
              console.error(err);
              if (!failedTrackToastedRef.current.has(track.mediaId)) {
                failedTrackToastedRef.current.add(track.mediaId);
                toast.error(
                  messageFromError(err, "Couldn't load a canyon track file."),
                );
              }
              return null;
            });
            entry = { url: track.displayUrl, promise };
            cache[track.mediaId] = entry;
          }
          return entry.promise;
        }),
      );
      if (cancelled) return;
      const features = collections.flatMap((fc) => (fc ? fc.features : []));
      const source = mapRef.current?.getSource("canyon-tracks") as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData({ type: "FeatureCollection", features });
    })();
    return () => {
      cancelled = true;
    };
  }, [showCanyonTracks, canyonTracks, mapLoaded, toast]);

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

  // Area selection mode
  const onAreaSelectedRef = useRef(onAreaSelected);
  useEffect(() => {
    onAreaSelectedRef.current = onAreaSelected;
  }, [onAreaSelected]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const container = map.getCanvasContainer();

    if (!selectingArea) {
      map.getCanvas().style.cursor = "";
      return;
    }

    map.getCanvas().style.cursor = "crosshair";

    // Click-anchor-click flow (mirrors topo bbox selection): first click anchors
    // one corner, second click closes the box on the diagonally opposite corner.
    // First corner stored as geographic coords so the overlay tracks map pans/zooms.
    let startLngLat: { lng: number; lat: number } | null = null;
    let box: HTMLDivElement | null = null;

    function updateOverlay(cursorX: number, cursorY: number) {
      if (!startLngLat || !box) return;
      const rect = container.getBoundingClientRect();
      const startPx = map.project([startLngLat.lng, startLngLat.lat]);
      const p1x = startPx.x + rect.left;
      const p1y = startPx.y + rect.top;
      const minX = Math.min(p1x, cursorX);
      const minY = Math.min(p1y, cursorY);
      const maxX = Math.max(p1x, cursorX);
      const maxY = Math.max(p1y, cursorY);
      box.style.left = minX - rect.left + "px";
      box.style.top = minY - rect.top + "px";
      box.style.width = maxX - minX + "px";
      box.style.height = maxY - minY + "px";
    }

    // Kept in closure so map 'move' can call it without a cursor event.
    let lastCursorX = 0;
    let lastCursorY = 0;

    function onMouseMove(e: MouseEvent) {
      lastCursorX = e.clientX;
      lastCursorY = e.clientY;
      updateOverlay(e.clientX, e.clientY);
    }

    function onMapMove() {
      updateOverlay(lastCursorX, lastCursorY);
    }

    function cancelSelection() {
      if (box) {
        box.remove();
        box = null;
      }
      startLngLat = null;
      document.removeEventListener("mousemove", onMouseMove);
      map.off("move", onMapMove);
    }

    function onClick(e: MouseEvent) {
      const rect = container.getBoundingClientRect();
      if (!startLngLat) {
        // First click — anchor first corner.
        const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        startLngLat = { lng: lngLat.lng, lat: lngLat.lat };
        lastCursorX = e.clientX;
        lastCursorY = e.clientY;

        box = document.createElement("div");
        box.style.position = "absolute";
        box.style.border = "2px dashed var(--theme-accent)";
        box.style.backgroundColor =
          "color-mix(in srgb, var(--theme-accent) 20%, transparent)";
        box.style.pointerEvents = "none";
        box.style.zIndex = "10";
        container.appendChild(box);

        document.addEventListener("mousemove", onMouseMove);
        map.on("move", onMapMove);
      } else {
        // Second click — finalize, query canyons inside the pixel bbox.
        const startPx = map.project([startLngLat.lng, startLngLat.lat]);
        const endPx: [number, number] = [
          e.clientX - rect.left,
          e.clientY - rect.top,
        ];

        const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
          [Math.min(startPx.x, endPx[0]), Math.min(startPx.y, endPx[1])],
          [Math.max(startPx.x, endPx[0]), Math.max(startPx.y, endPx[1])],
        ];

        const features = map.queryRenderedFeatures(bbox, {
          layers: ["canyon-circles", "shared-canyon-circles"],
        });

        const ids = [
          ...new Set(
            features.map((f) => f.properties?.id as string).filter(Boolean),
          ),
        ];

        cancelSelection();
        onAreaSelectedRef.current(ids);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancelSelection();
    }

    container.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      container.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousemove", onMouseMove);
      map.off("move", onMapMove);
      if (box) box.remove();
      map.getCanvas().style.cursor = "";
    };
  }, [selectingArea, mapLoaded]);

  // Toggle canyon layer visibility
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const vis = (show: boolean) => (show ? "visible" : "none");
    mapRef.current.setLayoutProperty(
      "canyon-circles",
      "visibility",
      vis(showOwnedCanyons),
    );
    mapRef.current.setLayoutProperty(
      "canyon-labels",
      "visibility",
      vis(showOwnedCanyons),
    );
    mapRef.current.setLayoutProperty(
      "shared-canyon-circles",
      "visibility",
      vis(showSharedCanyons),
    );
    mapRef.current.setLayoutProperty(
      "shared-canyon-labels",
      "visibility",
      vis(showSharedCanyons),
    );
    mapRef.current.setLayoutProperty(
      "canyon-tracks-lines",
      "visibility",
      vis(showCanyonTracks),
    );
    // The route being drawn stays visible even with the Routes layer off —
    // hiding your own in-progress work would read as the tool being broken.
    for (const id of ["routes-hit", "routes-lines", "routes-direction"]) {
      mapRef.current.setLayoutProperty(
        id,
        "visibility",
        vis(showRoutes || drawingRoute),
      );
    }
    for (const id of ["waypoints-markers", "waypoints-labels"]) {
      mapRef.current.setLayoutProperty(id, "visibility", vis(showWaypoints));
    }
  }, [
    showWaypoints,
    showOwnedCanyons,
    showSharedCanyons,
    showCanyonTracks,
    showRoutes,
    drawingRoute,
    mapLoaded,
  ]);

  // Push saved routes to the map. No fetch/parse step: geometry is inline.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const source = mapRef.current.getSource("routes") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: routes
        // The route being edited is drawn by the draft layer instead, so it
        // isn't painted twice (and stale) underneath the handles.
        .filter((route) => route.id !== editingRouteId)
        .map((route) => ({
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: route.points },
          properties: { id: route.id, name: route.name, color: route.color },
        })),
    });
  }, [routes, mapLoaded, editingRouteId]);

  // Push waypoints to the map. Colour is resolved here rather than in a style
  // expression so the tag→colour rule has exactly one implementation, shared
  // with the phone (shared/waypointTags.ts).
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const source = mapRef.current.getSource("waypoints") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: waypoints.map((waypoint) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [waypoint.longitude, waypoint.latitude],
        },
        properties: {
          id: waypoint.id,
          name: waypoint.name,
          color: waypointColor(waypoint),
        },
      })),
    });
  }, [waypoints, mapLoaded]);

  // A marker click opens that waypoint in the panel — the map is the index,
  // the panel is the detail.
  const selectWaypointRef = useRef(onSelectWaypoint);
  useEffect(() => {
    selectWaypointRef.current = onSelectWaypoint;
  }, [onSelectWaypoint]);
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const handleClick = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") selectWaypointRef.current(id);
    };
    const handleEnter = () => {
      if (pickModeRef.current || drawingRouteRef.current) return;
      map.getCanvas().style.cursor = "pointer";
    };
    const handleLeave = () => {
      if (pickModeRef.current || drawingRouteRef.current) return;
      map.getCanvas().style.cursor = "";
    };
    map.on("click", "waypoints-markers", handleClick);
    map.on("mouseenter", "waypoints-markers", handleEnter);
    map.on("mouseleave", "waypoints-markers", handleLeave);
    return () => {
      map.off("click", "waypoints-markers", handleClick);
      map.off("mouseenter", "waypoints-markers", handleEnter);
      map.off("mouseleave", "waypoints-markers", handleLeave);
    };
  }, [mapLoaded]);

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
      if (Date.now() - handlePressedAt.current < HANDLE_CLICK_SUPPRESS_MS) return;
      const tapped: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const previous = drawPointsRef.current[drawPointsRef.current.length - 1];
      // No snap to consider: place the point now rather than waiting on an
      // async path that would do nothing.
      if (!previous || snapModeRef.current === "off") {
        onDrawPointAddRef.current(tapped);
        return;
      }
      // Snapping only ever ADDS intermediate points between the previous
      // vertex and this one — the user's own clicks stay exactly where they
      // put them, so a bad snap is undone by one Undo rather than by
      // reconstructing what they meant. The tapped point lands immediately and
      // the run fills in behind it; waiting would make every click feel laggy.
      onDrawPointAddRef.current(tapped);
      snapBetweenRef.current(previous, tapped);
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

  // Draggable vertex handles. MapLibre markers do the drag maths natively, so
  // this only has to keep one marker per vertex alive and report the drop.
  const vertexMarkersRef = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
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
      });
      // Repaint the line under the cursor on every frame. The preview is built
      // with the same `moveAnchor` the drop commits, so what you drag is
      // exactly what lands.
      marker.on("drag", () => {
        movedDuringDrag = true;
        const { lng, lat } = marker.getLngLat();
        previewDraft(map, moveAnchor(draftRef.current, anchorIndex, [lng, lat]));
      });
      marker.on("dragend", () => {
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
      if (Date.now() - handlePressedAt.current < HANDLE_CLICK_SUPPRESS_MS) return;
      const near = nearestSegment(draftRef.current, [e.lngLat.lng, e.lngLat.lat]);
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
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
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
    map.on("click", "routes-hit", handleClick);
    map.on("mouseenter", "routes-hit", handleEnter);
    map.on("mouseleave", "routes-hit", handleLeave);
    return () => {
      map.off("click", "routes-hit", handleClick);
      map.off("mouseenter", "routes-hit", handleEnter);
      map.off("mouseleave", "routes-hit", handleLeave);
    };
  }, [mapLoaded]);

  // Where the elevation profile's cursor sits along the selected route.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const source = mapRef.current.getSource("route-hover") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: routeHoverPosition
        ? [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: routeHoverPosition },
              properties: {},
            },
          ]
        : [],
    });
  }, [routeHoverPosition, mapLoaded]);

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

  // Topo bbox selection mode (rubber-band draw → returns lat/lng bbox)
  const onBboxSelectedRef = useRef(onBboxSelected);
  useEffect(() => {
    onBboxSelectedRef.current = onBboxSelected;
  }, [onBboxSelected]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const container = map.getCanvasContainer();

    if (!selectingBbox) {
      map.getCanvas().style.cursor = "";
      return;
    }

    map.getCanvas().style.cursor = "crosshair";

    // First corner stored as geographic coords so the overlay tracks map pans/zooms.
    let startLngLat: { lng: number; lat: number } | null = null;
    let box: HTMLDivElement | null = null;

    function updateOverlay(cursorX: number, cursorY: number) {
      if (!startLngLat || !box) return;
      const rect = container.getBoundingClientRect();
      const startPx = map.project([startLngLat.lng, startLngLat.lat]);
      const p1x = startPx.x + rect.left;
      const p1y = startPx.y + rect.top;
      const minX = Math.min(p1x, cursorX);
      const minY = Math.min(p1y, cursorY);
      const maxX = Math.max(p1x, cursorX);
      const maxY = Math.max(p1y, cursorY);
      box.style.left = minX - rect.left + "px";
      box.style.top = minY - rect.top + "px";
      box.style.width = maxX - minX + "px";
      box.style.height = maxY - minY + "px";
    }

    // Kept in closure so map 'move' can call it without a cursor event.
    let lastCursorX = 0;
    let lastCursorY = 0;

    function onMouseMove(e: MouseEvent) {
      lastCursorX = e.clientX;
      lastCursorY = e.clientY;
      updateOverlay(e.clientX, e.clientY);
    }

    function onMapMove() {
      updateOverlay(lastCursorX, lastCursorY);
    }

    function cancelSelection() {
      if (box) {
        box.remove();
        box = null;
      }
      startLngLat = null;
      document.removeEventListener("mousemove", onMouseMove);
      map.off("move", onMapMove);
    }

    function onClick(e: MouseEvent) {
      if (!startLngLat) {
        // First click — anchor first corner.
        const rect = container.getBoundingClientRect();
        const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        startLngLat = { lng: lngLat.lng, lat: lngLat.lat };
        lastCursorX = e.clientX;
        lastCursorY = e.clientY;

        box = document.createElement("div");
        box.style.position = "absolute";
        box.style.border = "2px dashed #22d3ee";
        box.style.backgroundColor = "rgba(34, 211, 238, 0.1)";
        box.style.pointerEvents = "none";
        box.style.zIndex = "10";
        container.appendChild(box);

        document.addEventListener("mousemove", onMouseMove);
        map.on("move", onMapMove);
      } else {
        // Second click — finalize bbox.
        const rect = container.getBoundingClientRect();
        const p1 = startLngLat;
        const p2 = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);

        cancelSelection();

        onBboxSelectedRef.current?.({
          west: Math.min(p1.lng, p2.lng),
          south: Math.min(p1.lat, p2.lat),
          east: Math.max(p1.lng, p2.lng),
          north: Math.max(p1.lat, p2.lat),
        });
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancelSelection();
    }

    container.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      container.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousemove", onMouseMove);
      map.off("move", onMapMove);
      if (box) box.remove();
      map.getCanvas().style.cursor = "";
    };
  }, [selectingBbox, mapLoaded]);

  // Lazily register point-feature icons. MapLibre fires `styleimagemissing`
  // when a symbol layer references an icon-image that isn't loaded yet; we load
  // the PNG from /topo-icons and addImage it, then MapLibre re-renders. This
  // avoids any ordering coupling with the topo-layer effect below.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const PREFIX = "topo-icon-";
    const onMissing = (e: { id: string }) => {
      const id = e.id;
      if (!id || !id.startsWith(PREFIX) || map.hasImage(id)) return;
      const key = id.slice(PREFIX.length) as OsmPointFeatureKey;
      const meta = OSM_POINT_ICON[key];
      if (!meta) return;
      const img = new Image(OSM_POINT_ICON_NATURAL_PX, OSM_POINT_ICON_NATURAL_PX);
      img.onload = () => {
        if (!map.hasImage(id)) map.addImage(id, img);
      };
      img.src = `/topo-icons/${meta.file}`;
    };
    map.on("styleimagemissing", onMissing);
    return () => {
      map.off("styleimagemissing", onMissing);
    };
  }, [mapLoaded]);

  // Topo overlay layers (PMTiles — raster and vector). STRUCTURAL pass: adds and
  // removes sources/layers when the layer set or a per-category `enabled` flag
  // changes. Colour/width are NOT applied here — they come from the paint pass
  // below — so colour-picker drags never recreate layers. Reads the style from a
  // ref so colour/width edits don't retrigger this effect; it re-runs only when
  // `enabledKey` flips.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const layers = topoLayers ?? [];
    const vs = vectorStyleRef.current ?? VECTOR_STYLE_FALLBACK;

    // Skip if the layer set and enabled flags are unchanged (avoids flicker from
    // new array references with identical contents).
    const topoKey = layers.map((l) => `${l.id}:${l.pmtilesUrl}`).join("|")
                  + "::" + enabledKey;
    if (topoKey === prevTopoKeyRef.current) return;
    prevTopoKeyRef.current = topoKey;

    // Map each entry id → the set of MapLibre layer ids it owns
    const activeIds = new Set(layers.map((l) => l.id));

    // Recoverable blacklist: when a failed entry's toggle turns off it leaves
    // `layers`, so drop it from the failed/transient sets. Re-enabling it should
    // RETRY the source (a genuinely-missing archive will just fail terminally
    // again) rather than stay permanently blacklisted from a past error
    // (LAYERS-1).
    for (const failedId of [...failedTopoSourcesRef.current]) {
      if (!activeIds.has(failedId)) failedTopoSourcesRef.current.delete(failedId);
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

    // Remove layers/sources no longer in topoLayers. Additionally, when an
    // enable/disable toggle changed, drop every feature layer so they're
    // re-created below per the current `enabled` flags (sources stay — only
    // layers rebuild, no PMTiles refetch). Contour and raster layers persist;
    // their look updates via the paint pass.
    const structureChanged = prevEnabledKeyRef.current !== enabledKey;
    prevEnabledKeyRef.current = enabledKey;
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
      const isContourChild =
        lid.endsWith("-minor") || lid.endsWith("-major") || lid.endsWith("-labels");
      const isFeatureChild = !lid.endsWith("-raster") && !isContourChild;
      const drop = !activeIds.has(entryId) || (structureChanged && isFeatureChild);
      if (drop && map.getLayer(lid)) map.removeLayer(lid);
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
    layers.forEach(({ id, pmtilesUrl, format, attribution }) => {
      // Known-missing source (PMTiles load already failed this session) — do
      // not re-add it on layer toggles, or the 404 retry spam returns (LAYERS-1).
      if (failedTopoSourcesRef.current.has(id)) return;
      const srcId = `topo-src-${id}`;
      const fmt = format ?? "raster";

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
            url: `pmtiles://${pmtilesUrl}`,
            attribution,
          });
        }
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
        // Vector layers — detect source type by id suffix
        const isContours = id.includes("contours");
        if (isContours) {
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
        } else {
          // OSM features vector source — one layer per category. Per-category
          // `enabled` skips the addLayer call entirely, so toggling a category
          // off removes it from the map on the next structural run. Only static
          // paint (dasharrays) is set here; colour and width are applied by
          // applyVectorPaint so live edits don't recreate layers.
          type FeatureLayerSpec = {
            key: OsmFeatureKey;
            suffix: string;
            filter: maplibregl.ExpressionSpecification;
            style: object;
          };
          const featureLayers: FeatureLayerSpec[] = [
            {
              key: "waterway",
              suffix: "waterway",
              filter: ["==", ["get", "_category"], "waterway"],
              style: { type: "line" },
            },
            {
              key: "track",
              suffix: "track",
              filter: ["==", ["get", "_category"], "track"],
              style: {
                type: "line",
                paint: { "line-dasharray": [4, 2] },
              },
            },
            {
              key: "road",
              suffix: "road",
              filter: ["==", ["get", "_category"], "road"],
              style: { type: "line" },
            },
            {
              key: "building",
              // Buildings get a translucent fill of the configured colour and a
              // matching outline (both applied by applyVectorPaint).
              suffix: "building",
              filter: ["==", ["get", "_category"], "building"],
              style: { type: "fill" },
            },
            {
              key: "power",
              suffix: "power",
              filter: ["==", ["get", "_category"], "power"],
              style: {
                type: "line",
                paint: { "line-dasharray": [3, 4] },
              },
            },
          ];
          for (const { key, suffix, filter, style } of featureLayers) {
            if (!feat(vs, key).enabled) continue;
            const lid = `topo-${id}-${suffix}`;
            if (!map.getLayer(lid)) {
              map.addLayer({
                id: lid,
                source: srcId,
                "source-layer": "features",
                filter,
                ...style,
              } as maplibregl.LayerSpecification);
            }
          }
          void OSM_LINE_KEY_SET; // silence unused-import warning until line widths use it.

          // Feature name labels for line categories (waterway, track, road).
          // Label colour follows the line colour from VectorStyleSettings so a
          // user re-tinting "tracks" gets matching label text without a second
          // colour picker.
          const featureLabelLayers: {
            key: OsmFeatureKey;
            suffix: string;
            filter: maplibregl.ExpressionSpecification;
          }[] = [
            {
              key: "waterway",
              suffix: "waterway-label",
              filter: [
                "all",
                ["==", ["get", "_category"], "waterway"],
                ["has", "name"],
              ],
            },
            {
              key: "track",
              suffix: "track-label",
              filter: [
                "all",
                ["==", ["get", "_category"], "track"],
                ["has", "name"],
              ],
            },
            {
              key: "road",
              suffix: "road-label",
              filter: [
                "all",
                ["==", ["get", "_category"], "road"],
                ["any", ["has", "name"], ["has", "ref"]],
              ],
            },
          ];
          for (const { key, suffix, filter } of featureLabelLayers) {
            if (!feat(vs, key).enabled) continue;
            const lid = `topo-${id}-${suffix}`;
            if (!map.getLayer(lid)) {
              map.addLayer({
                id: lid,
                type: "symbol",
                source: srcId,
                "source-layer": "features",
                filter,
                minzoom: 12,
                layout: {
                  "text-field": [
                    "coalesce",
                    ["get", "name"],
                    ["get", "ref"],
                    "",
                  ],
                  "text-font": ["Noto Sans Medium"],
                  "text-size": labelTextSizeExpr(vs.labelScale ?? 1),
                  "symbol-placement": "line",
                  // Looser bend tolerance (was 30) so curvy creeks/tracks still
                  // get a label instead of only their straight stretches.
                  "text-max-angle": 60,
                },
                paint: {
                  "text-halo-color": "rgba(255,255,255,0.8)",
                  "text-halo-width": 1.5,
                },
              });
            }
          }

          // Point features → fixed PNG icons (one symbol layer per enabled
          // category). Icons aren't user-recolourable; size mirrors the Python
          // pipeline so they match the MBTiles export. Missing images are loaded
          // lazily via the `styleimagemissing` handler above.
          for (const key of OSM_POINT_FEATURE_KEYS) {
            if (!feat(vs, key).enabled) continue;
            const lid = `topo-${id}-${key}`;
            if (map.getLayer(lid)) continue;
            map.addLayer({
              id: lid,
              type: "symbol",
              source: srcId,
              "source-layer": "features",
              filter: ["==", ["get", "_category"], key],
              minzoom: key === "gate" ? 12 : 10,
              layout: {
                "icon-image": `topo-icon-${key}`,
                "icon-size": iconSizeInterp(OSM_POINT_ICON[key].sizeZ18),
                "icon-allow-overlap": true,
              },
            });
          }

          // Name labels for point features at z12+. Peaks also show elevation.
          // Label colour follows the category colour from VectorStyleSettings.
          for (const key of OSM_POINT_FEATURE_KEYS) {
            if (!feat(vs, key).enabled) continue;
            const lid = `topo-${id}-${key}-label`;
            if (map.getLayer(lid)) continue;
            const textField: maplibregl.ExpressionSpecification =
              key === "peak"
                ? [
                    "case",
                    ["all", ["has", "name"], ["has", "ele"]],
                    ["concat", ["get", "name"], "\n", ["to-string", ["get", "ele"]], " m"],
                    ["has", "name"],
                    ["get", "name"],
                    ["has", "ele"],
                    ["concat", ["to-string", ["get", "ele"]], " m"],
                    "",
                  ]
                : ["coalesce", ["get", "name"], ""];
            map.addLayer({
              id: lid,
              type: "symbol",
              source: srcId,
              "source-layer": "features",
              filter: ["==", ["get", "_category"], key],
              minzoom: 12,
              layout: {
                "text-field": textField,
                "text-font": ["Noto Sans Medium"],
                "text-size": labelTextSizeExpr(vs.labelScale ?? 1),
                "text-anchor": "top",
                "text-offset": [0, 0.8],
                "text-optional": true,
              },
              paint: {
                "text-halo-color": "rgba(255,255,255,0.85)",
                "text-halo-width": 1.5,
              },
            });
          }
        }
      }
    });

    // Paint freshly created (or rebuilt) layers with the current style so they
    // never flash a default colour before the paint effect runs.
    for (const { id } of layers) {
      applyVectorPaint(map, id, id.includes("contours"), vs);
    }

    // Reorder: ensure layers appear in the order specified by topoLayers array.
    // Each entry may own multiple MapLibre layers — move them all as a group.
    let afterLayerId: string | undefined = undefined;
    for (let i = layers.length - 1; i >= 0; i--) {
      const owned = ownedLayerIds(layers[i].id);
      for (const lid of owned) {
        if (map.getLayer(lid)) {
          map.moveLayer(lid, afterLayerId);
        }
      }
      if (owned.length > 0) afterLayerId = owned[0];
    }

    // Move canyon marker layers above all topo layers so they remain visible
    const canyonLayers = [
      "canyon-circles",
      "shared-canyon-circles",
      "canyon-labels",
      "shared-canyon-labels",
    ];
    for (const cid of canyonLayers) {
      if (map.getLayer(cid)) {
        map.moveLayer(cid);
      }
    }
  }, [topoLayers, enabledKey, mapLoaded]);

  // PAINT pass: apply live colour/width to existing topo layers in place. Runs on
  // every vectorStyle change (including colour-picker drags) without recreating
  // layers — so editing is smooth and triggers no PMTiles refetch. setPaintProperty
  // calls are no-ops for layers that don't exist (guarded inside applyVectorPaint).
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const vs = vectorStyle ?? VECTOR_STYLE_FALLBACK;
    for (const { id } of topoLayers ?? []) {
      applyVectorPaint(map, id, id.includes("contours"), vs);
    }
  }, [topoLayers, vectorStyle, mapLoaded]);

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
      console.warn("topoFlyTarget had no valid coordinates", topoFlyTarget.type);
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

  const onFlyToCanyonConsumedRef = useRef(onFlyToCanyonConsumed);
  useEffect(() => {
    onFlyToCanyonConsumedRef.current = onFlyToCanyonConsumed;
  }, [onFlyToCanyonConsumed]);

  useEffect(() => {
    if (!flyToCanyon || !mapLoaded || !mapRef.current) return;
    // Defensive guard (CANYON-1): an out-of-range record must not crash the app.
    // MapLibre's flyTo throws "Invalid LngLat" for lat outside [-90,90] (or
    // lng outside [-180,180]), which previously escaped to the RootErrorBoundary
    // and made the record unmanageable — you couldn't even open it to fix or
    // delete it. Skip the fly-to (still selecting the canyon) so the detail
    // panel opens and the record can be edited/deleted. Validation now blocks
    // such records at creation; this covers any that already exist.
    if (isValidLatitude(flyToCanyon.lat) && isValidLongitude(flyToCanyon.lng)) {
      mapRef.current.flyTo({
        center: [flyToCanyon.lng, flyToCanyon.lat],
        zoom: 16,
        duration: 1500,
      });
    } else {
      // Don't log the coordinates themselves (privacy rule: no canyon coords in
      // logs/errors) — just note the fly-to was skipped.
      console.warn("Skipping fly-to: canyon coordinates out of range");
    }
    onFlyToCanyonConsumedRef.current?.();
  }, [flyToCanyon, mapLoaded]);

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

  // When extent selection activates: position the map so the on-screen frame
  // visually matches the initial extent (or scale × paper) — that way the
  // dashed rectangle the user sees is exactly the geographic area they'll get.
  useEffect(() => {
    if (!selectingGeoPdfExtent) {
      geoPdfInitialExtentRef.current = undefined;
      geoPdfFitBoundsSettledRef.current = false;
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
    geoPdfUserPannedRef.current = false;
    geoPdfUserZoomedRef.current = false;

    const map = mapRef.current;
    if (!map) {
      geoPdfFitBoundsSettledRef.current = true;
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
      return;
    }

    // Wait one frame so the frame element is in the DOM and measurable.
    const rafId = requestAnimationFrame(() => {
      const frameEl = geoPdfFrameRef.current;
      const m = mapRef.current;
      if (!frameEl || !m) {
        geoPdfFitBoundsSettledRef.current = true;
        return;
      }
      const framePxW = frameEl.getBoundingClientRect().width;
      if (framePxW <= 0) {
        geoPdfFitBoundsSettledRef.current = true;
        return;
      }

      // Solve for zoom: at zoom z and latitude lat,
      //   metres_per_pixel = 78271.52 × cos(lat) / 2^z
      // MapLibre GL uses 512px tiles, so its zoom resolution constant is
      // earthCircumference / 512 = 78271.52 (NOT the 256-tile 156543.03 used by
      // Leaflet/Google and by the server's XYZ tile-zoom math). Using the 256
      // constant here over-zooms by exactly one level — the dashed frame then
      // shows half the intended ground width, which both shrinks the on-screen
      // frame and halves the scale when the extent is re-derived on Confirm.
      // We want metres_per_pixel × framePxW = targetWidthM.
      const cosLat = Math.cos((targetCenter[1] * Math.PI) / 180);
      const metresPerPixel = targetWidthM / framePxW;
      const targetZoom = Math.log2((78271.52 * cosLat) / metresPerPixel);

      m.easeTo({
        center: targetCenter,
        zoom: targetZoom,
        duration: 600,
      });

      const onSettled = () => {
        geoPdfFitBoundsSettledRef.current = true;
      };
      m.once("moveend", onSettled);
    });

    return () => {
      cancelAnimationFrame(rafId);
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

  const handleConfirmGeoPdfExtent = useCallback(() => {
    if (!mapRef.current || !geoPdfFrameRef.current || !containerRef.current)
      return;

    // If the user hasn't moved the map at all, return the exact initial values.
    if (
      geoPdfInitialExtentRef.current &&
      geoPdfInitialScaleRef.current &&
      !geoPdfUserPannedRef.current &&
      !geoPdfUserZoomedRef.current
    ) {
      onGeoPdfExtentConfirmedRef.current?.(
        geoPdfInitialExtentRef.current,
        geoPdfInitialScaleRef.current,
      );
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

    let scale: number;
    if (!geoPdfUserZoomedRef.current && geoPdfInitialScaleRef.current) {
      // User panned but didn't zoom — preserve the exact scale.
      scale = geoPdfInitialScaleRef.current;
    } else {
      // User zoomed — derive scale from the frame's geographic width.
      // Unproject the left and right midpoints of the frame to measure
      // the true geographic width at the frame's vertical center.
      const leftMid = map.unproject([frameRect.left - mapRect.left, centerY]);
      const rightMid = map.unproject([frameRect.right - mapRect.left, centerY]);
      const DEG_TO_RAD = Math.PI / 180;
      const METERS_PER_DEG_LON_EQUATOR = 111320;
      const midLat = center.lat;
      const geoWidthM =
        (rightMid.lng - leftMid.lng) *
        METERS_PER_DEG_LON_EQUATOR *
        Math.cos(midLat * DEG_TO_RAD);
      const paperWidthM = geoPdfPaperDimensionsRef.current.w / 1000;
      scale = geoWidthM / paperWidthM;
    }

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
  }, []);

  // Toggle 3d Terrain
  const toggleTerrain = () => {
    const map = mapRef.current;
    if (!map) return;
    if (is3D) {
      // Turning off — nothing to wait for, flatten immediately
      map.setTerrain(null);
      map.easeTo({ pitch: 0, duration: 1000 });
    } else {
      // Toast to inform user about movement controls in 3D mode
      if (window.matchMedia("(pointer: coarse)").matches) {
        toast.info("Use two fingers to pan and pinch to zoom in 3D mode.");
      } else {
        toast.info("Use right-click + drag (OR Ctrl + drag) to pan and scroll to zoom in 3D mode.");
      }
      // Turning on — wait for the terrain tiles to actually load before tilting
      map.setTerrain({ source: "3d-terrain-dem", exaggeration: 1.5 });
      map.once("idle", () => {
        map.easeTo({ pitch: 30, duration: 1200 });
      });
    }

    setIs3D(!is3D);
  };

  return (
    <div id="map" className={classes.map} data-sidebar-open={sidebarOpen ? "true" : "false"}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      {/* Button to toggle 3D terrain on and off. */}
      <button onClick={toggleTerrain} style={{
        position: "absolute",
        top: "145px", 
        left: "auto", 
        right: "10px", 
        zIndex: 1000, 
        width: "29px", 
        height: "29px",
        color: "black",
        background: "white",
        border: "none",
        borderRadius: "4px",
        boxShadow: "0 0 0 2px rgba(0,0,0,0.1)",
        fontSize: "13px",
        fontWeight: "bold",
        cursor: "pointer",
      }}> 3D </button>

      {/* Persistent place search — always available; stays usable during pick
          modes for a quick fly-to. Slides right with the sidebar like the
          attribution control. */}
      <MapSearchBox
        shifted={!!sidebarOpen}
        onSelect={(lat, lon) =>
          mapRef.current?.flyTo({ center: [lon, lat], zoom: 13, duration: 1200 })
        }
      />
      {pickingCoords && (
        <>
          <div className={classes.pickBanner}>
            {pickVerb} the map to select a location
          </div>
          <div className={classes.geoPdfConfirmBar}>
            <button
              className={classes.geoPdfButton}
              onClick={onCancelPickCoords}
            >
              Cancel
            </button>
          </div>
        </>
      )}
      {selectingArea && (
        <div className={classes.pickBanner}>
          {pickVerb} to set a corner, then {pickVerb.toLowerCase()} again to select the area
        </div>
      )}
      {selectingBbox && (
        <div className={classes.pickBanner}>
          {pickVerb} to set a corner, then {pickVerb.toLowerCase()} again to define the topo area
        </div>
      )}
      {selectingGeoPdfExtent && (
        <>
          <div className={classes.pickBanner}>
            Pan and zoom the map to position the export area
          </div>
          <div
            ref={geoPdfFrameRef}
            className={classes.geoPdfOverlayFrame}
            style={{ aspectRatio: `${geoPdfPaperAspect ?? 210 / 297}` }}
          />
          <div className={classes.geoPdfConfirmBar}>
            <button
              className={classes.geoPdfButton}
              onClick={handleConfirmGeoPdfExtent}
            >
              Confirm extent
            </button>
            <button
              className={classes.geoPdfButton}
              onClick={onGeoPdfExtentCancelled}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Map;
