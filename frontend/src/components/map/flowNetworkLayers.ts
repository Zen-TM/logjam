// What Logjam Web draws on the map from the flow network lookup
// (shared/src/flowNetwork.ts): the dashed line from a press to the creek point
// a "What is here?" was measured at, and the creeks upstream of it once the
// user asks for them, over a wash of the land that drains to it.
//
// Each source is added when its figure is shown and removed when it goes,
// rather than left empty from load: MapLibre lists a source's credit whenever
// a visible layer reads it, so an idle source would credit the DEM on a map
// showing nothing derived from it (ADR 0031).
import type {
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  LineLayerSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import {
  MAP_INK,
  NSW_5M,
  catchmentOutline,
  type FlowNetworkSegmentFeature,
  type FlowNetworkUpstream,
  type MapPointCoord,
} from "@logjam/shared";

export const UPSTREAM_SOURCE = "flow-upstream";
export const CATCHMENT_SOURCE = "flow-catchment";
export const CATCHMENT_FILL_LAYER = "flow-catchment-fill";
export const CATCHMENT_EDGE_LAYER = "flow-catchment-edge";
export const SNAP_SOURCE = "flow-snap";
export const SNAP_LINE_LAYER = "flow-snap-line";

/**
 * The creeks are drawn in this many bands by how far upstream of the press
 * they are, each band its own layer, so the draw-in fades whole layers in:
 * a layer's constant opacity changes without MapLibre re-laying out 4,000
 * lines, where a filter or a data-driven opacity would, every frame.
 */
export const REVEAL_BANDS = 12;
/** How long the creeks take to spread from the press to the farthest tip. */
export const REVEAL_MS = 1200;

const bands = Array.from({ length: REVEAL_BANDS }, (_, band) => band);
export const upstreamCasingLayer = (band: number) =>
  `flow-upstream-casing-${band}`;
export const upstreamLineLayer = (band: number) => `flow-upstream-line-${band}`;
/** Every layer a pointer over a creek can hit. */
export const UPSTREAM_LINE_LAYERS = bands.map(upstreamLineLayer);

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

/** The hairline a gully gets, and the trunk's width, at close zoom. */
export const MIN_WIDTH_PX = 1;
export const MAX_WIDTH_PX = 7;
/** A catchment whose creeks all drain within this many tenfolds of each
 *  other is still drawn across a whole tenfold, so a lone gully is not
 *  drawn as a river. */
const MIN_RANGE_DECADES = 1;

/**
 * Where a creek sits between the smallest and the biggest drawn, 0 to 1, by
 * the log of the land it drains. Relative to this catchment's own range, so a
 * 1 km² gully system shows its trunk as plainly as a 663 km² river does.
 */
export function upstreamSize(
  catchmentKm2: number,
  range: { minKm2: number; maxKm2: number },
): number {
  const hi = Math.log10(Math.max(range.maxKm2, 1e-6));
  const lo = Math.min(
    Math.log10(Math.max(range.minKm2, 1e-6)),
    hi - MIN_RANGE_DECADES,
  );
  const at = Math.log10(Math.max(catchmentKm2, 1e-6));
  return Math.min(1, Math.max(0, (at - lo) / (hi - lo)));
}

/** A creek's line width at close zoom, from its `upstreamSize`. */
export function upstreamLineWidth(size: number): number {
  return MIN_WIDTH_PX + (MAX_WIDTH_PX - MIN_WIDTH_PX) * size;
}

/**
 * How far upstream of the press each creek starts, as a share of the
 * farthest, 0 to 1. Water runs from a segment's last vertex into the segment
 * whose first vertex that is; a segment that runs into none drains to the
 * press (or to a creek the API left out), so it is where the spreading
 * starts. Each creek is placed by where its downstream end is, along the
 * network, not as the crow flies: a long side creek reaches back past the
 * trunk's own tributaries.
 */
export function upstreamReveal(
  features: readonly FlowNetworkSegmentFeature[],
): number[] {
  const key = ([x, y]: [number, number]) => `${x},${y}`;
  const byStart = new Map<string, number>();
  features.forEach((feature, index) => {
    const first = feature.geometry.coordinates[0];
    if (first) byStart.set(key(first), index);
  });
  const length = features.map((feature) => lineLengthM(feature));
  const feeding: number[][] = features.map(() => []);
  const outlets: number[] = [];
  features.forEach((feature, index) => {
    const coordinates = feature.geometry.coordinates;
    const last = coordinates[coordinates.length - 1];
    const below = last ? byStart.get(key(last)) : undefined;
    if (below === undefined || below === index) outlets.push(index);
    else feeding[below].push(index);
  });

  const distance = features.map(() => Number.NaN);
  const queue = [...outlets];
  for (const index of outlets) distance[index] = 0;
  for (let next = 0; next < queue.length; next++) {
    const index = queue[next];
    for (const above of feeding[index]) {
      // A loop in the data would come round again: first visit wins.
      if (!Number.isNaN(distance[above])) continue;
      distance[above] = distance[index] + length[index];
      queue.push(above);
    }
  }
  // A segment in a loop with no way out is drawn with the last of them.
  const farthest = Math.max(
    0,
    ...distance.filter((each) => !Number.isNaN(each)),
  );
  return distance.map((each) =>
    Number.isNaN(each) ? 1 : farthest === 0 ? 0 : each / farthest,
  );
}

function lineLengthM(feature: FlowNetworkSegmentFeature): number {
  const coordinates = feature.geometry.coordinates;
  let metres = 0;
  for (let k = 1; k < coordinates.length; k++) {
    const [ax, ay] = coordinates[k - 1];
    const [bx, by] = coordinates[k];
    const kx = 111_320 * Math.cos((((ay + by) / 2) * Math.PI) / 180);
    metres += Math.hypot((bx - ax) * kx, (by - ay) * 110_574);
  }
  return metres;
}

/** The API's lines, each carrying how it is drawn and when it appears. */
export function upstreamLinesData(
  upstream: FlowNetworkUpstream,
  clickedKm2?: number,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const features = upstream.lines.features;
  const areas = features.map((feature) => feature.properties.catchmentKm2);
  const range = {
    minKm2: Math.min(...areas),
    maxKm2: Math.max(clickedKm2 ?? 0, ...areas),
  };
  const reveal = upstreamReveal(features);
  return {
    type: "FeatureCollection",
    features: features.map((feature, index) => {
      const size = upstreamSize(feature.properties.catchmentKm2, range);
      return {
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          catchmentKm2: feature.properties.catchmentKm2,
          size,
          width: upstreamLineWidth(size),
          band: Math.min(
            REVEAL_BANDS - 1,
            Math.floor(reveal[index] * REVEAL_BANDS),
          ),
        },
      };
    }),
  };
}

