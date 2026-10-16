import { describe, expect, it } from "vitest";
import {
  MAP_INK,
  NSW_5M,
  type FlowNetworkSegmentFeature,
  type FlowNetworkUpstream,
} from "@logjam/shared";
import {
  CATCHMENT_EDGE_LAYER,
  CATCHMENT_FILL_LAYER,
  CATCHMENT_SOURCE,
  MAX_WIDTH_PX,
  MIN_WIDTH_PX,
  REVEAL_BANDS,
  SNAP_LINE_LAYER,
  SNAP_SOURCE,
  UPSTREAM_LINE_LAYERS,
  UPSTREAM_SOURCE,
  clearSnap,
  clearUpstream,
  paintFlowNetwork,
  paintReveal,
  revealOpacity,
  revealUpstream,
  showSnap,
  showUpstream,
  snapData,
  upstreamCasingLayer,
  upstreamLineLayer,
  upstreamLineWidth,
  upstreamLinesData,
  upstreamReveal,
  upstreamSize,
} from "./flowNetworkLayers";

/** As much of MapLibre's style bookkeeping as these functions touch. */
function fakeMap(existingLayers: string[] = []) {
  const sources = new Map<string, { attribution?: string }>();
  const layers: {
    id: string;
    before?: string;
    paint: Record<string, unknown>;
    filter?: unknown;
  }[] = existingLayers.map((id) => ({ id, paint: {} }));
  const map = {
    sources,
    layers,
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: { attribution?: string }) => {
      if (sources.has(id)) throw new Error(`Source "${id}" already exists.`);
      sources.set(id, source);
    },
    removeSource: (id: string) => {
      if (layers.some((layer) => (layer as { source?: string }).source === id))
        throw new Error(`Source "${id}" is in use.`);
      sources.delete(id);
    },
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    addLayer: (
      layer: { id: string; source: string; paint: Record<string, unknown> },
      before?: string,
    ) => {
      if (layers.some((each) => each.id === layer.id))
        throw new Error(`Layer "${layer.id}" already exists.`);
      layers.push({ ...layer, before });
    },
    removeLayer: (id: string) => {
      layers.splice(
        layers.findIndex((layer) => layer.id === id),
        1,
      );
    },
    setPaintProperty: (id: string, property: string, value: unknown) => {
      const layer = layers.find((each) => each.id === id)!;
      layer.paint = { ...layer.paint, [property]: value };
    },
  };
  return map as typeof map & Parameters<typeof showUpstream>[0];
}

/** A creek segment from `from` to `to`, water running that way. */
function segment(
  from: [number, number],
  to: [number, number],
  catchmentKm2: number,
  streamOrder = 1,
): FlowNetworkSegmentFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [from, to] },
    properties: { catchmentKm2, streamOrder },
  };
}

// A trunk running east to the press at its end; a long side creek into its
// top, and a gully into that; a short creek into the trunk's top too.
const press: [number, number] = [150.32, -33.62];
const top: [number, number] = [150.31, -33.62];
const sideTop: [number, number] = [150.31, -33.6];
const trunk = segment(top, press, 42, 3);
const side = segment(sideTop, top, 12, 2);
const gully = segment([150.3, -33.6], sideTop, 0.05, 1);
const stub = segment([150.31, -33.625], top, 0.4, 1);

const upstream: FlowNetworkUpstream = {
  lines: {
    type: "FeatureCollection",
    features: [gully, side, stub, trunk],
  },
  bbox: [150.3, -33.625, 150.32, -33.6],
};

