import { describe, expect, it } from "vitest";

import type { TripPlanPlace } from "./tripPlans.js";
import { tripPlanTripLogMatches } from "./tripPlanTripLog.js";

const plan = (id: string, name: string, latitude: number, longitude: number) =>
  ({ id, name, latitude, longitude }) as TripPlanPlace;
const own = (
  id: string,
  name: string,
  latitude: number,
  longitude: number,
) => ({
  id,
  name,
  latitude,
  longitude,
});

describe("tripPlanTripLogMatches", () => {
  // Mutations: match on name alone (the moved place links); return the plan
  // place's id instead of the caller's (the trip would link a row the API
  // refuses); keep the unmatched ones (a place left out is offered).
  it("pairs a plan place with the caller's own, in plan order, and drops the rest", () => {
    const matches = tripPlanTripLogMatches(
      [
        plan("p1", "Claustral", -33.6, 150.3),
        plan("p2", "Ranon", -33.7, 150.4),
        plan("p3", "Tom Thumb", -33.8, 150.5),
      ],
      [
        own("mine-3", "Tom Thumb", -33.8, 150.5),
        own("mine-1", "Claustral", -33.6, 150.3),
        own("moved", "Ranon", -33.71, 150.4),
        own("twin", "Claustral", -33.6, 150.3),
      ],
    );
    expect(matches.map((m) => [m.place.id, m.own.id])).toEqual([
      ["p1", "mine-1"],
      ["p3", "mine-3"],
    ]);
  });
});