/**
 * How visible a band of creeks is `progress` (0 to 1) of the way through the
 * draw-in: each band fades in over a quarter of it, the nearest first, the
 * last finishing at the end.
 */
export function revealOpacity(band: number, progress: number): number {
  const fade = 0.25;
  const start = (band / Math.max(1, REVEAL_BANDS - 1)) * (1 - fade);
  return Math.min(1, Math.max(0, (progress - start) / fade));
}

/** The dashed line from where the user pressed to the creek point measured. */
export function snapData(
  from: MapPointCoord,
  to: MapPointCoord,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [from.longitude, from.latitude],
            [to.longitude, to.latitude],
          ],
        },
        properties: {},
      },
    ],
  };
}

function geojson(data: GeoJSON.GeoJSON): GeoJSONSourceSpecification {
  return { type: "geojson", data, attribution: NSW_5M.creditHtml };
}

function remove(map: OverlayMap, source: string, layers: string[]) {
  for (const layer of layers) if (map.getLayer(layer)) map.removeLayer(layer);
  if (map.getSource(source)) map.removeSource(source);
}

export function clearUpstream(map: OverlayMap) {
  remove(map, UPSTREAM_SOURCE, [
    ...UPSTREAM_LINE_LAYERS,
    ...bands.map(upstreamCasingLayer),
  ]);
  remove(map, CATCHMENT_SOURCE, [CATCHMENT_EDGE_LAYER, CATCHMENT_FILL_LAYER]);
}

/** Thin at a glance over the whole basin, full width close in. */
function zoomed(width: ExpressionSpecification): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    9,
    ["*", 0.5, width],
    13,
    ["*", 0.8, width],
    15,
    width,
  ];
}

const FILL_OPACITY = 0.08;
const EDGE_OPACITY = 0.5;

/**
 * Draws the creeks upstream, hidden, ready for `revealUpstream`. Colour runs
 * from `waterSmall` to `waterLarge` by each creek's size; a light casing under
 * the bigger ones sets them off the topo, the imagery and the vector map
 * alike, and stays off the hairlines, where a thousand halos would be a fog.
 * The land that drains to the press is an approximate wash under them
 * (`catchmentOutline`), reaching further past the tips when the smallest
 * creeks were left out.
 */
