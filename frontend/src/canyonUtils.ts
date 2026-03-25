import { useEffect, useState, useCallback } from "react";
import { fetchAuthSession } from "aws-amplify/auth";

export type TCanyonAttributes = {
  sources?: [string, string][];
};

export type TCanyon = {
  id: string;
  ownerId: string;
  name: string;
  altNames: string[];
  latitude: number;
  longitude: number;
  numAbseils: number | null;
  longestAbseil: number | null;
  vGrade: number | null;
  aGrade: number | null;
  commitment: number | null;
  quality: number | null;
  wetsuits: number | null;
  hours: number | null;
  notes: string | null;
  attributes: TCanyonAttributes;
  ropeWikiId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type TUser = {
  id: string;
  username: string;
  email: string;
};

export type TFriend = {
  id: string;
  username: string;
  email: string;
  friendshipId: string;
};

export type TFriendRequest = {
  id: string;
  requester: { id: string; username: string; email: string };
};

export type TSearchUser = {
  id: string;
  username: string;
};

export type TCanyonShare = {
  id: string;
  canyonId: string;
  sharedWith: { id: string; username: string; email: string };
};

export type TNotification = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
};

export type TFilters = {
  name: string | null;
  v_grade: number[] | null;
  a_grade: number[] | null;
  commitment: number[] | null;
  quality: number[] | null;
  pitches: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  longest_pitch: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  hours: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  wetsuits: number[] | null;
};

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

// Gets a fresh ID token from Amplify on every call. Amplify automatically
// refreshes the token using the refresh token when the ID token has expired
// (every 1 hour), so callers never need to worry about expiry.
async function getIdToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error("No auth session");
  return token;
}

