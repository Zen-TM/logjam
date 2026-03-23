import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import classes from "./Map.module.css";
import type { TCanyon, TFilters } from "../../canyonUtils";
import { passesFilters } from "../../canyonUtils";

const SIDEBAR_TRANSITION_MS = 300;
const INITIAL_CENTER: [number, number] = [151.2093, -33.8688];
const INITIAL_ZOOM = 7;

const BASE_LAYERS = [
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

function Map({
  filters,
  canyons,
  sharedCanyons,
  selectCanyon,
  pickingCoords,
  onCoordsPicked,
  showOwnedCanyons,
  showSharedCanyons,
}: {
  filters: TFilters;
  canyons: TCanyon[];
  sharedCanyons: TCanyon[];
  selectCanyon: (id: string | null) => void;
  pickingCoords: boolean;
  onCoordsPicked: (lat: number, lng: number) => void;
  showOwnedCanyons: boolean;
  showSharedCanyons: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [activeLayerId, setActiveLayerId] = useState(BASE_LAYERS[0].id);
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
          "text-font": ["Open Sans Regular"],
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
          "text-font": ["Open Sans Regular"],
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

  // Toggle canyon layer visibility
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const vis = (show: boolean) => (show ? "visible" : "none");
    mapRef.current.setLayoutProperty("canyon-circles", "visibility", vis(showOwnedCanyons));
    mapRef.current.setLayoutProperty("canyon-labels", "visibility", vis(showOwnedCanyons));
    mapRef.current.setLayoutProperty("shared-canyon-circles", "visibility", vis(showSharedCanyons));
    mapRef.current.setLayoutProperty("shared-canyon-labels", "visibility", vis(showSharedCanyons));
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

  return (
    <div id="map" className={classes.map}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      {pickingCoords && (
        <div className={classes.pickBanner}>Click the map to select a location</div>
      )}
      <div
        className={classes.layerSwitcher}
        style={{ pointerEvents: pickingCoords ? "none" : undefined }}
      >
        <select
          className={classes.layerSelect}
          value={activeLayerId}
          onChange={(e) => setActiveLayerId(e.target.value)}
        >
          {BASE_LAYERS.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default Map;
