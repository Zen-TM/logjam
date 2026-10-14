// What Logjam Web draws on the map from the flow network lookup
// (shared/src/flowNetwork.ts): the creek point a "What is here?" was measured
// at, and the creeks upstream of it once the user asks for them.
//
// Each source is added when its figure is shown and removed when it goes,
// rather than left empty from load: MapLibre lists a source's credit whenever
// a visible layer reads it, so an idle source would credit the DEM on a map
// showing nothing derived from it (ADR 0031).
import type {
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import {
  MAP_INK,
  NSW_5M,
  type FlowNetworkUpstream,
  type MapPointCoord,
} from "@logjam/shared";

export const UPSTREAM_SOURCE = "flow-upstream";
export const UPSTREAM_LAYER = "flow-upstream-line";
export const SNAP_SOURCE = "flow-snap";
export const SNAP_LINE_LAYER = "flow-snap-line";
export const SNAP_POINT_LAYER = "flow-snap-point";

/** Drawn under the place pins, so a pin on a creek stays pressable. */
const UNDER_LAYER = "place-highlight";

type OverlayMap = Pick<
  MapLibreMap,
  | "getSource"
  | "addSource"
  | "removeSource"
  | "getLayer"
  | "addLayer"
  | "removeLayer"
  | "setPaintProperty"
>;

const MIN_WIDTH_PX = 1;
const MAX_WIDTH_PX = 6;

/**
 * A creek's line width from the land it drains: one step per tenfold, so a
 * 0.01 km² gully is a hairline and a 100 km² river the widest, and the trunk
 * reads at once among thousands of tributaries.
 */
export function upstreamLineWidth(catchmentKm2: number): number {
  const decades = Math.log10(Math.max(catchmentKm2, 0.01)) + 2;
  const width = MIN_WIDTH_PX + 1.25 * decades;
  return Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, width));
}

/** The API's lines, each carrying the width it is drawn at. */
export function upstreamLinesData(
  upstream: FlowNetworkUpstream,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: upstream.lines.features.map((feature) => ({
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        catchmentKm2: feature.properties.catchmentKm2,
        width: upstreamLineWidth(feature.properties.catchmentKm2),
      },
    })),
  };
}

/** The dashed line from where the user pressed to the creek point measured. */
export function snapData(
  from: MapPointCoord,
  to: MapPointCoord,
): GeoJSON.FeatureCollection {
  const a: [number, number] = [from.longitude, from.latitude];
  const b: [number, number] = [to.longitude, to.latitude];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [a, b] },
        properties: {},
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: b },
        properties: {},
      },
    ],
  };
}

function geojson(data: GeoJSON.FeatureCollection): GeoJSONSourceSpecification {
  return { type: "geojson", data, attribution: NSW_5M.creditHtml };
}

function remove(map: OverlayMap, source: string, layers: string[]) {
  for (const layer of layers) if (map.getLayer(layer)) map.removeLayer(layer);
  if (map.getSource(source)) map.removeSource(source);
}

export function clearUpstream(map: OverlayMap) {
  remove(map, UPSTREAM_SOURCE, [UPSTREAM_LAYER]);
}

export function showUpstream(
  map: OverlayMap,
  upstream: FlowNetworkUpstream,
  accent: string,
) {
  clearUpstream(map);
  map.addSource(UPSTREAM_SOURCE, geojson(upstreamLinesData(upstream)));
  map.addLayer(
    {
      id: UPSTREAM_LAYER,
      type: "line",
      source: UPSTREAM_SOURCE,
      // The trunk over its tributaries where they meet.
      layout: {
        "line-cap": "round",
        "line-join": "round",
        "line-sort-key": ["get", "catchmentKm2"],
      },
      paint: {
        "line-color": accent,
        "line-width": ["get", "width"],
        "line-opacity": 0.9,
      },
    },
    map.getLayer(UNDER_LAYER) ? UNDER_LAYER : undefined,
  );
}

export function clearSnap(map: OverlayMap) {
  remove(map, SNAP_SOURCE, [SNAP_POINT_LAYER, SNAP_LINE_LAYER]);
}

/**
 * The creek point a catchment was measured at, and a dashed line to it from
 * the press: a click rarely lands on a creek, and a snap to the wrong one
 * should be plain to see. A hollow ring, so it never reads as the panel's
 * own filled dot.
 */
export function showSnap(
  map: OverlayMap,
  from: MapPointCoord,
  to: MapPointCoord,
  accent: string,
) {
  clearSnap(map);
  map.addSource(SNAP_SOURCE, geojson(snapData(from, to)));
  map.addLayer({
    id: SNAP_LINE_LAYER,
    type: "line",
    source: SNAP_SOURCE,
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": accent,
      "line-width": 2,
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: SNAP_POINT_LAYER,
    type: "circle",
    source: SNAP_SOURCE,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5,
      "circle-color": MAP_INK.ring,
      "circle-stroke-color": accent,
      "circle-stroke-width": 2.5,
    },
  });
}

/** A scheme change repaints whatever of these is on the map. */
export function paintFlowNetwork(map: OverlayMap, accent: string) {
  if (map.getLayer(UPSTREAM_LAYER))
    map.setPaintProperty(UPSTREAM_LAYER, "line-color", accent);
  if (map.getLayer(SNAP_LINE_LAYER))
    map.setPaintProperty(SNAP_LINE_LAYER, "line-color", accent);
  if (map.getLayer(SNAP_POINT_LAYER))
    map.setPaintProperty(SNAP_POINT_LAYER, "circle-stroke-color", accent);
}
