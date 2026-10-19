// The /plans calls Logjam Web makes, and the list and plan hooks. Shapes
// and limits are `@logjam/shared`'s `tripPlans.ts`; nothing here re-lists them.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TRIP_PLAN_PAGE,
  TRIP_PLANS_LIST,
  type TripPlanAnswerPut,
  type TripPlanAnswerView,
  type TripPlanCreate,
  type TripPlanFormCreate,
  type TripPlanFormPatch,
  type TripPlanFormView,
  type TripPlanInvitedPreview,
  type TripPlanInviteView,
  type TripPlanJoinAnswers,
  type TripPlanLinkPreview,
  type TripPlanMemberView,
  type TripPlanRedeemResult,
  type TripPlanRole,
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

const form = (planId: string, formId: string) =>
  `${plan(planId)}/forms/${encodeURIComponent(formId)}`;

export const createForm = (planId: string, body: TripPlanFormCreate) =>
  apiFetch<TripPlanFormView>(`${plan(planId)}/forms`, { method: "POST", body });
export const patchForm = (
  planId: string,
  formId: string,
  body: TripPlanFormPatch,
) =>
  apiFetch<TripPlanFormView>(form(planId, formId), { method: "PATCH", body });
export const deleteForm = (planId: string, formId: string) =>
  apiFetch<void>(form(planId, formId), { method: "DELETE" });
export const putAnswer = (
  planId: string,
  formId: string,
  body: TripPlanAnswerPut,
) =>
  apiFetch<TripPlanAnswerView>(`${form(planId, formId)}/answers/me`, {
    method: "PUT",
    body,
  });

const member = (planId: string, userId: string) =>
  `${plan(planId)}/members/${encodeURIComponent(userId)}`;

export const inviteMember = (
  planId: string,
  username: string,
  role: TripPlanRole,
) =>
  apiFetch<TripPlanMemberView>(`${plan(planId)}/members`, {
    method: "POST",
    body: { username, role },
  });
export const setMemberRole = (
  planId: string,
  userId: string,
  role: TripPlanRole,
) =>
  apiFetch<TripPlanMemberView>(member(planId, userId), {
    method: "PATCH",
    body: { role },
  });
export const approveMember = (planId: string, userId: string) =>
  apiFetch<TripPlanMemberView>(`${member(planId, userId)}/approve`, {
    method: "POST",
  });
/** Remove someone, turn down a request or cancel an invite: one call, by status. */
export const removeMember = (
  planId: string,
  userId: string,
  deleteFiles = false,
) =>
  apiFetch<void>(
    `${member(planId, userId)}${deleteFiles ? "?deleteFiles=true" : ""}`,
    { method: "DELETE" },
  );
export const getInvitedPreview = (planId: string) =>
  apiFetch<TripPlanInvitedPreview>(`${plan(planId)}/preview`);
export const joinPlan = (planId: string, answers: TripPlanJoinAnswers) =>
  apiFetch<TripPlanView>(`${plan(planId)}/join`, {
    method: "POST",
    body: { answers },
  });

export const createInviteLink = (planId: string) =>
  apiFetch<{ token: string; expiresAt: string }>(`${plan(planId)}/invites`, {
    method: "POST",
  });
export const getInviteLinks = (planId: string) =>
  apiFetch<{ invites: TripPlanInviteView[] }>(`${plan(planId)}/invites`).then(
    (body) => body.invites,
  );
export const revokeInviteLink = (planId: string, inviteId: string) =>
  apiFetch<void>(`${plan(planId)}/invites/${encodeURIComponent(inviteId)}`, {
    method: "DELETE",
  });
/** The token only ever travels in a POST body (design §2.3). */
export const previewInviteLink = (token: string) =>
  apiFetch<TripPlanLinkPreview>("/plan-invites/preview", {
    method: "POST",
    body: { token },
  });
export const redeemInviteLink = (token: string, answers: TripPlanJoinAnswers) =>
  apiFetch<TripPlanRedeemResult>("/plan-invites/redeem", {
    method: "POST",
    body: { token, answers },
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

/**
 * GET /plans/:id: the full fetch the plan's page renders from. A first load
 * that fails is `error` (the page shows it in place); a later one that fails
 * while a view is shown goes to `onBackgroundError` (a toast), unless the
 * refetch was asked `quiet`: after a write whose own failure was just said.
 */
export function usePlan(
  id: string | null,
  onBackgroundError?: (message: string) => void,
) {
  const [view, setView] = useState<TripPlanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState({ count: 0, quiet: false });
  const report = useRef(onBackgroundError);
  // Which plan a view has loaded for: a failure before then is the page's.
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    report.current = onBackgroundError;
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getPlan(id)
      .then((data) => {
        if (cancelled) return;
        loaded.current = id;
        setView(data);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        const message = messageFromError(err, TRIP_PLAN_PAGE.copy.loadFailed);
        if (loaded.current !== id) setError(message);
        else if (!request.quiet) report.current?.(message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, request]);

  const refetch = useCallback(
    (options?: { quiet?: boolean }) =>
      setRequest((was) => ({
        count: was.count + 1,
        quiet: options?.quiet ?? false,
      })),
    [],
  );
  // A view of another plan is never shown while this one loads.
  return { view: view?.id === id ? view : null, error, refetch, setView };
}