describe("how wide and how deep a blue each creek is drawn", () => {
  // Mutation: rank sizes on a fixed scale (0.01 to 100 km²), and a 1 km²
  // gully system is all hairlines with no trunk to follow.
  it("ranks a creek within this catchment's own range, by tenfolds", () => {
    expect(upstreamSize(0.01, { minKm2: 0.01, maxKm2: 1 })).toBe(0);
    expect(upstreamSize(0.1, { minKm2: 0.01, maxKm2: 1 })).toBeCloseTo(0.5);
    expect(upstreamSize(1, { minKm2: 0.01, maxKm2: 1 })).toBe(1);
    expect(upstreamSize(663, { minKm2: 0.1, maxKm2: 663 })).toBe(1);
    expect(upstreamSize(0, { minKm2: 0.01, maxKm2: 1 })).toBe(0);
  });

  // Mutation: let the range shrink to nothing, and two creeks a few hectares
  // apart in size are drawn as a hairline and a river.
  it("spreads a narrow range across a whole tenfold", () => {
    expect(upstreamSize(0.5, { minKm2: 0.5, maxKm2: 0.6 })).toBeGreaterThan(
      0.9,
    );
    expect(upstreamSize(0.6, { minKm2: 0.6, maxKm2: 0.6 })).toBe(1);
  });

  it("runs from a hairline to the trunk's width", () => {
    expect(upstreamLineWidth(0)).toBe(MIN_WIDTH_PX);
    expect(upstreamLineWidth(1)).toBe(MAX_WIDTH_PX);
    expect(MIN_WIDTH_PX).toBeLessThanOrEqual(1);
    expect(MAX_WIDTH_PX).toBeGreaterThanOrEqual(6);
  });

  it("measures each creek against the catchment that was clicked", () => {
    const data = upstreamLinesData(upstream, 42);
    const sizes = data.features.map((feature) => feature.properties?.size);
    expect(sizes[3]).toBe(1);
    expect(sizes[0]).toBe(0);
    for (const feature of data.features)
      expect(feature.properties?.width).toBe(
        upstreamLineWidth(feature.properties?.size),
      );
  });
});

describe("the creeks spreading out from the press", () => {
  // Mutation: order the creeks as listed, or by distance as the crow flies,
  // and the draw-in jumps about instead of running up the creeks.
  it("places each creek by how far up the network its lower end is", () => {
    const [atGully, atSide, atStub, atTrunk] = upstreamReveal(
      upstream.lines.features,
    );
    expect(atTrunk).toBe(0);
    // The side creek and the stub both start where the trunk ends.
    expect(atSide).toBe(atStub);
    expect(atSide).toBeGreaterThan(0);
    // The gully starts farthest up: past the trunk and the side creek.
    expect(atGully).toBe(1);
  });

  it("starts every creek that runs into nothing drawn at the press", () => {
    expect(upstreamReveal([gully, stub])).toEqual([0, 0]);
    expect(upstreamReveal([])).toEqual([]);
  });

  it("puts the nearest creeks in the first band and the farthest in the last", () => {
    const bands = upstreamLinesData(upstream).features.map(
      (feature) => feature.properties?.band,
    );
    expect(bands[3]).toBe(0);
    expect(bands[0]).toBe(REVEAL_BANDS - 1);
  });

  it("fades the bands in one after another, all shown at the end", () => {
    expect(revealOpacity(0, 0)).toBe(0);
    expect(revealOpacity(0, 0.25)).toBe(1);
    expect(revealOpacity(REVEAL_BANDS - 1, 0.7)).toBe(0);
    for (let band = 0; band < REVEAL_BANDS; band++)
      expect(revealOpacity(band, 1)).toBe(1);
  });

  // Mutation: ignore reduced motion, and the creeks spread for a user who
  // asked for nothing to move (shared/DESIGN.md §11).
  it("shows everything at once for reduced motion", () => {
    const map = fakeMap();
    showUpstream(map, upstream);
    for (const id of UPSTREAM_LINE_LAYERS)
      expect(map.getLayer(id)!.paint["line-opacity"]).toBe(0);
    revealUpstream(map, { reduceMotion: true });
    for (const id of UPSTREAM_LINE_LAYERS)
      expect(map.getLayer(id)!.paint["line-opacity"]).toBe(1);
    expect(
      map.getLayer(CATCHMENT_FILL_LAYER)!.paint["fill-opacity"],
    ).toBeGreaterThan(0);
  });

  it("leaves the creeks fully drawn when stopped halfway", () => {
    const map = fakeMap();
    showUpstream(map, upstream);
    paintReveal(map, 0.1);
    expect(
      map.getLayer(upstreamLineLayer(REVEAL_BANDS - 1))!.paint["line-opacity"],
    ).toBe(0);
    const stop = revealUpstream(map, { reduceMotion: false });
    stop();
    for (const id of UPSTREAM_LINE_LAYERS)
      expect(map.getLayer(id)!.paint["line-opacity"]).toBe(1);
  });
});

