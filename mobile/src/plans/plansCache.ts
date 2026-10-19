// Trip plans on this phone: fetched and cached, not synced (ADR 0017, the
// inbox's pattern in `sync/notificationsCache.ts`). The last GET /plans is
// the list; each plan opened keeps its last GET /plans/:id verbatim, so it
// reads offline. Both tables are mirror tables kept through a mirror reset
// (`keepOnReset` in `sync/mirrorSchema.ts`): sign-out and a user change wipe
// them, a resync or a schema bump does not.
//
// PRIVACY: a cached plan holds names, coordinates, write-ups and people's
// answers (phone numbers among them). App-private, behind the app lock, and
// never logged: errors here are logged as they are thrown, and no payload is
// ever passed to a logger (`sentry/scrubEvent.test.ts` covers a plan's keys).
import {
  ApiError,
  type TripPlanSummary,
  type TripPlanView,
} from "@logjam/shared";
import { AppState } from "react-native";

import { canRunNow } from "../offline/networkPolicy";
import {
  getSyncDb,
  notifyMirrorChanged,
  withSyncTransaction,
} from "../sync/syncDb";
import { getPlan, getPlans } from "./plansApi";

export type PlansList = { plans: TripPlanSummary[]; fetchedAt: string };

export type CachedPlan = {
  plan: TripPlanView;
  fetchedAt: string;
  downloadedAt: string | null;
};

/** What the list needs to know of each cached plan, without its payload. */
export type CachedPlanStamp = {
  updatedAt: string;
  downloadedAt: string | null;
};

export async function readPlansList(): Promise<PlansList | null> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<{
    fetched_at: string;
    payload_json: string;
  }>("SELECT fetched_at, payload_json FROM plans_list_cache LIMIT 1");
  if (!row) return null;
  try {
    return { plans: JSON.parse(row.payload_json), fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

export async function readCachedPlan(
  planId: string,
): Promise<CachedPlan | null> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<{
    fetched_at: string;
    downloaded_at: string | null;
    payload_json: string;
  }>(
    "SELECT fetched_at, downloaded_at, payload_json FROM plans_cache WHERE plan_id = ?",
    planId,
  );
  if (!row) return null;
  try {
    return {
      plan: JSON.parse(row.payload_json),
      fetchedAt: row.fetched_at,
      downloadedAt: row.downloaded_at,
    };
  } catch {
    return null;
  }
}

export async function readCachedPlanStamps(): Promise<
  Map<string, CachedPlanStamp>
> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<{
    plan_id: string;
    plan_updated_at: string;
    downloaded_at: string | null;
  }>("SELECT plan_id, plan_updated_at, downloaded_at FROM plans_cache");
  return new Map(
    rows.map((row) => [
      row.plan_id,
      { updatedAt: row.plan_updated_at, downloadedAt: row.downloaded_at },
    ]),
  );
}

/** The poll says the plan moved on since this phone's copy was fetched. */
export function planChanged(
  summary: Pick<TripPlanSummary, "updatedAt">,
  stamp: CachedPlanStamp | undefined,
): boolean {
  return (
    stamp !== undefined &&
    Date.parse(summary.updatedAt) > Date.parse(stamp.updatedAt)
  );
}

// The sign-out wipe bumps this, so a GET in flight across it cannot write the
// departing user's plans back after the wipe (ADR 0006: the wipe stops the
// producers before it deletes). Read before the GET, checked inside the
// write's transaction, which the wipe's shares.
let epoch = 0;

/** Called by the sign-out wipe (`offline/wipeLocalData.ts`). */
export function stopPlansForWipe(): Promise<void> {
  epoch += 1;
  return Promise.resolve();
}

/**
 * GET /plans, and the cache follows: the list is replaced, and a cached plan
 * the caller is no longer an active member of (missing from the poll, or back
 * to invited) is dropped, unless it was fetched after this poll began: that
 * fetch is newer news than this list. Throws on failure and leaves the cache
 * alone.
 */
