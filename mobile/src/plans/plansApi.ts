// Trip plans over the authed API (api/src/routes/plans.ts and its siblings).
// Online only: a plan is fetched and cached (`plansCache.ts`), never synced,
// and a write waits for a connection.
import type { TripPlanSummary, TripPlanView } from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";

export function getPlans(): Promise<{ plans: TripPlanSummary[] }> {
  return apiFetch("/plans");
}

export function getPlan(planId: string): Promise<TripPlanView> {
  return apiFetch(`/plans/${encodeURIComponent(planId)}`);
}
