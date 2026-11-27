import {
  MAP_INK,
  WIND_ARROW_IMAGE,
  WEATHER_CREDIT_URL,
  WEATHER_MAP,
  weatherReliefColor,
} from "@logjam/shared";
import { describe, expect, it, vi } from "vitest";
import { WEATHER_ARROWS_LAYER, WEATHER_FIELD_LAYER } from "./layerOrder";
import {
  WEATHER_CREDIT_HTML,
  WEATHER_WIND_SOURCE,
  placeWindArrows,
  syncWindArrows,
  weatherFieldLayerSpec,
  windArrowsLayerSpec,
} from "./weatherLayers";
import { TERRAIN_ENTRIES } from "./terrainEntries";

describe("the colour field", () => {
  // Mutation: read the stops of the default layer whatever the key, and the
  // layer picked in the legend never changes the colours.
  it("is the layer's own stops, opaque because the alpha is in them", () => {
    const spec = weatherFieldLayerSpec("src", "wind");
    expect(spec).toMatchObject({
      id: WEATHER_FIELD_LAYER,
      type: "color-relief",
      source: "src",
    });
    expect(spec.paint).toEqual({
      "color-relief-opacity": 1,
      "color-relief-color": weatherReliefColor("wind"),
    });
    expect(spec.paint!["color-relief-color"]).not.toEqual(
      weatherReliefColor("rain"),
    );
  });
});

describe("the wind arrows' layer", () => {
  const spec = windArrowsLayerSpec(WEATHER_WIND_SOURCE);
  // Mutation: drop icon-rotate or the map alignment, and the arrows all point
  // east, or turn with the map instead of staying on the wind's bearing.
  it("rotates the wind arrow by each point's own bearing, on the map", () => {
    expect(spec.layout).toMatchObject({
      "icon-image": WIND_ARROW_IMAGE,
      "icon-rotate": ["get", "rotate"],
      "icon-rotation-alignment": "map",
    });
  });
  // Mutation: let them block placement, and a town's name goes missing; put
  // a zoom filter back, and a close view loses the arrows between grid points.
  it("hides no label and leaves the spacing to the lattice", () => {
    expect(spec.filter).toBeUndefined();
    expect(spec.layout).toMatchObject({
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    });
  });
  it("is dark ink in a light halo", () => {
    expect(spec.paint).toMatchObject({
      "icon-color": MAP_INK.casing,
      "icon-halo-color": MAP_INK.ring,
    });
  });
});

function fakeMap(ids: string[]) {
  const layers = [...ids];
  const sources = new Map<
    string,
    { setData: ReturnType<typeof vi.fn>; data: unknown }
  >();
  return {
    layers,
    sources,
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: { data: unknown }) => {
      const source = {
        data: spec.data,
        setData: vi.fn((data: unknown) => (source.data = data)),
      };
      sources.set(id, source);
    },
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => (layers.includes(id) ? {} : undefined),
    addLayer: (spec: { id: string }, before?: string) => {
      layers.splice(
        before ? layers.indexOf(before) : layers.length,
        0,
        spec.id,
      );
    },
    removeLayer: (id: string) => layers.splice(layers.indexOf(id), 1),
    moveLayer: (id: string, before?: string) => {
      layers.splice(layers.indexOf(id), 1);
      layers.splice(before ? layers.indexOf(before) : layers.length, 0, id);
    },
    getStyle: () => ({ layers: layers.map((id) => ({ id })) }),
  };
}
const data = { type: "FeatureCollection" as const, features: [] };

