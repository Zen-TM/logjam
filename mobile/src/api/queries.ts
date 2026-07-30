// Typed API calls + data hooks for the Stage 1 read-only screens. Follows the
// web hook pattern (frontend/src/canyonUtils.ts): useState + useEffect +
// fetchCount + refetch, returning { data, loading, error, refetch } with
// user-friendly error strings via messageFromError.
import { useCallback, useEffect, useState } from "react";
import {
  messageFromError,
  type TripLogCustomFieldDef,
  type VectorStyleSettings,
} from "@logjam/shared";

import { apiFetch, apiFetchWithTotal } from "./apiFetch";
import type { TNotification, TUser } from "./types";

export function fetchCurrentUser(): Promise<TUser> {
  return apiFetch<TUser>("/users/me");
}

export function updateConsent(consentVersion: string): Promise<TUser> {
  return apiFetch<TUser>("/users/me", { method: "PATCH", body: { consentVersion } });
}

// Canyon/trip list + detail reads moved to the Stage 8 offline mirror
// (src/sync/useSyncQueries.ts) — REST fetchers for them died with the swap.

export function getNotifications(): Promise<{ data: TNotification[]; total: number | null }> {
  return apiFetchWithTotal<TNotification[]>("/notifications");
}

export function getUnreadNotificationCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>("/notifications/unread-count");
}

export function markNotificationRead(id: string): Promise<void> {
  return apiFetch<void>(`/notifications/${id}/read`, { method: "PATCH" });
}

export function markAllNotificationsRead(): Promise<void> {
  return apiFetch<void>("/notifications/read-all", { method: "PATCH" });
}

export function getVectorStyle(): Promise<VectorStyleSettings> {
  return apiFetch<VectorStyleSettings>("/vector-style");
}

// ── Custom fields (trip logs AND canyons) ────────────────────────────────────
//
// The DEFINITIONS live in User.uiPreferences (`tripLogCustomFields` /
// `canyonCustomFields`), so adding and renaming both go through PATCH /users/me
// with the full list — the API takes the whole array, not a delta. Deleting is
// its own endpoint because it must also strip the orphaned VALUES off every row
// that carried one, which only the server can do transactionally.
//
// Online-only, deliberately: this edits an account-level preference that every
// device and the web share, so an offline queue would need conflict rules for a
// list the user could also be reordering in a browser. The forms degrade to the
// fields they already know about.
//
// The two entities differ only in a route segment, a prefs key and two response
// key names — all of them here, so no caller re-derives them.

export type CustomFieldEntity = "tripLog" | "canyon";

const CUSTOM_FIELD_ROUTES = {
  tripLog: {
    segment: "trip-log",
    defsKey: "tripLogCustomFields",
    countKey: "tripLogCount",
    removedKey: "removedFromTripCount",
  },
  canyon: {
    segment: "canyon",
    defsKey: "canyonCustomFields",
    countKey: "canyonCount",
    removedKey: "removedFromCanyonCount",
  },
} as const;

export function updateCustomFieldDefs(
  entity: CustomFieldEntity,
  fields: TripLogCustomFieldDef[],
): Promise<TUser> {
  return apiFetch<TUser>("/users/me", {
    method: "PATCH",
    body: { [CUSTOM_FIELD_ROUTES[entity].defsKey]: fields },
  });
}

/** How many of the user's rows carry a value for this field. */
export async function getCustomFieldImpact(
  entity: CustomFieldEntity,
  key: string,
): Promise<number> {
  const route = CUSTOM_FIELD_ROUTES[entity];
  const result = await apiFetch<Record<string, number>>(
    `/custom-fields/${route.segment}/${encodeURIComponent(key)}/impact`,
  );
  return result[route.countKey] ?? 0;
}

/** Deletes the definition; resolves with how many rows lost a value. */
export async function deleteCustomFieldDef(
  entity: CustomFieldEntity,
  key: string,
): Promise<number> {
  const route = CUSTOM_FIELD_ROUTES[entity];
  const result = await apiFetch<Record<string, number>>(
    `/custom-fields/${route.segment}/${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
  return result[route.removedKey] ?? 0;
}

/** The user's current defs for one entity, from a fetched user. */
export function customFieldDefsOf(
  user: TUser | null,
  entity: CustomFieldEntity,
): TripLogCustomFieldDef[] {
  return user?.uiPreferences?.[CUSTOM_FIELD_ROUTES[entity].defsKey] ?? [];
}

// ── Generic query hook ────────────────────────────────────────────────────────

export type QueryState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

/**
 * Fetch-on-mount hook with refetch. `fetcher` must be referentially stable
 * (module-level function) — it is deliberately not in the dependency list.
 */
export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  errorFallback: string,
  enabled = true,
): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!cancelled) setError(messageFromError(err, errorFallback));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { data, loading, error, refetch };
}