// Every API call fetches its own fresh token internally, so hooks don't
// need a token parameter — just a boolean to control whether to fetch.
async function apiFetch<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.body != null && { "Content-Type": "application/json" }),
    },
    ...(options?.body != null && { body: JSON.stringify(options.body) }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type ImportResult = {
  imported: number;
  skipped: number;
  errors: string[];
};

export type RefreshResult = {
  added: number;
  updated: number;
  unchanged: number;
  userEdited: number;
  errors: string[];
};

export function importFromRopeWiki(): Promise<ImportResult> {
  return apiFetch<ImportResult>("/ropewiki/import", { method: "POST" });
}

export function refreshFromRopeWiki(): Promise<RefreshResult> {
  return apiFetch<RefreshResult>("/ropewiki/refresh", { method: "POST" });
}

export type CreateCanyonData = {
  name: string;
  altNames?: string[];
  latitude: number;
  longitude: number;
  numAbseils?: number | null;
  longestAbseil?: number | null;
  vGrade?: number | null;
  aGrade?: number | null;
  commitment?: number | null;
  quality?: number | null;
  wetsuits?: number | null;
  hours?: number | null;
  notes?: string | null;
  attributes?: TCanyonAttributes;
};

export function createCanyon(data: CreateCanyonData): Promise<TCanyon> {
  return apiFetch<TCanyon>("/canyons", { method: "POST", body: data });
}

export function updateCanyon(
  id: string,
  data: Partial<Omit<TCanyon, "id" | "createdAt" | "updatedAt" | "ropeWikiId">>,
): Promise<TCanyon> {
  return apiFetch<TCanyon>(`/canyons/${id}`, { method: "PATCH", body: data });
}

export function deleteCanyon(id: string): Promise<void> {
  return apiFetch<void>(`/canyons/${id}`, { method: "DELETE" });
}

export function useCanyons(enabled: boolean) {
  const [canyons, setCanyons] = useState<TCanyon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    apiFetch<TCanyon[]>("/canyons")
      .then(setCanyons)
      .catch((err) => setError(err.message))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { canyons, loading, loaded, error, refetch };
}

export function useSharedCanyons(enabled: boolean) {
  const [canyons, setCanyons] = useState<TCanyon[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    apiFetch<TCanyon[]>("/canyons/shared")
      .then(setCanyons)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { canyons, loading, refetch };
}

// ── Current user ──────────────────────────────────────────────

export function fetchCurrentUser(): Promise<TUser> {
  return apiFetch<TUser>("/users/me");
}

// ── Friends ───────────────────────────────────────────────────

export function searchUsers(query: string): Promise<TSearchUser[]> {
  return apiFetch<TSearchUser[]>(
    `/friends/search?q=${encodeURIComponent(query)}`,
  );
}

export function getFriends(): Promise<TFriend[]> {
  return apiFetch<TFriend[]>("/friends");
}

export function getFriendRequests(): Promise<TFriendRequest[]> {
  return apiFetch<TFriendRequest[]>("/friends/requests");
}

export function sendFriendRequest(addresseeId: string): Promise<void> {
  return apiFetch<void>("/friends/request", {
    method: "POST",
    body: { addresseeId },
  });
}

export function acceptFriendRequest(friendshipId: string): Promise<void> {
  return apiFetch<void>(`/friends/${friendshipId}/accept`, { method: "PATCH" });
}

export function declineFriendRequest(friendshipId: string): Promise<void> {
  return apiFetch<void>(`/friends/${friendshipId}/decline`, {
    method: "PATCH",
  });
}

export function removeFriend(friendshipId: string): Promise<void> {
  return apiFetch<void>(`/friends/${friendshipId}`, { method: "DELETE" });
}

export function useFriends(enabled: boolean) {
  const [friends, setFriends] = useState<TFriend[]>([]);
  const [requests, setRequests] = useState<TFriendRequest[]>([]);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    getFriends().then(setFriends).catch(console.error);
    getFriendRequests().then(setRequests).catch(console.error);
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { friends, requests, refetch };
}

// ── Sharing ───────────────────────────────────────────────────

export function shareCanyonWith(
  canyonId: string,
  sharedWithUserId: string,
): Promise<void> {
  return apiFetch<void>(`/canyons/${canyonId}/share`, {
    method: "POST",
    body: { sharedWithUserId },
  });
}

export function unshareCanyonWith(
  canyonId: string,
  userId: string,
): Promise<void> {
  return apiFetch<void>(`/canyons/${canyonId}/share/${userId}`, {
    method: "DELETE",
  });
}

export function getCanyonShares(canyonId: string): Promise<TCanyonShare[]> {
  return apiFetch<TCanyonShare[]>(`/canyons/${canyonId}/shares`);
}

export function copyCanyon(canyonId: string): Promise<TCanyon> {
  return apiFetch<TCanyon>(`/canyons/${canyonId}/copy`, { method: "POST" });
}

// ── Notifications ─────────────────────────────────────────────

export function getNotifications(): Promise<TNotification[]> {
  return apiFetch<TNotification[]>("/notifications");
}

export function getUnreadCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>("/notifications/unread-count");
}

export function markNotificationRead(id: string): Promise<void> {
  return apiFetch<void>(`/notifications/${id}/read`, { method: "PATCH" });
}

export function markAllNotificationsRead(): Promise<void> {
  return apiFetch<void>("/notifications/read-all", { method: "PATCH" });
}

export function deleteNotification(id: string): Promise<void> {
  return apiFetch<void>(`/notifications/${id}`, { method: "DELETE" });
}

export function clearReadNotifications(): Promise<void> {
  return apiFetch<void>("/notifications", { method: "DELETE" });
}

export function useNotifications(enabled: boolean) {
  const [notifications, setNotifications] = useState<TNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    getNotifications().then(setNotifications).catch(console.error);
    getUnreadCount()
      .then((r) => setUnreadCount(r.count))
      .catch(console.error);
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { notifications, unreadCount, refetch };
}

// ── Filters ───────────────────────────────────────────────────

export function passesFilters(canyon: TCanyon, filters: TFilters): boolean {
  function passesSliderFilter(
    value: number | null | undefined,
    filter: number[] | null,
    range: [number, number],
  ): boolean {
    if (filter && (filter[0] !== range[0] || filter[1] !== range[1])) {
      if (value == null) return false;
      if (value < filter[0] || value > filter[1]) return false;
    }
    return true;
  }

  function passesSelectNumberFilter(
    value: number | null | undefined,
    filter: ["Any" | "Less than" | "More than" | "Exactly", number] | null,
  ): boolean {
    if (filter && filter[0] !== "Any") {
      if (value == null) return false;
      if (filter[0] === "Less than" && value >= filter[1]) return false;
      if (filter[0] === "More than" && value <= filter[1]) return false;
      if (filter[0] === "Exactly" && value !== filter[1]) return false;
    }
    return true;
  }

  if (filters.name && filters.name.trim() !== "") {
    const query = filters.name.toLowerCase();
    const matchesName = canyon.name.toLowerCase().includes(query);
    const matchesAlt = canyon.altNames?.some((n) =>
      n.toLowerCase().includes(query),
    );
    if (!matchesName && !matchesAlt) return false;
  }

  if (!passesSliderFilter(canyon.vGrade, filters.v_grade, [1, 7])) return false;
  if (!passesSliderFilter(canyon.aGrade, filters.a_grade, [1, 7])) return false;
  if (!passesSliderFilter(canyon.commitment, filters.commitment, [1, 6]))
    return false;
  if (!passesSliderFilter(canyon.quality, filters.quality, [1, 5])) return false;
  if (!passesSelectNumberFilter(canyon.numAbseils, filters.pitches))
    return false;
  if (!passesSelectNumberFilter(canyon.longestAbseil, filters.longest_pitch))
    return false;
  if (!passesSelectNumberFilter(canyon.hours, filters.hours)) return false;
  if (!passesSliderFilter(canyon.wetsuits, filters.wetsuits, [1, 5]))
    return false;

  return true;
}

export function formatCanyonGrade(canyon: TCanyon): string | null {
  const { vGrade, aGrade, commitment } = canyon;
  if (!vGrade && !aGrade && !commitment) return null;
  const v = vGrade ? `v${vGrade}` : "v?";
  const a = aGrade ? `a${aGrade}` : "a?";
  const c = commitment
    ? " " + ["I", "II", "III", "IV", "V", "VI"][commitment - 1]
    : "";
  return `${v}${a}${c}`;
}
