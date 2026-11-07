import {
  MAP_INK,
  ROUTE_ARROW_IMAGE,
  WEATHER_CREDIT_URL,
  WEATHER_MAP,
  weatherReliefColor,
} from "@logjam/shared";
import { describe, expect, it, vi } from "vitest";
import { WEATHER_ARROWS_LAYER, WEATHER_FIELD_LAYER } from "./layerOrder";
import {
  WEATHER_CREDIT_HTML,
  WEATHER_WIND_SOURCE,
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
  it("rotates the route arrowhead by each point's own bearing, on the map", () => {
    expect(spec.layout).toMatchObject({
      "icon-image": ROUTE_ARROW_IMAGE,
      "icon-rotate": ["get", "rotate"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": false,
    });
  });
  // Mutation: set icon-allow-overlap true, and a state-wide view is a solid
  // mat of arrowheads.
  it("drops arrows that overlap, the strongest placed first", () => {
    expect(spec.layout!["icon-allow-overlap"]).toBe(false);
    expect(spec.layout!["symbol-sort-key"]).toEqual(["-", 0, ["get", "speed"]]);
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
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  return {
    layers,
    sources,
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
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
