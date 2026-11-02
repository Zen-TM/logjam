import { describe, expect, it } from "vitest";
import { planExtent } from "./planExtent.js";

describe("planExtent", () => {
  // Mutation that turns it red: leave the routes' points out, or swap a
  // route point's [lon, lat] order.
  it("holds every place and every point of every route", () => {
    expect(
      planExtent({
        places: [{ longitude: 150.3, latitude: -33.5 }],
        routes: [
          {
            points: [
              [150.1, -33.7],
              [150.2, -33.6],
            ],
          },
        ],
      }),
    ).toEqual({ west: 150.1, south: -33.7, east: 150.3, north: -33.5 });
  });

  it("is null for a plan with nothing on the map", () => {
    expect(planExtent({ places: [], routes: [] })).toBeNull();
  });
});
