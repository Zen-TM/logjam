// Bulk actions on the plans list: what a selection offers is shared
// (`tripPlanBulkOffers`). No endpoint of its own: each plan goes through the
// same call its own page uses.
import { tripPlanBulkDone, type TripPlanSummary } from "@logjam/shared";

type Pickable = Pick<TripPlanSummary, "status" | "role">;

/** A plan you are in; an invite or a request has nothing to select it for. */
export const planSelectable = (plan: Pickable) => plan.status === "active";

type BulkKind = Parameters<typeof tripPlanBulkDone>[0];

/** One call per plan, all settled; what the toast says (`tripPlanBulkDone`,
 *  one sentence per kind) and which plans did not go through, so they stay
 *  selected. Guard: planBulk.test.ts. */
export async function runPlanBulk(
  steps: { id: string; kind: BulkKind; run: () => Promise<unknown> }[],
): Promise<{ message: string; failedIds: string[] }> {
  const results = await Promise.allSettled(steps.map((step) => step.run()));
  const failedIds = steps
    .filter((_, index) => results[index].status === "rejected")
    .map((step) => step.id);
  const kinds = [...new Set(steps.map((step) => step.kind))];
  const message = kinds
    .map((kind) => {
      const ofKind = steps.filter((step) => step.kind === kind);
      return tripPlanBulkDone(
        kind,
        ofKind.filter((step) => !failedIds.includes(step.id)).length,
        ofKind.length,
      );
    })
    .join(" ");
  return { message, failedIds };
}
