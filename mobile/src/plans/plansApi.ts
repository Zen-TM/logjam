// Trip plans over the authed API (api/src/routes/plans.ts and its siblings).
// Online only: a plan is fetched and cached (`plansCache.ts`), never synced,
// and a write waits for a connection.
import type {
  TripPlanCreate,
  TripPlanPatch,
  TripPlanSummary,
  TripPlanView,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";

const plan = (id: string) => `/plans/${encodeURIComponent(id)}`;

export function getPlans(): Promise<{ plans: TripPlanSummary[] }> {
  return apiFetch("/plans");
}

export function getPlan(planId: string): Promise<TripPlanView> {
  return apiFetch(plan(planId));
}

export const createPlan = (body: TripPlanCreate) =>
  apiFetch<TripPlanView>("/plans", { method: "POST", body });
export const patchPlan = (id: string, body: TripPlanPatch) =>
  apiFetch<TripPlanView>(plan(id), { method: "PATCH", body });
export const archivePlan = (id: string, archived: boolean) =>
  apiFetch<TripPlanSummary>(`${plan(id)}/archive`, {
    method: "POST",
    body: { archived },
  });
export const deletePlan = (id: string) =>
  apiFetch<void>(plan(id), { method: "DELETE" });
/** Leave, decline an invite or withdraw a request: one call, by status. */
export const leavePlan = (id: string) =>
  apiFetch<void>(`${plan(id)}/members/me`, { method: "DELETE" });
