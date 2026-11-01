// Trip plans over the authed API (api/src/routes/plans.ts and its siblings).
// Online only: a plan is fetched and cached (`plansCache.ts`), never synced,
// and a write waits for a connection.
import type {
  TripPlanAnswerPut,
  TripPlanAnswerView,
  TripPlanCreate,
  TripPlanItem,
  TripPlanItemAdd,
  TripPlanItemKind,
  TripPlanInvitedPreview,
  TripPlanJoinAnswers,
  TripPlanMemberView,
  TripPlanRole,
  TripPlanInviteView,
  TripPlanMemberStatus,
  TripPlanFilePatch,
  TripPlanPatch,
  TripPlanPlacePatch,
  TripPlanRoutePatch,
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

/** What a copy reports beside the new thing's id: a place's photos and files
 *  that didn't come, and whether storage was why. */
export type PlanCopyResult = {
  id: string;
  mediaSkipped?: number;
  mediaOutOfSpace?: true;
};

/** Save a copy: the caller's own copy of a plan item. `copyMedia` is a
 *  place's photos; without it the account's preference decides. */
export const savePlanItem = (
  planId: string,
  kind: TripPlanItemKind,
  itemId: string,
  copyMedia?: boolean,
) =>
  apiFetch<PlanCopyResult>(
    `${plan(planId)}/items/${kind}/${encodeURIComponent(itemId)}/save`,
    { method: "POST", body: copyMedia === undefined ? {} : { copyMedia } },
  );

/** Add a copy: one of the caller's own things into the plan. */
export const addPlanItem = (planId: string, body: TripPlanItemAdd) =>
  apiFetch<{
    item: TripPlanItem;
    mediaSkipped?: number;
    mediaOutOfSpace?: true;
  }>(`${plan(planId)}/items`, { method: "POST", body });

/** What someone invited by username sees before joining; 404 otherwise. */
export const getInvitedPreview = (id: string) =>
  apiFetch<TripPlanInvitedPreview>(`${plan(id)}/preview`);
/** Join as someone invited, with the answers to the forms required to join. */
export const joinPlan = (id: string, answers: TripPlanJoinAnswers) =>
  apiFetch<TripPlanView>(`${plan(id)}/join`, {
    method: "POST",
    body: { answers },
  });

/** A member's answer to a form; 409 if the form or who sees it changed. */
export const putAnswer = (
  planId: string,
  formId: string,
  body: TripPlanAnswerPut,
) =>
  apiFetch<TripPlanAnswerView>(
    `${plan(planId)}/forms/${encodeURIComponent(formId)}/answers/me`,
    { method: "PUT", body },
  );

export const deleteForm = (planId: string, formId: string) =>
  apiFetch<void>(`${plan(planId)}/forms/${encodeURIComponent(formId)}`, {
    method: "DELETE",
  });

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
/**
 * Remove someone going, cancel an invite or turn down a request. `status` is
 * the one the leader saw: if it has changed since (an invite accepted, a
 * request let in by another leader), the API answers 409 and removes nobody.
 * `deleteFiles` deletes the files their storage pays for instead of moving
 * them to the leader's.
 */
export const removeMember = (
  planId: string,
  userId: string,
  status: TripPlanMemberStatus,
  deleteFiles = false,
) =>
  apiFetch<void>(
    `${member(planId, userId)}?status=${status}${deleteFiles ? "&deleteFiles=true" : ""}`,
    { method: "DELETE" },
  );

/** Mint a link. Only this answer carries its token; the list never does
 *  (api/src/__tests__/planInvites.test.ts). */
export const createInviteLink = (planId: string) =>
  apiFetch<{ token: string; expiresAt: string }>(`${plan(planId)}/invites`, {
    method: "POST",
  });
export const getInviteLinks = (planId: string) =>
  apiFetch<{ invites: TripPlanInviteView[] }>(`${plan(planId)}/invites`);
export const revokeInviteLink = (planId: string, inviteId: string) =>
  apiFetch<void>(`${plan(planId)}/invites/${encodeURIComponent(inviteId)}`, {
    method: "DELETE",
  });

const planItem = (planId: string, kind: TripPlanItemKind, itemId: string) =>
  `${plan(planId)}/items/${kind}/${encodeURIComponent(itemId)}`;

/** Edit an item's words, each field as the value last seen and the new one. */
export const patchPlanItem = (
  planId: string,
  kind: TripPlanItemKind,
  itemId: string,
  body: TripPlanPlacePatch | TripPlanRoutePatch | TripPlanFilePatch,
) =>
  apiFetch<TripPlanItem>(planItem(planId, kind, itemId), {
    method: "PATCH",
    body,
  });

export const deletePlanItem = (
  planId: string,
  kind: TripPlanItemKind,
  itemId: string,
) => apiFetch<void>(planItem(planId, kind, itemId), { method: "DELETE" });
