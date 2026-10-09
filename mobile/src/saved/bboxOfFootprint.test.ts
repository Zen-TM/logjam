import { describe, expect, it } from "vitest";
import { bboxOfFootprint } from "./bboxOfPoints";

describe("bboxOfFootprint", () => {
  it("boxes a polygon", () => {
    expect(
      bboxOfFootprint({
        coordinates: [
          [
            [150.1, -33.9],
            [150.3, -33.9],
            [150.3, -33.7],
            [150.1, -33.7],
            [150.1, -33.9],
          ],
        ],
      }),
    ).toEqual([150.1, -33.9, 150.3, -33.7]);
  });

  it("boxes a multipolygon across its parts", () => {
    expect(
      bboxOfFootprint({
        coordinates: [
          [
            [
              [150, -34],
              [150.1, -34],
              [150.1, -33.9],
              [150, -34],
            ],
          ],
          [
            [
              [151, -33],
              [151.1, -33],
              [151.1, -32.9],
              [151, -33],
            ],
          ],
        ],
      }),
    ).toEqual([150, -34, 151.1, -32.9]);
  });

  // Red when a missing footprint is boxed as an empty extent: the card would
  // fly the map to 0,0 instead of saying it has nowhere to go.
  it("is null when there is nothing to box", () => {
    expect(bboxOfFootprint(null)).toBeNull();
    expect(bboxOfFootprint({ coordinates: [] })).toBeNull();
  });
});