describe("the creeks upstream on the map", () => {
  it("paints water blue by size, cased, the trunk over its tributaries", () => {
    const map = fakeMap();
    showUpstream(map, upstream, 42);
    expect(map.getLayer(upstreamLineLayer(0))).toMatchObject({
      filter: ["==", ["get", "band"], 0],
      layout: { "line-sort-key": ["get", "catchmentKm2"] },
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
      },
    });
    expect(map.getLayer(upstreamCasingLayer(0))!.paint["line-color"]).toBe(
      MAP_INK.ring,
    );
  });

  // Mutation: add each band's casing just under its own line, and a far
  // tributary's casing cuts across the trunk where they join.
  it("lays the land under every casing, and every casing under every line", () => {
    const map = fakeMap();
    showUpstream(map, upstream);
    const ids = map.layers.map((layer) => layer.id);
    const casings = Array.from({ length: REVEAL_BANDS }, (_, band) =>
      ids.indexOf(upstreamCasingLayer(band)),
    );
    const lines = UPSTREAM_LINE_LAYERS.map((id) => ids.indexOf(id));
    expect(ids.indexOf(CATCHMENT_FILL_LAYER)).toBeLessThan(
      Math.min(...casings),
    );
    expect(Math.max(...casings)).toBeLessThan(Math.min(...lines));
    // The nearest band, mostly the biggest creeks, on top.
    expect(ids.indexOf(upstreamLineLayer(0))).toBe(ids.length - 1);
  });

  // Mutation: drop `attribution` from either source, and the creeks or the
  // land drawn from the NSW DEM show with no credit (ADR 0031).
  it("credits the DEM while it is drawn, and not after", () => {
    const map = fakeMap();
    showUpstream(map, upstream);
    expect(map.sources.get(UPSTREAM_SOURCE)?.attribution).toBe(
      NSW_5M.creditHtml,
    );
    expect(map.sources.get(CATCHMENT_SOURCE)?.attribution).toBe(
      NSW_5M.creditHtml,
    );
    expect(map.getLayer(CATCHMENT_EDGE_LAYER)).toBeTruthy();
    clearUpstream(map);
    expect(map.sources.size).toBe(0);
    expect(map.layers).toEqual([]);
  });

  it("replaces an earlier drawing rather than failing on it", () => {
    const map = fakeMap();
    showUpstream(map, upstream);
    showUpstream(map, upstream);
    expect(map.layers).toHaveLength(2 + 2 * REVEAL_BANDS);
    clearUpstream(map);
    clearUpstream(map);
  });

  it("draws under the place pins, so a pin on a creek stays pressable", () => {
    const map = fakeMap(["place-highlight"]);
    showUpstream(map, upstream);
    for (const layer of map.layers.slice(1))
      expect(layer.before).toBe("place-highlight");
  });
});

describe("the line to the creek point a catchment was measured at", () => {
  const from = { longitude: 150.3001, latitude: -33.6001 };
  const creek = { longitude: 150.3, latitude: -33.6 };

  // Mutation: draw the line from the creek point to itself, and a snap to the
  // wrong creek looks the same as a snap to the right one.
  it("joins the press to the creek point", () => {
    expect(snapData(from, creek).features.map((f) => f.geometry)).toEqual([
      {
        type: "LineString",
        coordinates: [
          [150.3001, -33.6001],
          [150.3, -33.6],
        ],
      },
    ]);
  });

  it("is dashed, credited, and gone with the panel", () => {
    const map = fakeMap();
    showSnap(map, from, creek, "#abc");
    expect(map.sources.get(SNAP_SOURCE)?.attribution).toBe(NSW_5M.creditHtml);
    expect(map.getLayer(SNAP_LINE_LAYER)).toMatchObject({
      paint: { "line-dasharray": [2, 2] },
    });
    clearSnap(map);
    expect(map.sources.size).toBe(0);
    expect(map.layers).toEqual([]);
  });

  it("follows the scheme's accent; the water does not", () => {
    const map = fakeMap();
    showSnap(map, from, creek, "#abc");
    showUpstream(map, upstream);
    const water = map.getLayer(upstreamLineLayer(0))!.paint["line-color"];
    paintFlowNetwork(map, "#123456");
    expect(map.getLayer(SNAP_LINE_LAYER)!.paint).toMatchObject({
      "line-color": "#123456",
    });
    expect(map.getLayer(upstreamLineLayer(0))!.paint["line-color"]).toEqual(
      water,
    );
    // Nothing drawn: nothing to repaint, and no error.
    paintFlowNetwork(fakeMap(), "#123456");
  });
});
