// Which state the Plans list and a plan's page draw, decided without React
// Native so it can be unit-tested (as `notifications/tapTarget.ts`).
// mobile/DESIGN.md §8: not downloaded yet is a state, not an error; shared/
// DESIGN.md §11-12: a loaded list is never covered by an old error, and Try
// again only where trying again can help.
import type { TripPlanSummary } from "@logjam/shared";

export type PlansListView =
  | { kind: "loading" }
  /** Offline, and this phone has never fetched the list. */
  | { kind: "neverFetched" }
  | { kind: "failed"; message: string }
  | { kind: "list"; plans: TripPlanSummary[] };

export function plansListView(state: {
  /** The cached list, or null when the phone holds none. */
  plans: TripPlanSummary[] | null;
  /** The last poll's failure, if it failed. */
  failure: string | null;
  /** A poll has finished since the screen opened. */
  settled: boolean;
  online: boolean;
}): PlansListView {
  if (state.plans) return { kind: "list", plans: state.plans };
  if (!state.settled) return { kind: "loading" };
  if (!state.online) return { kind: "neverFetched" };
  if (state.failure) return { kind: "failed", message: state.failure };
  return { kind: "loading" };
}

export type PlanPageView =
  | { kind: "loading" }
  /** The caller lost the plan: left, removed, or it was deleted. */
  | { kind: "gone" }
  | { kind: "failed"; message: string }
  /** Never opened with signal. */
  | { kind: "notDownloaded" }
  | { kind: "page" };

export function planPageView(state: {
  /** undefined until the cache is read; null when it holds no copy. */
  cached: object | null | undefined;
  gone: boolean;
  refreshing: boolean;
  failure: string | null;
  online: boolean;
}): PlanPageView {
  if (state.gone) return { kind: "gone" };
  if (state.cached) return { kind: "page" };
  if (state.cached === undefined || state.refreshing)
    return { kind: "loading" };
  if (state.failure && state.online)
    return { kind: "failed", message: state.failure };
  return { kind: "notDownloaded" };
}

/** The API refuses widening a form others answered for leaders only, so the
 *  visibility choice locks. Guard: planViews.test.ts. */
export function formWidenLocked(
  form: { visibleTo: string; answers: readonly unknown[] } | null | undefined,
): boolean {
  return (
    form != null && form.visibleTo === "leaders" && form.answers.length > 0
  );
}
