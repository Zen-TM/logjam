// A route drawn for a plan that the plan then refuses for good (it is gone, the
// caller is out of it, or it is archived): the points are not lost, they can be
// kept in Saved. Both clients run the same decision and say the same words.
import type { ConfirmCopy } from "./confirm.js";

/** Whether the API's refusal of an add to a plan will stand: 403 and 404 for a
 *  plan the caller is no longer in, 409 for an archived one. Anything else
 *  (no connection, a 5xx, a rate limit) may clear on the next try. */
export function planRefusalStands(status: number): boolean {
  return status === 403 || status === 404 || status === 409;
}

/** The offer after a standing refusal; `reason` is the API's own sentence. */
export function planRouteStrandedConfirm(reason: string): ConfirmCopy {
  return {
    confirmTitle: "Couldn't add the route to the plan",
    confirmBody: `${reason} Keep it in Saved instead?`,
    confirmLabel: "Save to Saved",
    tone: "filled",
    icon: "done",
  };
}
