// Who's in a plan, as a leader runs it: a role's name, a person's ⋯ and its
// confirm, for both clients' People (TRIP_PLAN_PAGE's `people`). The API
// refuses the same (`api/src/routes/planMembers.ts`): only a leader changes a
// role or removes someone, and a plan keeps at least one leader.
import type {
  TripPlanMemberStatus,
  TripPlanRole,
  TripPlanUserRef,
} from "../tripPlans.js";
import type { IconIdea } from "../icons.js";
import type { PlanConfirmCopy, PlanVerb } from "./planVerbs.js";

export const TRIP_PLAN_ROLE_LABELS: Record<TripPlanRole, string> = {
  leader: "Leader",
  editor: "Editor",
  member: "Member",
};

export const TRIP_PLAN_PEOPLE_COPY = {
  roleFailed: "Couldn't change their role.",
  removed: "Removed from the plan.",
  removeFailed: "Couldn't remove them.",
  letIn: "Let in.",
  letInFailed: "Couldn't let them in.",
  turnedDown: "Turned down.",
  turnDownFailed: "Couldn't turn them down.",
  inviteCancelled: "Invite cancelled.",
  inviteCancelFailed: "Couldn't cancel the invite.",
} as const;

export type PlanMemberVerbId =
  | "makeLeader"
  | "makeEditor"
  | "makeMember"
  | "remove"
  | "cancelInvite";

const MAKE: Record<
  TripPlanRole,
  { id: PlanMemberVerbId; label: string; icon: IconIdea }
> = {
  leader: { id: "makeLeader", label: "Make a leader", icon: "flag" },
  editor: { id: "makeEditor", label: "Make an editor", icon: "edit" },
  member: { id: "makeMember", label: "Make a member", icon: "account" },
};

const verb = (
  id: PlanMemberVerbId,
  label: string,
  icon: IconIdea,
  danger = false,
): PlanVerb<PlanMemberVerbId> => ({
  id,
  label,
  icon,
  danger,
  separated: danger,
});

/**
 * A person's ⋯ for the caller: only a leader has one, and never on their own
 * row (they leave from the plan's ⋯). An active person can be given either
 * other role, or removed; an invite can be cancelled. A request is answered
 * with its own Let in and Turn down, not a menu.
 */
export function planMemberVerbs(
  callerRole: TripPlanRole,
  callerId: string,
  member: {
    user: TripPlanUserRef;
    role: TripPlanRole;
    status: TripPlanMemberStatus;
  },
): PlanVerb<PlanMemberVerbId>[] {
  if (callerRole !== "leader" || member.user.id === callerId) return [];
  if (member.status === "invited")
    return [verb("cancelInvite", "Cancel invite", "close", true)];
  if (member.status !== "active") return [];
  return [
    ...(["leader", "editor", "member"] as const)
      .filter((role) => role !== member.role)
      .map((role) => verb(MAKE[role].id, MAKE[role].label, MAKE[role].icon)),
    verb("remove", "Remove from plan", "unshare", true),
  ];
}

/** The role a make-verb gives. */
export function planMemberVerbRole(id: PlanMemberVerbId): TripPlanRole | null {
  return id === "makeLeader"
    ? "leader"
    : id === "makeEditor"
      ? "editor"
      : id === "makeMember"
        ? "member"
        : null;
}

export function planMemberRemoveConfirm(username: string): PlanConfirmCopy {
  return {
    confirmTitle: `Remove ${username}?`,
    confirmBody:
      "They lose access at once and are told. Their answers to its forms go. What they added stays in the plan.",
    confirmLabel: "Remove",
  };
}
