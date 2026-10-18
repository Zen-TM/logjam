// The /plans calls Logjam Web makes (design §2), and the list hook. Shapes
// and limits are `@logjam/shared`'s `tripPlans.ts`; nothing here re-lists them.
import { useCallback, useEffect, useState } from "react";
import {
  TRIP_PLAN_PAGE,
  TRIP_PLANS_LIST,
  type TripPlanCreate,
  type TripPlanPatch,
  type TripPlanSectionCreate,
  type TripPlanSectionPatch,
  type TripPlanSectionView,
  type TripPlanSummary,
  type TripPlanView,
} from "@logjam/shared";
import { apiFetch } from "./placeUtils";
import { messageFromError } from "./errors/messageFromError";

const plan = (id: string) => `/plans/${encodeURIComponent(id)}`;

export const getPlans = () =>
  apiFetch<{ plans: TripPlanSummary[] }>("/plans").then((body) => body.plans);
export const getPlan = (id: string) => apiFetch<TripPlanView>(plan(id));
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
export const leavePlan = (id: string, deleteAdded = false) =>
  apiFetch<void>(
    `${plan(id)}/members/me${deleteAdded ? "?deleteAdded=true" : ""}`,
    { method: "DELETE" },
  );

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
  apiFetch<TripPlanSectionView>(
    `${plan(planId)}/sections/${encodeURIComponent(sectionId)}`,
    { method: "PATCH", body },
  );
export const reorderSections = (planId: string, ids: string[]) =>
  apiFetch<{ sections: TripPlanSectionView[] }>(
    `${plan(planId)}/sections/order`,
    { method: "PUT", body: { ids } },
  );
export const deleteSection = (planId: string, sectionId: string) =>
  apiFetch<void>(`${plan(planId)}/sections/${encodeURIComponent(sectionId)}`, {
    method: "DELETE",
  });

/** GET /plans: the cheap list, for the Plans page and the nav badge. */
export function usePlans(enabled: boolean) {
  const [plans, setPlans] = useState<TripPlanSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    // Guards a stale in-flight response landing after a newer one.
    let cancelled = false;
    getPlans()
      .then((data) => {
        if (cancelled) return;
        setPlans(data);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled)
          setError(messageFromError(err, TRIP_PLANS_LIST.copy.loadFailed));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);
  return { plans, loaded, error, refetch };
}

/** GET /plans/:id: the full fetch the plan's page renders from. */
export function usePlan(id: string | null) {
  const [view, setView] = useState<TripPlanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getPlan(id)
      .then((data) => {
        if (cancelled) return;
        setView(data);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled)
          setError(messageFromError(err, TRIP_PLAN_PAGE.copy.loadFailed));
      });
    return () => {
      cancelled = true;
    };
  }, [id, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);
  // A view of another plan is never shown while this one loads.
  return { view: view?.id === id ? view : null, error, refetch, setView };
}
