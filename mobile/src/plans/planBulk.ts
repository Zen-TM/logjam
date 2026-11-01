// Bulk actions on the plans list. A selection mixes roles, and one button acts
// on each plan as its role allows: the plans you lead are deleted, the rest
// are left. Only a leader archives. No endpoint of its own: each plan goes
// through the same call its own page uses.
import type { TripPlanSummary } from "@logjam/shared";

type Pickable = Pick<TripPlanSummary, "status" | "role">;

/** A plan you are in; an invite or a request has nothing to select it for. */
export const planSelectable = (plan: Pickable) => plan.status === "active";

export function planBulkSplit<P extends Pickable>(plans: readonly P[]) {
  return {
    lead: plans.filter((plan) => plan.role === "leader"),
    leave: plans.filter((plan) => plan.role !== "leader"),
  };
}

const plans = (count: number) => `${count} ${count === 1 ? "plan" : "plans"}`;

/** The one confirm for Delete and leave, naming each count. */
export function planBulkConfirm(counts: { lead: number; leave: number }) {
  const { lead, leave } = counts;
  const parts: string[] = [];
  if (lead > 0)
    parts.push(
      `Deleting ${plans(lead)} removes ${lead === 1 ? "its" : "their"} write-up${lead === 1 ? "" : "s"}, forms and everyone's answers, for everyone. Copies people saved to their own accounts stay.`,
    );
  if (leave > 0)
    parts.push(
      `Leaving ${plans(leave)} loses you access at once and removes your answers. What you added stays.`,
    );
  const title =
    lead > 0 && leave > 0
      ? `Delete ${plans(lead)} and leave ${plans(leave)}?`
      : lead > 0
        ? `Delete ${plans(lead)}?`
        : `Leave ${plans(leave)}?`;
  return {
    confirmTitle: title,
    confirmBody: parts.join(" "),
    confirmLabel: lead > 0 ? "Delete" : "Leave",
  };
}
