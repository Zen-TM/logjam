// Plan mode on the map: what the map frames when a plan opens on it. Built at
// navigation time and never stored, like a place's focus: a region of
// interest stays off the server (mobile/AGENTS.md).
import { planExtent, type TripPlanView } from "@logjam/shared";

import type { MapArtifact } from "../map/sourceResolver";

import { coveredByOfflineMaps } from "../offline/coveredByOfflineMaps";
import { PLACE_FOCUS_DEGREES } from "../saved/bboxOfPoints";

/** The plan's places and ways, as `[west, south, east, north]`, or null. At
 *  least a place's frame on each axis, so places metres apart frame ground as
 *  one place's Show on map does. Logjam Web pads differently (`planBounds`). */
export function planBbox(
  plan: Pick<TripPlanView, "places" | "routes">,
): [number, number, number, number] | null {
  const box = planExtent(plan);
  if (!box) return null;
  const widen = (low: number, high: number): [number, number] => {
    const mid = (low + high) / 2;
    const half = Math.max((high - low) / 2, PLACE_FOCUS_DEGREES);
    return [mid - half, mid + half];
  };
  const [west, east] = widen(box.west, box.east);
  const [south, north] = widen(box.south, box.north);
  return [west, south, east, north];
}

/** Whether one saved map region already holds the whole of a plan's area,
 *  so "Download the map for this area" has nothing left to save. */
export const planMapSaved = coveredByOfflineMaps;

/** Whether a pressed pin is one of the plan's places, not one of the user's:
 *  a plan's pin opens its place sheet, the user's their own options. */
export function isPlanPin(
  plan: Pick<TripPlanView, "places"> | null,
  id: string,
): boolean {
  return plan?.places.some((place) => place.id === id) ?? false;
}

/** What opened plan mode: Show on map's params, replaced on each arrival. */
export type PlanModeParam =
  | { planId: string; nonce: number }
  | null
  | undefined;

/**
 * Plan mode on the map. The plan shown is set by arriving for it, and cleared
 * by the plan's close button, by arriving for anything else (the params are replaced,
 * not merged), or by its cached copy going.
 */
export type PlanModeState = {
  arrivedFor: PlanModeParam;
  shownPlanId: string | null;
  /** The plan's cached copy, once read. */
  plan: TripPlanView | null;
};

export type PlanModeEvent =
  | { type: "arrive"; planMode: PlanModeParam }
  | { type: "read"; plan: TripPlanView | null }
  | { type: "leave" };

export const planModeStart = (planMode: PlanModeParam): PlanModeState => ({
  arrivedFor: planMode,
  shownPlanId: planMode?.planId ?? null,
  plan: null,
});

export function planModeReducer(
  state: PlanModeState,
  event: PlanModeEvent,
): PlanModeState {
  switch (event.type) {
    case "arrive":
      return {
        ...planModeStart(event.planMode),
        // The old plan stays drawn until the new one is read.
        plan: event.planMode ? state.plan : null,
      };
    case "read":
      return event.plan
        ? { ...state, plan: event.plan }
        : { ...state, shownPlanId: null, plan: null };
    case "leave":
      return { ...state, shownPlanId: null, plan: null };
  }
}

/** How faint the user's own things draw under a plan, on every layer. */
export const PLAN_DIM = 0.4;

/** The same pins, drawn faint (`muted` in the pin layers' style). */
export function mutedFeatures<F extends { features: { properties: object }[] }>(
  fc: F,
): F {
  return {
    ...fc,
    features: fc.features.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, muted: true },
    })),
  };
}
