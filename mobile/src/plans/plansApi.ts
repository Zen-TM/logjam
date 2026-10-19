// Trip plans over the authed API (api/src/routes/plans.ts and its siblings).
// Online only: a plan is fetched and cached (`plansCache.ts`), never synced,
// and a write waits for a connection.
import type {
  TripPlanCreate,
  TripPlanPatch,
  TripPlanSectionCreate,
  TripPlanSectionPatch,
  TripPlanSectionView,
  TripPlanSummary,
  TripPlanView,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";

const plan = (id: string) => `/plans/${encodeURIComponent(id)}`;
const section = (planId: string, id: string) =>
  `${plan(planId)}/sections/${encodeURIComponent(id)}`;

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

export const createSection = (planId: string, body: TripPlanSectionCreate) =>
  apiFetch<TripPlanSectionView>(`${plan(planId)}/sections`, {
    method: "POST",
    body,
  });
export const patchSection = (
  planId: string,
  sectionId: string,
  body: TripPlanSectionPatch,
) =>
  apiFetch<TripPlanSectionView>(section(planId, sectionId), {
    method: "PATCH",
    body,
  });
export const reorderSections = (planId: string, ids: string[]) =>
  apiFetch<{ sections: TripPlanSectionView[] }>(
    `${plan(planId)}/sections/order`,
    { method: "PUT", body: { ids } },
  );
export const deleteSection = (planId: string, sectionId: string) =>
  apiFetch<void>(section(planId, sectionId), { method: "DELETE" });
