// Trip plans over the authed API (api/src/routes/plans.ts and its siblings).
// Online only: a plan is fetched and cached (`plansCache.ts`), never synced,
// and a write waits for a connection.
import type {
  TripPlanCreate,
  TripPlanMemberView,
  TripPlanRole,
  TripPlanUserRef,
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

const member = (planId: string, userId: string) =>
  `${plan(planId)}/members/${encodeURIComponent(userId)}`;

/** Invite by username: they are invited, and join when they answer. */
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
/** Let in someone who asked with a link. */
export const approveMember = (planId: string, userId: string) =>
  apiFetch<TripPlanMemberView>(`${member(planId, userId)}/approve`, {
    method: "POST",
  });
/** Remove someone going, cancel an invite or turn down a request. */
export const removeMember = (planId: string, userId: string) =>
  apiFetch<void>(member(planId, userId), { method: "DELETE" });

/** A live invite link, as the API lists it: never the link itself. */
export type PlanInviteLink = {
  id: string;
  createdAt: string;
  expiresAt: string;
  createdBy: TripPlanUserRef;
};
/** Mint a link. Its token is in this answer and nowhere else, ever. */
export const createInviteLink = (planId: string) =>
  apiFetch<{ token: string; expiresAt: string }>(`${plan(planId)}/invites`, {
    method: "POST",
  });
export const getInviteLinks = (planId: string) =>
  apiFetch<{ invites: PlanInviteLink[] }>(`${plan(planId)}/invites`);
export const revokeInviteLink = (planId: string, inviteId: string) =>
  apiFetch<void>(`${plan(planId)}/invites/${encodeURIComponent(inviteId)}`, {
    method: "DELETE",
  });
