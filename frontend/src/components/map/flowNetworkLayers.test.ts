import { describe, expect, it } from "vitest";
import { NSW_5M, type FlowNetworkUpstream } from "@logjam/shared";
import {
  SNAP_LINE_LAYER,
  SNAP_POINT_LAYER,
  SNAP_SOURCE,
  UPSTREAM_LAYER,
  UPSTREAM_SOURCE,
  clearSnap,
  clearUpstream,
  paintFlowNetwork,
  showSnap,
  showUpstream,
  snapData,
  upstreamLineWidth,
  upstreamLinesData,
} from "./flowNetworkLayers";

/** As much of MapLibre's style bookkeeping as these functions touch. */
function fakeMap(existingLayers: string[] = []) {
  const sources = new Map<string, { attribution?: string }>();
  const layers: { id: string; before?: string; paint: object }[] =
    existingLayers.map((id) => ({ id, paint: {} }));
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
      layer: { id: string; source: string; paint: object },
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

const upstream: FlowNetworkUpstream = {
  lines: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [150.3, -33.6],
            [150.31, -33.61],
          ],
        },
        properties: { catchmentKm2: 0.05, streamOrder: 1 },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [150.31, -33.61],
            [150.32, -33.62],
          ],
        },
        properties: { catchmentKm2: 42, streamOrder: 4 },
      },
    ],
  },
  bbox: [150.3, -33.62, 150.32, -33.6],
};

describe("the creeks upstream", () => {
  // Mutation: scale the width linearly, and every tributary of a 600 km² river
  // is a hairline beside a trunk wider than the map.
  it("widens a creek one step per tenfold of land it drains, within bounds", () => {
    expect(upstreamLineWidth(0.01)).toBe(1);
    expect(upstreamLineWidth(0.1)).toBeCloseTo(2.25);
    expect(upstreamLineWidth(1)).toBeCloseTo(3.5);
    expect(upstreamLineWidth(10)).toBeCloseTo(4.75);
    expect(upstreamLineWidth(100)).toBe(6);
    expect(upstreamLineWidth(10_000)).toBe(6);
    expect(upstreamLineWidth(0)).toBe(1);
  });

  it("draws each line at its own width, and the trunk over its tributaries", () => {
    const data = upstreamLinesData(upstream);
    expect(data.features.map((feature) => feature.properties)).toEqual([
      { catchmentKm2: 0.05, width: upstreamLineWidth(0.05) },
      { catchmentKm2: 42, width: upstreamLineWidth(42) },
    ]);
    const map = fakeMap();
    showUpstream(map, upstream, "#abc");
    expect(map.layers[0]).toMatchObject({
      id: UPSTREAM_LAYER,
      layout: { "line-sort-key": ["get", "catchmentKm2"] },
      paint: { "line-color": "#abc", "line-width": ["get", "width"] },
    });
  });

  // Mutation: drop `attribution` from the source, and the creeks drawn from
  // the NSW DEM show with no credit (ADR 0031).
  it("credits the DEM while it is drawn, and not after", () => {
    const map = fakeMap();
    showUpstream(map, upstream, "#abc");
    expect(map.sources.get(UPSTREAM_SOURCE)?.attribution).toBe(
      NSW_5M.creditHtml,
    );
    clearUpstream(map);
    expect(map.sources.size).toBe(0);
    expect(map.layers).toEqual([]);
  });

  it("replaces an earlier drawing rather than failing on it", () => {
    const map = fakeMap();
    showUpstream(map, upstream, "#abc");
    showUpstream(map, upstream, "#def");
    expect(map.layers.map((layer) => layer.id)).toEqual([UPSTREAM_LAYER]);
    clearUpstream(map);
    clearUpstream(map);
  });

  it("draws under the place pins, so a pin on a creek stays pressable", () => {
    const map = fakeMap(["place-highlight"]);
    showUpstream(map, upstream, "#abc");
    expect(map.layers[map.layers.length - 1]).toMatchObject({
      id: UPSTREAM_LAYER,
      before: "place-highlight",
    });
  });
});

describe("the creek point a catchment was measured at", () => {
  const press = { longitude: 150.3001, latitude: -33.6001 };
  const creek = { longitude: 150.3, latitude: -33.6 };

  // Mutation: draw the line from the creek point to itself, and a snap to the
  // wrong creek looks the same as a snap to the right one.
  it("joins the press to the creek point with a line, and marks the creek point", () => {
    expect(snapData(press, creek).features.map((f) => f.geometry)).toEqual([
      {
        type: "LineString",
        coordinates: [
          [150.3001, -33.6001],
          [150.3, -33.6],
        ],
      },
      { type: "Point", coordinates: [150.3, -33.6] },
    ]);
  });

  it("is dashed, credited, and gone with the panel", () => {
    const map = fakeMap();
    showSnap(map, press, creek, "#abc");
    expect(map.sources.get(SNAP_SOURCE)?.attribution).toBe(NSW_5M.creditHtml);
    expect(map.getLayer(SNAP_LINE_LAYER)).toMatchObject({
      paint: { "line-dasharray": [2, 2] },
    });
    expect(map.getLayer(SNAP_POINT_LAYER)).toBeTruthy();
    clearSnap(map);
    expect(map.sources.size).toBe(0);
    expect(map.layers).toEqual([]);
  });

  it("follows the scheme's accent when the scheme changes", () => {
    const map = fakeMap();
    showSnap(map, press, creek, "#abc");
    showUpstream(map, upstream, "#abc");
    paintFlowNetwork(map, "#123456");
    expect(map.getLayer(UPSTREAM_LAYER)!.paint).toMatchObject({
      "line-color": "#123456",
    });
    expect(map.getLayer(SNAP_LINE_LAYER)!.paint).toMatchObject({
      "line-color": "#123456",
    });
    expect(map.getLayer(SNAP_POINT_LAYER)!.paint).toMatchObject({
      "circle-stroke-color": "#123456",
    });
    // Nothing drawn: nothing to repaint, and no error.
    paintFlowNetwork(fakeMap(), "#123456");
  });
});
