// Logjam GPS only: a plan kept on the phone and read without signal
// (mobile/DESIGN.md §8). Logjam Web is used at home and reads a plan live, so it has no copy to
// age, mark changed or download (shared/DESIGN.md §14).
import type { DateOnly, TripPlanSummary } from "../tripPlans.js";
import {
  tripPlanBucket,
  tripPlansBadgeCount,
  TRIP_PLANS_LIST,
} from "./plans.js";
import { t } from "../i18n.js";

export const TRIP_PLAN_OFFLINE = {
  downloaded: t`Downloaded`,
  changed: t`Changed since you downloaded it`,
  notDownloaded: t`Not downloaded yet. Open it once with signal to read it here.`,
  // The plan went while this phone held it, or a stale row or push opened it.
  gone: t`You're no longer in this plan, or it was deleted.`,
  noPlansOffline: t`Open Plans once with signal to read them here.`,
  download: t`Download for the trip`,
  downloading: t`Downloading the plan's files…`,
  downloadFailed: t`Couldn't download the plan's files.`,
  downloadDone: t`Downloaded for the trip.`,
  // It runs only while Logjam GPS is on screen (ADR 0013).
  downloadKeepOpen: t`Keep Logjam GPS open until it finishes.`,
  // Map data is the offline-map save, framed on the plan's items.
  downloadMap: t`Save an offline map of this area`,
  // Once a saved offline map holds the plan's whole area.
  mapDownloaded: t`Offline map saved`,
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
  if (waiting > 0) return t`${waiting} waiting on you`;
  const upcoming = plans.filter(
    (plan) =>
      plan.status === "active" && tripPlanBucket(plan, today) === "upcoming",
  ).length;
  return upcoming > 0
    ? t`${upcoming} upcoming`
    : TRIP_PLANS_LIST.copy.nothingPlanned;
}