export async function pollPlans(): Promise<PlansList> {
  const began = epoch;
  const startedAt = new Date().toISOString();
  const { plans } = await getPlans();
  const fetchedAt = new Date().toISOString();
  const active = new Set(
    plans.filter((plan) => plan.status === "active").map((plan) => plan.id),
  );
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    if (began !== epoch) return;
    await db.runAsync("DELETE FROM plans_list_cache");
    await db.runAsync(
      "INSERT INTO plans_list_cache (fetched_at, payload_json) VALUES (?, ?)",
      fetchedAt,
      JSON.stringify(plans),
    );
    const cached = await db.getAllAsync<{ plan_id: string }>(
      "SELECT plan_id FROM plans_cache",
    );
    for (const { plan_id } of cached) {
      if (!active.has(plan_id))
        await db.runAsync(
          "DELETE FROM plans_cache WHERE plan_id = ? AND fetched_at <= ?",
          plan_id,
          startedAt,
        );
    }
  });
  notifyMirrorChanged();
  return { plans, fetchedAt };
}

/**
 * GET /plans/:id into the cache, keeping when it was downloaded. A 404 means
 * the caller can no longer see it, so the cached copy goes too.
 */
export async function fetchPlan(planId: string): Promise<CachedPlan> {
  const began = epoch;
  let plan: TripPlanView;
  try {
    plan = await getPlan(planId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      const db = await getSyncDb();
      await db.runAsync("DELETE FROM plans_cache WHERE plan_id = ?", planId);
      notifyMirrorChanged();
    }
    throw err;
  }
  const fetchedAt = new Date().toISOString();
  const db = await getSyncDb();
  const downloadedAt = await withSyncTransaction(db, async () => {
    // Signed out meanwhile: the caller still gets what it asked for, the
    // phone keeps none of it.
    if (began !== epoch) return null;
    await db.runAsync(
      `INSERT INTO plans_cache (plan_id, fetched_at, plan_updated_at, payload_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(plan_id) DO UPDATE SET fetched_at = excluded.fetched_at,
         plan_updated_at = excluded.plan_updated_at, payload_json = excluded.payload_json`,
      planId,
      fetchedAt,
      plan.updatedAt,
      JSON.stringify(plan),
    );
    const stamp = await db.getFirstAsync<{ downloaded_at: string | null }>(
      "SELECT downloaded_at FROM plans_cache WHERE plan_id = ?",
      planId,
    );
    return stamp?.downloaded_at ?? null;
  });
  notifyMirrorChanged();
  return { plan, fetchedAt, downloadedAt };
}

/** Refetch a plan only if this phone already holds it: a push about it. */
export async function refreshCachedPlan(planId: string): Promise<void> {
  if (!(await readCachedPlanStamps()).has(planId)) return;
  await fetchPlan(planId);
}

/**
 * The poll on return to the foreground, and once at sign-in, through the
 * sync job's connection rule: a few kilobytes of JSON (ADR 0013: never a
 * timer). The Plans screen polls on its own when it opens.
 */
export function registerPlansPoll(): () => void {
  const run = () =>
    void canRunNow("sync").then((allowed) => {
      if (allowed) pollPlans().catch(console.error);
    });
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") run();
  });
  run();
  return () => subscription.remove();
}

/**
 * After a write: the list and, unless the plan is gone for the caller (left,
 * deleted), the plan itself are fetched again, so the page and the list read
 * what the API now holds. A failed refetch is logged, not thrown: the write
 * itself succeeded.
 */
export async function afterPlanWrite(
  planId: string,
  gone = false,
): Promise<void> {
  if (gone) {
    const db = await getSyncDb();
    await db.runAsync("DELETE FROM plans_cache WHERE plan_id = ?", planId);
  }
  await Promise.all([pollPlans(), gone ? undefined : fetchPlan(planId)]).catch(
    console.error,
  );
}