export function showUpstream(
  map: OverlayMap,
  upstream: FlowNetworkUpstream,
  clickedKm2?: number,
) {
  clearUpstream(map);
  const before = map.getLayer(UNDER_LAYER) ? UNDER_LAYER : undefined;
  const outline = catchmentOutline(
    upstream.lines.features.map((feature) => feature.geometry.coordinates),
    { reachCells: upstream.trimmedBelowOrder != null ? 3.5 : 2 },
  );
  if (outline) {
    map.addSource(
      CATCHMENT_SOURCE,
      geojson({ type: "Feature", geometry: outline, properties: {} }),
    );
    map.addLayer(
      {
        id: CATCHMENT_FILL_LAYER,
        type: "fill",
        source: CATCHMENT_SOURCE,
        paint: { "fill-color": MAP_INK.waterLarge, "fill-opacity": 0 },
      },
      before,
    );
    map.addLayer(
      {
        id: CATCHMENT_EDGE_LAYER,
        type: "line",
        source: CATCHMENT_SOURCE,
        layout: { "line-join": "round" },
        paint: {
          "line-color": MAP_INK.waterLarge,
          "line-width": 1.25,
          "line-opacity": 0,
        },
      },
      before,
    );
  }

  map.addSource(
    UPSTREAM_SOURCE,
    geojson(upstreamLinesData(upstream, clickedKm2)),
  );
  const width: ExpressionSpecification = ["get", "width"];
  const layout: LineLayerSpecification["layout"] = {
    "line-cap": "round",
    "line-join": "round",
    // The trunk over its tributaries where they meet.
    "line-sort-key": ["get", "catchmentKm2"],
  };
  // Farthest band first, so nearer (and mostly bigger) creeks draw on top;
  // every casing under every line, or a tributary's casing would cut the
  // trunk where they join.
  const farFirst = [...bands].reverse();
  for (const band of farFirst)
    map.addLayer(
      {
        id: upstreamCasingLayer(band),
        type: "line",
        source: UPSTREAM_SOURCE,
        filter: ["==", ["get", "band"], band],
        layout,
        paint: {
          "line-color": MAP_INK.ring,
          "line-width": zoomed(["+", width, ["*", 3, ["get", "size"]]]),
          "line-opacity": 0,
        },
      },
      before,
    );
  for (const band of farFirst)
    map.addLayer(
      {
        id: upstreamLineLayer(band),
        type: "line",
        source: UPSTREAM_SOURCE,
        filter: ["==", ["get", "band"], band],
        layout,
        paint: {
          "line-color": [
            "interpolate",
            ["linear"],
            ["get", "size"],
            0,
            MAP_INK.waterSmall,
            1,
            MAP_INK.waterLarge,
          ],
          "line-width": zoomed(width),
          "line-opacity": 0,
        },
      },
      before,
    );
}

/** Sets every upstream layer to where it is `progress` through the draw-in. */
export function paintReveal(map: OverlayMap, progress: number) {
  for (const band of bands) {
    const opacity = revealOpacity(band, progress);
    if (map.getLayer(upstreamLineLayer(band))) {
      map.setPaintProperty(upstreamLineLayer(band), "line-opacity", opacity);
      map.setPaintProperty(
        upstreamCasingLayer(band),
        "line-opacity",
        0.85 * opacity,
      );
    }
  }
  if (map.getLayer(CATCHMENT_FILL_LAYER)) {
    map.setPaintProperty(
      CATCHMENT_FILL_LAYER,
      "fill-opacity",
      FILL_OPACITY * progress,
    );
    map.setPaintProperty(
      CATCHMENT_EDGE_LAYER,
      "line-opacity",
      EDGE_OPACITY * progress,
    );
  }
}

/**
 * Spreads the creeks out from the press over `REVEAL_MS`, or shows them at
 * once when the user asks for reduced motion (shared/DESIGN.md §11). Returns
 * a stop, which leaves them fully shown.
 */
export function revealUpstream(
  map: OverlayMap,
  { reduceMotion }: { reduceMotion: boolean },
): () => void {
  if (reduceMotion) {
    paintReveal(map, 1);
    return () => {};
  }
  let frame = 0;
  let start: number | null = null;
  const step = (now: number) => {
    start ??= now;
    const progress = Math.min(1, (now - start) / REVEAL_MS);
    // Cleared mid-way (a new question, the notice's ×): nothing to paint.
    if (!map.getLayer(upstreamLineLayer(0))) return;
    paintReveal(map, progress);
    if (progress < 1) frame = requestAnimationFrame(step);
  };
  paintReveal(map, 0);
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
    if (map.getLayer(upstreamLineLayer(0))) paintReveal(map, 1);
  };
}

export function clearSnap(map: OverlayMap) {
  remove(map, SNAP_SOURCE, [SNAP_LINE_LAYER]);
}

/**
 * The dashed line from the press to the creek point a catchment was measured
 * at: a click rarely lands on a creek, and a snap to the wrong one should be
 * plain to see. The creek point itself is a marker (`CreekPointMarker`).
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
    paint: {
      "line-color": accent,
      "line-width": 2,
      "line-dasharray": [2, 2],
    },
  });
}

/**
 * A scheme change repaints whatever of these follows the scheme: only the
 * dashed line, which joins the scheme's own dot. The water is `MAP_INK`.
 */
export function paintFlowNetwork(map: OverlayMap, accent: string) {
  if (map.getLayer(SNAP_LINE_LAYER))
    map.setPaintProperty(SNAP_LINE_LAYER, "line-color", accent);
}
