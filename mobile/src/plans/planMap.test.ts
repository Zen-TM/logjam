import { describe, expect, it } from "vitest";
import {
  isPlanPin,
  planBbox,
  planModeMine,
  planModeReducer,
  planModeStart,
} from "./planMap";

const place = (longitude: number, latitude: number) =>
  ({ longitude, latitude }) as never;

describe("what plan mode frames", () => {
  it("is every place and every way's points", () => {
    const box = planBbox({
      places: [place(150.3, -33.5)],
      routes: [{ points: [[150.4, -33.6]] } as never],
    })!;
    [150.3, -33.6, 150.4, -33.5].forEach((edge, i) =>
      expect(box[i]).toBeCloseTo(edge),
    );
  });

  // Mutation: drop the widening. One place, or places metres apart, would
  // frame a street's width instead of the ~1 km a place's Show on map does.
  it("frames ground around a single place", () => {
    const [west, south, east, north] = planBbox({
      places: [place(150.3, -33.5)],
      routes: [],
    })!;
    expect(east - west).toBeCloseTo(0.01);
    expect(north - south).toBeCloseTo(0.01);
  });

  it("is nothing for a plan with nothing on the map", () => {
    expect(planBbox({ places: [], routes: [] })).toBeNull();
  });
});

describe("plan mode on the map", () => {
  const a = { planId: "a", nonce: 1 };
  const b = { planId: "b", nonce: 2 };
  const plan = (id: string) => ({ id, places: [] }) as never;
  const showing = planModeReducer(planModeStart(a), {
    type: "read",
    plan: plan("a"),
  });

  // Mutation: keep shownPlanId on a new arrival, and Show on map for plan B
  // re-reads plan A.
  it("a new Show on map replaces the plan shown", () => {
    const next = planModeReducer(showing, { type: "arrive", planMode: b });
    expect(next.shownPlanId).toBe("b");
    expect(next.arrivedFor).toBe(b);
  });

  // Mutation: leave `plan` set when the params carry no planMode, and the
  // user's own Show on map stays in plan A.
  it("arriving for anything else ends plan mode", () => {
    const next = planModeReducer(showing, {
      type: "arrive",
      planMode: undefined,
    });
    expect(next.shownPlanId).toBeNull();
    expect(next.plan).toBeNull();
    expect(planModeMine(next)).toBe(true);
  });

  // Mutation: ignore a read with no cached copy, and a plan the user left
  // stays drawn on the map.
  it("a plan gone from the cache ends plan mode", () => {
    const next = planModeReducer(showing, { type: "read", plan: null });
    expect(next.shownPlanId).toBeNull();
    expect(next.plan).toBeNull();
  });

  // Mutation: carry Show my things into the next plan, and it opens with
  // the user's own things drawn over it.
  it("a new plan starts with only its own things", () => {
    const mineOn = planModeReducer(showing, { type: "toggleMine" });
    expect(planModeMine(mineOn)).toBe(true);
    const next = planModeReducer(mineOn, { type: "arrive", planMode: b });
    expect(next.showMine).toBe(false);
  });

  // Mutation: make `mine` false whenever a plan id is set, and the map is
  // empty while the plan is being read.
  it("draws the user's own things until the plan is read", () => {
    expect(planModeMine(planModeStart(a))).toBe(true);
    expect(planModeMine(showing)).toBe(false);
  });
});

describe("isPlanPin", () => {
  // Mutation: return true for any id while a plan is shown. The user's own
  // pins would open the plan's sheet and find nothing.
  it("is true only for the plan's places, and never with no plan shown", () => {
    const plan = { places: [{ id: "p1" }] } as never;
    expect(isPlanPin(plan, "p1")).toBe(true);
    expect(isPlanPin(plan, "mine")).toBe(false);
    expect(isPlanPin(null, "p1")).toBe(false);
  });
});
