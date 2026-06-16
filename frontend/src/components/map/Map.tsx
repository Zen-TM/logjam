import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl, { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker?url";

// Use the pre-built CSP worker instead of the default inline blob worker.
// Vite's production minification can corrupt the blob worker code, causing
// "on is not defined" errors and breaking GeoJSON source processing.
setWorkerUrl(maplibreWorkerUrl);
import { Protocol } from "pmtiles";

// Register PMTiles protocol for serving topo overlay layers from S3
const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile.bind(pmtilesProtocol));
import classes from "./Map.module.css";
import type { TCanyon, TFilters } from "../../canyonUtils";
import { passesFilters } from "../../canyonUtils";
import {
  extentFromCentreAndSize,
  OSM_LINE_FEATURE_KEYS,
  OSM_POINT_FEATURE_KEYS,
  OSM_POINT_ICON,
  OSM_POINT_ICON_NATURAL_PX,
  iconTargetPx,
  rgbaCssFromHex,
  contourWidthStops,
  featureLineWidthStops,
  type OsmFeatureKey,
  type OsmPointFeatureKey,
  type OsmFeatureStyle,
  type VectorStyleSettings,
} from "@logjam/shared";

const SIDEBAR_TRANSITION_MS = 300;
const INITIAL_CENTER: [number, number] = [151.2093, -33.8688];
const INITIAL_ZOOM = 7;

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function applyCanyonThemePaint(map: maplibregl.Map) {
  const owned = readCssVar("--owned-canyon-color", "#f97316");
  const shared = readCssVar("--shared-canyon-color", "#3b82f6");
  const label = readCssVar("--theme-text-primary", "#ffffff");
  const halo = readCssVar("--theme-bonus-2", "#1a1a1a");

  if (map.getLayer("canyon-circles")) {
    map.setPaintProperty("canyon-circles", "circle-color", owned);
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

export const BASE_LAYERS = [
  {
    id: "osm",
    name: "Default",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    maxzoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: "osm-topo",
    name: "OSM Topo",
    tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png"],
    maxzoom: 17,
    attribution:
      '<a href="https://github.com/der-stefan/OpenTopoMap">OpenTopo</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: "osm-cycle",
    name: "OSM Cycle Topo",
    tiles: ["https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"],
    maxzoom: 20,
    attribution:
      '<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases">CyclOSM</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: "six-topo",
    name: "Six Maps Topo",
    tiles: [
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    ],
    maxzoom: 16,
    attribution:
      '&copy; Department of Customer Service (NSW) — <a href="https://maps.six.nsw.gov.au/">SIX Maps</a>, 2026',
  },
  {
    id: "six-base",
    name: "SIX Maps Base Map",
    tiles: [
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer/tile/{z}/{y}/{x}",
    ],
    maxzoom: 18,
    attribution:
      '&copy; Department of Customer Service (NSW) — <a href="https://maps.six.nsw.gov.au/">SIX Maps</a>, 2026',
  },
  {
    id: "six-imagery",
    name: "SIX Maps Imagery",
    tiles: [
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    maxzoom: 18,
    attribution:
      '&copy; Department of Customer Service (NSW) — <a href="https://maps.six.nsw.gov.au/">SIX Maps</a>, 2026',
  },
];

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
};

const OSM_LINE_KEY_SET = new Set<OsmFeatureKey>(OSM_LINE_FEATURE_KEYS);

function feat(vs: VectorStyleSettings, key: OsmFeatureKey): OsmFeatureStyle {
  return vs.features[key];
}

// The label text-size zoom ramp (9px@z14→12px@z18) scaled by the user's global
// labelScale. Single source for every topo label layer; the GeoPDF service and
// the Python tile baker apply the same ramp×scale so exports match the map.
function labelTextSizeExpr(scale: number): maplibregl.ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 14, 9 * scale, 18, 12 * scale];
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

function Map({
  filters,
  canyons,
  sharedCanyons,
  selectCanyon,
  pickingCoords,
  onCoordsPicked,
  showOwnedCanyons,
  showSharedCanyons,
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
}: {
  filters: TFilters;
  canyons: TCanyon[];
  sharedCanyons: TCanyon[];
  selectCanyon: (id: string | null) => void;
  pickingCoords: boolean;
  onCoordsPicked: (lat: number, lng: number) => void;
  showOwnedCanyons: boolean;
  showSharedCanyons: boolean;
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
  topoFlyTarget?: { type: string; coordinates: number[][][] } | null;
  onTopoFlyConsumed?: () => void;
  flyToCanyon?: { lat: number; lng: number } | null;
  onFlyToCanyonConsumed?: () => void;
  sidebarOpen?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
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

  const onMapViewChangeRef = useRef(onMapViewChange);
  useEffect(() => {
    onMapViewChangeRef.current = onMapViewChange;
  }, [onMapViewChange]);

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
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
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
    map.addControl(new maplibregl.AttributionControl(), "bottom-left");
    map.addControl(
      new maplibregl.ScaleControl({ unit: "metric", maxWidth: 200 }),
      "bottom-right",
    );

    map.on("load", () => {
      // Add all raster base layers
      BASE_LAYERS.forEach((layer, i) => {
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
          layout: { visibility: i === 0 ? "visible" : "none" },
        });
      });

      // Owned canyon GeoJSON source (starts empty)
      map.addSource("canyons", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
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

      // Owned canyon name labels visible at zoom 11+
      map.addLayer({
        id: "canyon-labels",
        type: "symbol",
        source: "canyons",
        minzoom: 11,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Semibold"],
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

      // Shared canyon name labels visible at zoom 11+
      map.addLayer({
        id: "shared-canyon-labels",
        type: "symbol",
        source: "shared-canyons",
        minzoom: 11,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Semibold"],
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
        setTimeout(() => {
          map.flyTo({ center: [lng, lat], zoom: 16, duration: 1500 });
        }, SIDEBAR_TRANSITION_MS);
      });

      map.on("click", "shared-canyon-circles", (e) => {
        if (pickModeRef.current) return;
        if (!e.features?.length) return;
        const feature = e.features[0];
        const id = feature.properties?.id as string;
        if (feature.geometry.type !== "Point") return;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        selectCanyonRef.current(id);
        setTimeout(() => {
          map.flyTo({ center: [lng, lat], zoom: 16, duration: 1500 });
        }, SIDEBAR_TRANSITION_MS);
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

    const toFeatureCollection = (list: TCanyon[]) => ({
      type: "FeatureCollection" as const,
      features: list.map((c) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [c.longitude, c.latitude],
        },
        properties: { id: c.id, name: c.name },
      })),
    });

    const ownedSource = mapRef.current.getSource(
      "canyons",
    ) as maplibregl.GeoJSONSource;
    if (ownedSource) {
      ownedSource.setData(
        toFeatureCollection(
          canyons.filter((c) => passesFilters(c, filters, true)),
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
        ),
      );
    }
  }, [canyons, sharedCanyons, filters, mapLoaded]);

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
  }, [showOwnedCanyons, showSharedCanyons, mapLoaded]);

  // Toggle base layer visibility
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    BASE_LAYERS.forEach((layer) => {
      mapRef.current!.setLayoutProperty(
        layer.id,
        "visibility",
        layer.id === activeLayerId ? "visible" : "none",
      );
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
              minzoom: 14,
              layout: {
                "text-field": ["concat", ["to-string", ["get", "elev"]], "m"],
                "text-font": ["Open Sans Semibold"],
                "text-size": labelTextSizeExpr(vs.labelScale ?? 1),
                "symbol-placement": "line",
                "text-max-angle": 60,
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
                minzoom: 14,
                layout: {
                  "text-field": [
                    "coalesce",
                    ["get", "name"],
                    ["get", "ref"],
                    "",
                  ],
                  "text-font": ["Open Sans Semibold"],
                  "text-size": labelTextSizeExpr(vs.labelScale ?? 1),
                  "symbol-placement": "line",
                  "text-max-angle": 30,
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
              minzoom: key === "gate" ? 14 : 12,
              layout: {
                "icon-image": `topo-icon-${key}`,
                "icon-size": iconSizeInterp(OSM_POINT_ICON[key].sizeZ18),
                "icon-allow-overlap": true,
              },
            });
          }

          // Name labels for point features at z14+. Peaks also show elevation.
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
              minzoom: 14,
              layout: {
                "text-field": textField,
                "text-font": ["Open Sans Semibold"],
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
    const pairs = topoFlyTarget.coordinates.flat() as [number, number][];
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
    mapRef.current.flyTo({
      center: [flyToCanyon.lng, flyToCanyon.lat],
      zoom: 16,
      duration: 1500,
    });
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

  return (
    <div id="map" className={classes.map} data-sidebar-open={sidebarOpen ? "true" : "false"}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      {pickingCoords && (
        <div className={classes.pickBanner}>
          Click the map to select a location
        </div>
      )}
      {selectingArea && (
        <div className={classes.pickBanner}>
          Click to set a corner, then click again to select the area
        </div>
      )}
      {selectingBbox && (
        <div className={classes.pickBanner}>
          Click to set a corner, then click again to define the topo area
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
