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

const SIDEBAR_TRANSITION_MS = 300;
const INITIAL_CENTER: [number, number] = [151.2093, -33.8688];
const INITIAL_ZOOM = 7;

export const BASE_LAYERS = [
  {
    id: "osm",
    name: "Default",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: "osm-topo",
    name: "OSM Topo",
    tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png"],
    attribution:
      '<a href="https://github.com/der-stefan/OpenTopoMap">OpenTopo</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: "osm-cycle",
    name: "OSM Cycle Topo",
    tiles: ["https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"],
    attribution:
      '<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases">CyclOSM</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: "six-topo",
    name: "Six Maps Topo",
    tiles: [
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: '<a href="https://maps.six.nsw.gov.au/">SIX Maps</a>',
  },
  {
    id: "six-base",
    name: "SIX Maps Base Map",
    tiles: [
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: '<a href="https://maps.six.nsw.gov.au/">SIX Maps</a>',
  },
  {
    id: "six-imagery",
    name: "SIX Maps Imagery",
    tiles: [
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: '<a href="https://maps.six.nsw.gov.au/">SIX Maps</a>',
  },
];

export type TBbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

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
  activeLayerId,
  selectingGeoPdfExtent,
  geoPdfPaperAspect,
  onGeoPdfExtentConfirmed,
  onGeoPdfExtentCancelled,
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
  }[];
  activeLayerId: string;
  selectingGeoPdfExtent?: boolean;
  geoPdfPaperAspect?: number;
  onGeoPdfExtentConfirmed?: (extent: TBbox) => void;
  onGeoPdfExtentCancelled?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Keep refs up to date for use inside event handlers
  const selectCanyonRef = useRef(selectCanyon);
  useEffect(() => {
    selectCanyonRef.current = selectCanyon;
  }, [selectCanyon]);

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
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(
      new maplibregl.ScaleControl({ unit: "metric" }),
      "bottom-right",
    );

    map.on("load", () => {
      // Add all raster base layers
      BASE_LAYERS.forEach((layer, i) => {
        map.addSource(layer.id, {
          type: "raster",
          tiles: layer.tiles,
          tileSize: 256,
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
          "circle-color": "#f97316",
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
          "circle-color": "#3b82f6",
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
          "text-color": "#1a1a1a",
          "text-halo-color": "#ffffff",
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
          "text-color": "#1a1a1a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      // Click to select canyon
      map.on("click", "canyon-circles", (e) => {
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
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "canyon-circles", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", "shared-canyon-circles", () => {
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
        toFeatureCollection(canyons.filter((c) => passesFilters(c, filters))),
      );
    }

    const sharedSource = mapRef.current.getSource(
      "shared-canyons",
    ) as maplibregl.GeoJSONSource;
    if (sharedSource) {
      sharedSource.setData(
        toFeatureCollection(
          sharedCanyons.filter((c) => passesFilters(c, filters)),
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
    map.boxZoom.disable();
    map.dragPan.disable();

    let start: { x: number; y: number } | null = null;
    let box: HTMLDivElement | null = null;

    function onMouseDown(e: MouseEvent) {
      start = { x: e.clientX, y: e.clientY };
      box = document.createElement("div");
      box.style.position = "absolute";
      box.style.border = "2px dashed #f97316";
      box.style.backgroundColor = "rgba(249, 115, 22, 0.1)";
      box.style.pointerEvents = "none";
      box.style.zIndex = "10";
      container.appendChild(box);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    }

    function onMouseMove(e: MouseEvent) {
      if (!start || !box) return;
      const minX = Math.min(start.x, e.clientX);
      const minY = Math.min(start.y, e.clientY);
      const maxX = Math.max(start.x, e.clientX);
      const maxY = Math.max(start.y, e.clientY);
      const rect = container.getBoundingClientRect();
      box.style.left = minX - rect.left + "px";
      box.style.top = minY - rect.top + "px";
      box.style.width = maxX - minX + "px";
      box.style.height = maxY - minY + "px";
    }

    function onMouseUp(e: MouseEvent) {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (box) {
        box.remove();
        box = null;
      }
      if (!start || !map) return;
      const rect = container.getBoundingClientRect();
      const p1: [number, number] = [start.x - rect.left, start.y - rect.top];
      const p2: [number, number] = [
        e.clientX - rect.left,
        e.clientY - rect.top,
      ];

      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1])],
        [Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])],
      ];

      const features = map.queryRenderedFeatures(bbox, {
        layers: ["canyon-circles", "shared-canyon-circles"],
      });

      const ids = [
        ...new Set(
          features.map((f) => f.properties?.id as string).filter(Boolean),
        ),
      ];
      start = null;
      onAreaSelectedRef.current(ids);
    }

    container.addEventListener("mousedown", onMouseDown);

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (box) box.remove();
      map.boxZoom.enable();
      map.dragPan.enable();
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
    map.boxZoom.disable();
    map.dragPan.disable();

    let start: { x: number; y: number } | null = null;
    let box: HTMLDivElement | null = null;

    function onMouseDown(e: MouseEvent) {
      start = { x: e.clientX, y: e.clientY };
      box = document.createElement("div");
      box.style.position = "absolute";
      box.style.border = "2px dashed #22d3ee";
      box.style.backgroundColor = "rgba(34, 211, 238, 0.1)";
      box.style.pointerEvents = "none";
      box.style.zIndex = "10";
      container.appendChild(box);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    }

    function onMouseMove(e: MouseEvent) {
      if (!start || !box) return;
      const minX = Math.min(start.x, e.clientX);
      const minY = Math.min(start.y, e.clientY);
      const maxX = Math.max(start.x, e.clientX);
      const maxY = Math.max(start.y, e.clientY);
      const rect = container.getBoundingClientRect();
      box.style.left = minX - rect.left + "px";
      box.style.top = minY - rect.top + "px";
      box.style.width = maxX - minX + "px";
      box.style.height = maxY - minY + "px";
    }

    function onMouseUp(e: MouseEvent) {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (box) {
        box.remove();
        box = null;
      }
      if (!start || !map) return;

      const rect = container.getBoundingClientRect();
      const p1 = map.unproject([start.x - rect.left, start.y - rect.top]);
      const p2 = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);

      start = null;
      onBboxSelectedRef.current?.({
        west: Math.min(p1.lng, p2.lng),
        south: Math.min(p1.lat, p2.lat),
        east: Math.max(p1.lng, p2.lng),
        north: Math.max(p1.lat, p2.lat),
      });
    }

    container.addEventListener("mousedown", onMouseDown);

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (box) box.remove();
      map.boxZoom.enable();
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
    };
  }, [selectingBbox, mapLoaded]);

  // Topo overlay layers (PMTiles — raster and vector)
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const layers = topoLayers ?? [];

    // Map each entry id → the set of MapLibre layer ids it owns
    const activeIds = new Set(layers.map((l) => l.id));

    // Helper: get all MapLibre layer ids owned by a topo entry id
    const ownedLayerIds = (entryId: string): string[] =>
      map
        .getStyle()
        .layers.map((l) => l.id)
        .filter((lid) => lid.startsWith(`topo-${entryId}-`));

    // Remove layers/sources no longer in topoLayers
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
      if (!activeIds.has(entryId)) {
        if (map.getLayer(lid)) map.removeLayer(lid);
      }
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
    layers.forEach(({ id, pmtilesUrl, format }) => {
      const srcId = `topo-src-${id}`;
      const fmt = format ?? "raster";

      if (!map.getSource(srcId)) {
        if (fmt === "raster") {
          map.addSource(srcId, {
            type: "raster",
            url: `pmtiles://${pmtilesUrl}`,
            tileSize: 256,
          });
        } else {
          map.addSource(srcId, {
            type: "vector",
            url: `pmtiles://${pmtilesUrl}`,
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
            paint: { "raster-opacity": 0.85 },
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
              paint: {
                "line-color": "rgba(120, 90, 60, 0.55)",
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  12,
                  0.5,
                  18,
                  1.2,
                ],
              },
              minzoom: 13,
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
              paint: {
                "line-color": "rgba(80, 60, 40, 0.85)",
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  12,
                  1,
                  18,
                  2.5,
                ],
              },
            });
          }
          // Elevation labels on major contours at z14+
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
                "text-size": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  14,
                  9,
                  18,
                  12,
                ],
                "symbol-placement": "line",
                "text-max-angle": 30,
              },
              paint: {
                "text-color": "rgba(80, 60, 40, 0.9)",
                "text-halo-color": "rgba(255, 255, 255, 0.8)",
                "text-halo-width": 1.5,
              },
            });
          }
        } else {
          // OSM features vector source — one layer per category
          const featureLayers: {
            suffix: string;
            filter: maplibregl.ExpressionSpecification;
            style: object;
          }[] = [
            {
              suffix: "waterway",
              filter: ["==", ["get", "_category"], "waterway"],
              style: {
                type: "line",
                paint: {
                  "line-color": "rgba(40,120,220,0.85)",
                  "line-width": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    12,
                    1,
                    18,
                    3,
                  ],
                },
              },
            },
            {
              suffix: "track",
              filter: ["==", ["get", "_category"], "track"],
              style: {
                type: "line",
                paint: {
                  "line-color": "rgba(160,100,30,0.85)",
                  "line-width": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    12,
                    0.8,
                    18,
                    2,
                  ],
                  "line-dasharray": [4, 2],
                },
              },
            },
            {
              suffix: "road",
              filter: ["==", ["get", "_category"], "road"],
              style: {
                type: "line",
                paint: {
                  "line-color": "rgba(80,80,80,0.9)",
                  "line-width": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    12,
                    1,
                    18,
                    4,
                  ],
                },
              },
            },
            {
              suffix: "building",
              filter: ["==", ["get", "_category"], "building"],
              style: {
                type: "fill",
                paint: {
                  "fill-color": "rgba(160,140,120,0.3)",
                  "fill-outline-color": "rgba(160,140,120,0.8)",
                },
              },
            },
            {
              suffix: "power",
              filter: ["==", ["get", "_category"], "power"],
              style: {
                type: "line",
                paint: {
                  "line-color": "rgba(200,160,0,0.8)",
                  "line-width": 1,
                  "line-dasharray": [3, 4],
                },
              },
            },
            {
              suffix: "points",
              filter: [
                "in",
                ["get", "_category"],
                [
                  "literal",
                  [
                    "campsite",
                    "peak",
                    "spring",
                    "gate",
                    "viewpoint",
                    "cave",
                    "picnic",
                  ],
                ],
              ],
              style: {
                type: "circle",
                paint: {
                  "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    12,
                    3,
                    18,
                    7,
                  ],
                  "circle-color": "rgba(0,140,80,0.9)",
                  "circle-stroke-color": "#fff",
                  "circle-stroke-width": 1,
                },
              },
            },
          ];
          for (const { suffix, filter, style } of featureLayers) {
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
        }
      }
    });

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
  }, [topoLayers, mapLoaded]);

  // GeoPDF extent selection: ref for overlay rectangle
  const geoPdfFrameRef = useRef<HTMLDivElement>(null);
  const onGeoPdfExtentConfirmedRef = useRef(onGeoPdfExtentConfirmed);
  useEffect(() => {
    onGeoPdfExtentConfirmedRef.current = onGeoPdfExtentConfirmed;
  }, [onGeoPdfExtentConfirmed]);

  const handleConfirmGeoPdfExtent = useCallback(() => {
    if (!mapRef.current || !geoPdfFrameRef.current || !containerRef.current)
      return;
    const map = mapRef.current;
    const mapRect = containerRef.current.getBoundingClientRect();
    const frameRect = geoPdfFrameRef.current.getBoundingClientRect();

    // Convert frame corners to map coordinates (relative to the map container)
    const topLeft = map.unproject([
      frameRect.left - mapRect.left,
      frameRect.top - mapRect.top,
    ]);
    const bottomRight = map.unproject([
      frameRect.right - mapRect.left,
      frameRect.bottom - mapRect.top,
    ]);

    onGeoPdfExtentConfirmedRef.current?.({
      north: topLeft.lat,
      south: bottomRight.lat,
      east: bottomRight.lng,
      west: topLeft.lng,
    });
  }, []);

  return (
    <div id="map" className={classes.map}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      {pickingCoords && (
        <div className={classes.pickBanner}>
          Click the map to select a location
        </div>
      )}
      {selectingArea && (
        <div className={classes.pickBanner}>
          Click and drag to select an area
        </div>
      )}
      {selectingBbox && (
        <div className={classes.pickBanner}>
          Click and drag to define the topo area
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
              className={classes.geoPdfConfirmButton}
              onClick={handleConfirmGeoPdfExtent}
            >
              Confirm extent
            </button>
            <button
              className={classes.geoPdfCancelButton}
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
