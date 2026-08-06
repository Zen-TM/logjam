import { describe, it, expect, vi } from "vitest";

import { collectSnapLines, snapKindsFor } from "./snapLines";

function collection(
  features: GeoJSON.Feature[],
): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}

const line = (coords: [number, number][]): GeoJSON.Feature => ({
  type: "Feature",
  properties: { kind: "path" },
  geometry: { type: "LineString", coordinates: coords },
});

const SCREEN: GeoJSON.BBox = [0, 400, 800, 0];

describe("snapKindsFor", () => {
  it("asks for nothing when snapping is off", () => {
    expect(snapKindsFor("off")).toEqual([]);
  });

  it("keeps trails and waterways separable", () => {
    expect(snapKindsFor("trails")).toEqual(["path"]);
    expect(snapKindsFor("waterways")).toEqual(["stream", "river", "canal"]);
    expect(snapKindsFor("both")).toEqual([
      "path",
      "stream",
      "river",
      "canal",
    ]);
  });
});

describe("collectSnapLines", () => {
  it("does not query the map at all when snapping is off", async () => {
    const queryRect = vi.fn();
    expect(await collectSnapLines(queryRect as never, "off", SCREEN)).toEqual([]);
    expect(queryRect).not.toHaveBeenCalled();
  });

  it("filters on kind so unrelated rendered features never arrive", async () => {
    const queryRect = vi.fn().mockResolvedValue(collection([]));
    await collectSnapLines(queryRect as never, "waterways", SCREEN);
    const [, filter] = queryRect.mock.calls[0]!;
    expect(filter).toEqual([
      "in",
      ["get", "kind"],
      ["literal", ["stream", "river", "canal"]],
    ]);
  });

  it("returns line geometry as snappable ways", async () => {
    const queryRect = vi.fn().mockResolvedValue(
      collection([
        line([
          [150, -33],
          [150.001, -33.001],
        ]),
      ]),
    );
    const lines = await collectSnapLines(queryRect as never, "trails", SCREEN);
    expect(lines).toEqual([
      {
        coords: [
          [150, -33],
          [150.001, -33.001],
        ],
      },
    ]);
  });

  it("splits a multi-line feature into its parts", async () => {
    const queryRect = vi.fn().mockResolvedValue(
      collection([
        {
          type: "Feature",
          properties: { kind: "stream" },
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [150, -33],
                [150.001, -33],
              ],
              [
                [150.002, -33],
                [150.003, -33],
              ],
            ],
          },
        },
      ]),
    );
    const lines = await collectSnapLines(queryRect as never, "waterways", SCREEN);
    expect(lines).toHaveLength(2);
  });

  it("drops polygons — a lake is not something to route along", async () => {
    const queryRect = vi.fn().mockResolvedValue(
      collection([
        {
          type: "Feature",
          properties: { kind: "stream" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [150, -33],
                [150.001, -33],
                [150.001, -33.001],
                [150, -33],
              ],
            ],
          },
        },
      ]),
    );
    expect(await collectSnapLines(queryRect as never, "waterways", SCREEN)).toEqual(
      [],
    );
  });

  it("falls back to no ways when the map cannot answer", async () => {
    // A raster basemap has no queryable geometry; that is a straight line, not
    // an error to surface mid-draw.
    const queryRect = vi.fn().mockRejectedValue(new Error("no such layer"));
    expect(await collectSnapLines(queryRect as never, "trails", SCREEN)).toEqual(
      [],
    );
  });

  it("tolerates a response with no features array", async () => {
    const queryRect = vi.fn().mockResolvedValue({ type: "FeatureCollection" });
    expect(await collectSnapLines(queryRect as never, "trails", SCREEN)).toEqual(
      [],
    );
  });
});
