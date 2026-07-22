// Typed API calls + data hooks for the Stage 1 read-only screens. Follows the
// web hook pattern (frontend/src/canyonUtils.ts): useState + useEffect +
// fetchCount + refetch, returning { data, loading, error, refetch } with
// user-friendly error strings via messageFromError.
import { useCallback, useEffect, useState } from "react";
import { messageFromError } from "@logjam/shared";

import { apiFetch, apiFetchWithTotal } from "./apiFetch";
import type { TCanyon, TNotification, TTripLog, TUser } from "./types";

export function fetchCurrentUser(): Promise<TUser> {
  return apiFetch<TUser>("/users/me");
}

export function updateConsent(consentVersion: string): Promise<TUser> {
  return apiFetch<TUser>("/users/me", { method: "PATCH", body: { consentVersion } });
}

export function getCanyons(): Promise<{ data: TCanyon[]; total: number | null }> {
  return apiFetchWithTotal<TCanyon[]>("/canyons");
}

export function getSharedCanyons(): Promise<TCanyon[]> {
  return apiFetch<TCanyon[]>("/canyons/shared");
}

export function getCanyonDetail(id: string): Promise<TCanyon> {
  return apiFetch<TCanyon>(`/canyons/${id}`);
}

export function getTripLogs(): Promise<{ data: TTripLog[]; total: number | null }> {
  return apiFetchWithTotal<TTripLog[]>("/trips");
}

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
