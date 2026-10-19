// Logjam GPS only: a plan kept on the phone and read without signal (design
// §8). Logjam Web is used at home and reads a plan live, so it has no copy to
// age, mark changed or download (shared/DESIGN.md §14).
import type { DateOnly, TripPlanSummary } from "../tripPlans.js";
import { tripPlanBucket, tripPlansBadgeCount } from "./plans.js";

export const TRIP_PLAN_OFFLINE = {
  downloaded: "Downloaded",
  changed: "Changed since you downloaded it",
  refresh: "Refresh",
  notDownloaded:
    "Not downloaded yet. Open it once with signal to read it here.",
  noPlansOffline: "Open Plans once with signal to read them here.",
} as const;

/**
 * The More hub's Plans row: what waits on the caller outranks what is coming
 * up. "1 waiting on you", "2 upcoming", "Nothing planned".
 */
export function tripPlansMoreSubtitle(
  plans: readonly TripPlanSummary[],
  today: DateOnly,
): string {
  const waiting = tripPlansBadgeCount(plans);
  if (waiting > 0) return `${waiting} waiting on you`;
  const upcoming = plans.filter(
    (plan) =>
      plan.status === "active" && tripPlanBucket(plan, today) === "upcoming",
  ).length;
  return upcoming > 0 ? `${upcoming} upcoming` : "Nothing planned";
}
