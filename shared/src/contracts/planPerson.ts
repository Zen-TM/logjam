// What looking at one person in a plan's People shows, for Logjam Web and
// Logjam GPS alike: who they are, where they stand, the forms they haven't
// answered (a leader's view alone) and what the viewer may do to them.
// Guard: planPerson.test.ts.
import type {
  DateOnly,
  TripPlanMemberView,
  TripPlanView,
} from "../tripPlans.js";
import {
  planMemberVerbs,
  type PlanMemberVerbId,
  type PlanVerb,
} from "./planVerbs.js";
import {
  TRIP_PLAN_JOIN,
  TRIP_PLAN_PAGE,
  tripPlanFormTally,
  tripPlanGoing,
  tripPlanIsOver,
  tripPlanRoleWord,
} from "./plans.js";

export type PlanPersonActionId =
  | PlanMemberVerbId
  | "letIn"
  | "turnDown"
  | "cancelInvite";

export type PlanPersonAction = PlanVerb<PlanPersonActionId>;

export type PlanPersonView = {
  name: string;
  /** "Leader" or "Editor"; null for a member, and for anyone not yet going. */
  role: string | null;
  /** "Going", "Asking to join" or "Invited". */
  status: string;
  /** "Invited by bob", when it is known. */
  invitedBy: string | null;
  /** Titles of the forms they haven't answered; null when the viewer is no
   *  leader and so cannot know. Empty when there are none. */
  unanswered: string[] | null;
  actions: PlanPersonAction[];
};

export function tripPlanPerson(
  plan: TripPlanView,
  member: TripPlanMemberView,
  me: string | null,
  today: DateOnly,
): PlanPersonView {
  const copy = TRIP_PLAN_PAGE.copy;
  const leader = plan.myRole === "leader";
  const archived = plan.archivedAt != null;
  const id = member.user.id;
  const actions: PlanPersonAction[] = [];

  if (leader && member.status === "requested") {
    if (!archived)
      actions.push({
        id: "letIn",
        label: copy.letIn,
        icon: "accept",
        danger: false,
        separated: false,
      });
    actions.push({
      id: "turnDown",
      label: copy.turnDown,
      icon: "ignore",
      danger: false,
      separated: false,
    });
  } else if (leader && member.status === "invited") {
    if (!archived)
      actions.push({
        id: "cancelInvite",
        label: copy.cancelInvite,
        icon: "close",
        danger: false,
        separated: false,
      });
  } else if (member.status === "active" && me) {
    const leaders = tripPlanGoing(plan.members).filter(
      (each) => each.role === "leader",
    ).length;
    actions.push(
      ...planMemberVerbs(
        plan.myRole,
        { role: member.role, self: id === me },
        { archived, leaders },
      ),
    );
  }

  // Nothing is asked of anyone once the plan is archived or the trip over.
  const unanswered =
    leader && me && member.status === "active"
      ? archived || tripPlanIsOver(plan, today)
        ? []
        : plan.forms
            .filter((form) =>
              tripPlanFormTally(plan, form, me)?.missing.some(
                (user) => user.id === id,
              ),
            )
            .map((form) => form.title)
      : null;

  return {
    name: member.user.username,
    role:
      member.status === "active" && member.role !== "member"
        ? tripPlanRoleWord(member.role)
        : null,
    status:
      member.status === "requested"
        ? copy.peopleAsking
        : member.status === "invited"
          ? copy.peopleInvited
          : copy.peopleGoing,
    invitedBy:
      member.status === "invited" && member.invitedBy
        ? `${TRIP_PLAN_JOIN.copy.invitedBy} ${member.invitedBy.username}`
        : null,
    unanswered,
    actions,
  };
}
