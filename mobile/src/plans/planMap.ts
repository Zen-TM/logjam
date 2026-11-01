// Plan mode on the map: what the map frames when a plan opens on it. Built at
// navigation time and never stored, like a place's focus: a region of
// interest stays off the server (mobile/AGENTS.md).
import type { TripPlanView } from "@logjam/shared";

import type { MapArtifact } from "../map/sourceResolver";

import { bboxOfPoints, PLACE_FOCUS_DEGREES } from "../saved/bboxOfPoints";

/** The plan's places and ways, as `[west, south, east, north]`, or null. At
 *  least a place's frame on each axis, so places metres apart frame ground as
 *  one place's Show on map does. */
export function planBbox(
  plan: Pick<TripPlanView, "places" | "routes">,
): [number, number, number, number] | null {
  const box = bboxOfPoints([
    ...plan.places.map((place) => ({
      lon: place.longitude,
      lat: place.latitude,
    })),
    ...plan.routes.flatMap((route) =>
      route.points.map(([lon, lat]) => ({ lon, lat })),
    ),
  ]);
  if (!box) return null;
  const widen = (low: number, high: number): [number, number] => {
    const mid = (low + high) / 2;
    const half = Math.max((high - low) / 2, PLACE_FOCUS_DEGREES);
    return [mid - half, mid + half];
  };
  const [west, east] = widen(box[0], box[2]);
  const [south, north] = widen(box[1], box[3]);
  return [west, south, east, north];
}

/** Whether one saved map region already holds the whole of a plan's area,
 *  so "Download the map for this area too" has nothing left to save. */
export function planMapSaved(
  bbox: [number, number, number, number],
  artifacts: readonly Pick<MapArtifact, "kind" | "bbox">[],
): boolean {
  const [west, south, east, north] = bbox;
  // ponytail: one region must hold it all; two that tile the area together
  // still offer the row. A union check if that turns up.
  return artifacts.some(
    ({ kind, bbox: region }) =>
      kind === "basemap-region" &&
      region !== null &&
      region[0] <= west &&
      region[1] <= south &&
      region[2] >= east &&
      region[3] >= north,
  );
}

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