describe("syncWindArrows", () => {
  // Mutation: add the layer with no beforeId, and the arrows land over every
  // road and label instead of directly over the field.
  it("puts the arrows directly over the field", () => {
    const map = fakeMap(["a", WEATHER_FIELD_LAYER, "contours"]);
    syncWindArrows(map, data);
    expect(map.layers).toEqual([
      "a",
      WEATHER_FIELD_LAYER,
      WEATHER_ARROWS_LAYER,
      "contours",
    ]);
  });

  // Mutation: return early when the arrows layer exists (the old code), and a
  // Wind to Gusts switch, which rebuilds the field on top of the style, leaves
  // the arrows underneath it.
  it("moves existing arrows back over a rebuilt field", () => {
    const map = fakeMap(["a", WEATHER_FIELD_LAYER, "contours"]);
    syncWindArrows(map, data);
    map.removeLayer(WEATHER_FIELD_LAYER);
    map.layers.push(WEATHER_FIELD_LAYER);
    expect(map.layers[map.layers.length - 1]).toBe(WEATHER_FIELD_LAYER);
    syncWindArrows(map, data);
    expect(map.layers).toEqual([
      "a",
      "contours",
      WEATHER_FIELD_LAYER,
      WEATHER_ARROWS_LAYER,
    ]);
  });

  // Mutation: add a second source on every step, and MapLibre throws on the
  // duplicate id.
  it("moves the arrows to the next step by setting the source's data", () => {
    const map = fakeMap([WEATHER_FIELD_LAYER]);
    syncWindArrows(map, data);
    syncWindArrows(map, data);
    expect(map.layers).toEqual([WEATHER_FIELD_LAYER, WEATHER_ARROWS_LAYER]);
    expect(
      map.sources.get(WEATHER_WIND_SOURCE)!.setData,
    ).toHaveBeenCalledOnce();
  });

  // Mutation: leave the layer when the data goes null, and Rain keeps Wind's
  // arrows.
  it("takes the arrows off for a layer without them", () => {
    const map = fakeMap([WEATHER_FIELD_LAYER]);
    syncWindArrows(map, data);
    syncWindArrows(map, null);
    expect(map.layers).toEqual([WEATHER_FIELD_LAYER]);
    expect(map.sources.size).toBe(0);
  });

  // Mutation: add the arrows without checking for the field, and a failed
  // archive leaves arrows floating over nothing.
  it("draws none while the field is not on the map", () => {
    const map = fakeMap(["a"]);
    syncWindArrows(map, data);
    expect(map.layers).toEqual(["a"]);
    expect(map.sources.size).toBe(0);
  });
});

describe("placeWindArrows", () => {
  const wind = {
    west: 149,
    north: -33,
    step: 0.5,
    columns: 3,
    rows: 3,
    steps: [{ speed: Array(9).fill(10), from: Array(9).fill(270) }],
  };
  const view = (zoom: number) => ({
    getZoom: () => zoom,
    getBounds: () => ({
      getWest: () => 148,
      getSouth: () => -35,
      getEast: () => 151,
      getNorth: () => -32,
    }),
  });
  const placed = (zoom: number) => {
    const map = { ...fakeMap([WEATHER_FIELD_LAYER]), ...view(zoom) };
    placeWindArrows(map, { data: wind, step: 0 });
    return (
      map.sources.get(WEATHER_WIND_SOURCE)!.data as { features: unknown[] }
    ).features.length;
  };

  // Mutation: read the zoom once and not at each call, or pass the grid whole,
  // and zooming in on moveend leaves the same nine arrows.
  it("places more arrows for the same ground as the map zooms in", () => {
    expect(placed(7)).toBe(9);
    expect(placed(9)).toBeGreaterThan(9);
  });
});

describe("the credit", () => {
  // Mutation: change the link's text or target, and CC BY 4.0's attribution
  // names someone else or goes nowhere.
  it("links the job's attribution to Open-Meteo, as the weather entry's attribution", () => {
    expect(WEATHER_CREDIT_HTML).toBe(
      `<a href="${WEATHER_CREDIT_URL}">${WEATHER_MAP.credit}</a>`,
    );
    expect(TERRAIN_ENTRIES.weather.attribution).toBe(WEATHER_CREDIT_HTML);
  });
});
