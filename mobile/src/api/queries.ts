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

// ── Trip-log custom fields ───────────────────────────────────────────────────
//
// The DEFINITIONS live in User.uiPreferences.tripLogCustomFields, so adding and
// renaming both go through PATCH /users/me with the full list — the API takes
// the whole array, not a delta. Deleting is its own endpoint because it must
// also strip the orphaned VALUES off every trip that carried one, which only
// the server can do transactionally.
//
// Online-only, deliberately: this edits an account-level preference that every
// device and the web share, so an offline queue would need conflict rules for a
// list the user could also be reordering in a browser. The trip form degrades
// to the fields it already knows about.

export function updateTripLogCustomFields(
  fields: TripLogCustomFieldDef[],
): Promise<TUser> {
  return apiFetch<TUser>("/users/me", {
    method: "PATCH",
    body: { tripLogCustomFields: fields },
  });
}

/** How many of the user's trips carry a value for this field. */
export function getCustomFieldImpact(key: string): Promise<{ tripLogCount: number }> {
  return apiFetch<{ tripLogCount: number }>(
    `/custom-fields/trip-log/${encodeURIComponent(key)}/impact`,
  );
}

export function deleteTripLogCustomField(
  key: string,
): Promise<{ removedFromTripCount: number }> {
  return apiFetch<{ removedFromTripCount: number }>(
    `/custom-fields/trip-log/${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
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
