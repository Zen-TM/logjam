import { useEffect, useState, useCallback } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import type { ThemeSchemeId, TripLogCustomFieldDef, NotificationPreferences } from "@logjam/shared";
import { ApiError } from "./errors/ApiError";
import { messageFromError } from "./errors/messageFromError";

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
  storageUsedBytes: number;
  storageQuotaBytes: number;
  consentedAt: string | null;
  consentVersion: string | null;
  uiPreferences?: {
    themeSchemeId?: ThemeSchemeId;
    tripLogCustomFields?: TripLogCustomFieldDef[];
    notifications?: NotificationPreferences;
  } | null;
};

export type TTripLog = {
  id: string;
  canyonId: string;
  userId: string;
  date: string;
  notes: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  canyon?: { id: string; name: string };
};

export type TFriend = {
  id: string;
  username: string;
  friendshipId: string;
};

export type TFriendRequest = {
  id: string;
  requester: { id: string; username: string };
};

export type TSearchUser = {
  id: string;
  username: string;
};

export type TCanyonShare = {
  id: string;
  canyonId: string;
  sharedWith: { id: string; username: string };
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

// useAuth registers a handler here so apiFetch can flip the UI back to the
// sign-in screen when the Cognito refresh token has expired or been revoked.
// Without this, the UI would stay "authenticated" while every API call 401s.
let sessionExpiredHandler: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null) {
  sessionExpiredHandler = handler;
}
function notifySessionExpired() {
  if (sessionExpiredHandler) sessionExpiredHandler();
}

async function getIdToken(): Promise<string> {
  if (import.meta.env.VITE_AUTH_MODE === "fake") return "fake-token";
  // Amplify automatically refreshes the token using the refresh token when
  // the ID token has expired (every 1 hour).
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (!token) {
      notifySessionExpired();
      throw new Error("No auth session");
    }
    return token;
  } catch (err) {
    notifySessionExpired();
    throw err;
  }
}

// Every API call fetches its own fresh token internally, so hooks don't
// need a token parameter — just a boolean to control whether to fetch.
export async function apiFetch<T>(
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
  if (!res.ok) {
    if (res.status === 401) notifySessionExpired();
    const method = options?.method ?? "GET";
    let serverMessage: string | undefined;
    try {
      const body = await res.clone().json();
      if (typeof body?.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON body — ignore
    }
    throw new ApiError(res.status, path, method, serverMessage);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function apiFetchBlob(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<Blob> {
  const token = await getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.body != null && { "Content-Type": "application/json" }),
    },
    ...(options?.body != null && { body: JSON.stringify(options.body) }),
  });
  if (!res.ok) {
    if (res.status === 401) notifySessionExpired();
    const method = options?.method ?? "GET";
    let serverMessage: string | undefined;
    try {
      const body = await res.clone().json();
      if (typeof body?.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON body — ignore
    }
    throw new ApiError(res.status, path, method, serverMessage);
  }
  return res.blob();
}

export type RopeWikiCandidatePayload = {
  ropeWikiId: number;
  rw: {
    ropeWikiId: number;
    name: string;
    latitude: number;
    longitude: number;
    numAbseils: number | null;
    longestAbseil: number | null;
    vGrade: number | null;
    aGrade: number | null;
    commitment: number | null;
    quality: number | null;
    hours: number | null;
    attributes: TCanyonAttributes;
  };
  candidates: {
    canyonId: string;
    name: string;
    latitude: number;
    longitude: number;
    distanceMeters: number;
    nameMatch: boolean;
  }[];
};

export type ImportResult = {
  imported: number;
  autoLinked: number;
  skipped: number;
  review: RopeWikiCandidatePayload[];
  errors: string[];
};

export type RefreshResult = {
  added: number;
  autoLinked: number;
  review: RopeWikiCandidatePayload[];
  updated: number;
  unchanged: number;
  userEdited: number;
  errors: string[];
};

export type RopeWikiApplyDecision = {
  ropeWikiId: number;
  action: "link" | "create" | "skip";
  targetCanyonId?: string;
};

export type RopeWikiApplyResult = {
  linked: number;
  created: number;
  skipped: number;
  errors: string[];
};

export function importFromRopeWiki(): Promise<ImportResult> {
  return apiFetch<ImportResult>("/ropewiki/import", { method: "POST" });
}

export function applyRopeWikiImport(
  decisions: RopeWikiApplyDecision[],
): Promise<RopeWikiApplyResult> {
  return apiFetch<RopeWikiApplyResult>("/ropewiki/import/apply", {
    method: "POST",
    body: { decisions },
  });
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

export async function syncOzUltimateSources(canyons: TCanyon[]): Promise<boolean> {
  const { matchOzUltimateUrl } = await import("./csvImport/ozultimate");
  const updates = canyons.flatMap((c) => {
    const url = matchOzUltimateUrl(c.name, c.altNames);
    if (!url) return [];
    const alreadySet = c.attributes.sources?.some(([, u]) => u === url) ?? false;
    if (alreadySet) return [];
    return [{ canyon: c, url }];
  });
  if (updates.length === 0) return false;
  await Promise.all(
    updates.map(({ canyon, url }) =>
      updateCanyon(canyon.id, {
        attributes: {
          ...canyon.attributes,
          sources: [...(canyon.attributes.sources ?? []), ["OzUltimate", url]],
        },
      }),
    ),
  );
  return true;
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
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load canyons.")); })
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
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    apiFetch<TCanyon[]>("/canyons/shared")
      .then(setCanyons)
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load shared canyons.")); })
      .finally(() => setLoading(false));
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { canyons, loading, error, refetch };
}

// ── Current user ──────────────────────────────────────────────

export function fetchCurrentUser(): Promise<TUser> {
  return apiFetch<TUser>("/users/me");
}

export function updateCurrentUserThemeScheme(
  themeSchemeId: ThemeSchemeId,
): Promise<TUser> {
  return apiFetch<TUser>("/users/me", {
    method: "PATCH",
    body: { themeSchemeId },
  });
}

export function updateUserPreferences(
  prefs: Partial<{
    themeSchemeId: ThemeSchemeId;
    tripLogCustomFields: TripLogCustomFieldDef[];
    notifications: Partial<NotificationPreferences>;
  }>,
): Promise<TUser> {
  return apiFetch<TUser>("/users/me", { method: "PATCH", body: prefs });
}

export function updateNotificationPreferences(
  notifications: Partial<NotificationPreferences>,
): Promise<TUser> {
  return apiFetch<TUser>("/users/me", { method: "PATCH", body: { notifications } });
}

export function exportUserData(): Promise<Blob> {
  return apiFetchBlob("/users/me/export");
}

export function updateUsername(username: string): Promise<TUser> {
  return apiFetch<TUser>("/users/me", { method: "PATCH", body: { username } });
}

export function deleteAccount(): Promise<void> {
  return apiFetch<void>("/users/me", { method: "DELETE" });
}

export function recordConsent(version: string): Promise<TUser> {
  return apiFetch<TUser>("/users/me", {
    method: "PATCH",
    body: { consentVersion: version },
  });
}

// ── Trip Logs ─────────────────────────────────────────────────

export function getTripLogs(canyonId: string): Promise<TTripLog[]> {
  return apiFetch<TTripLog[]>(`/canyons/${canyonId}/trips`);
}

export function createTripLog(
  canyonId: string,
  data: { date: string; notes?: string | null; customFields?: Record<string, unknown> },
): Promise<TTripLog> {
  return apiFetch<TTripLog>(`/canyons/${canyonId}/trips`, {
    method: "POST",
    body: data,
  });
}

export function updateTripLog(
  canyonId: string,
  id: string,
  data: { date?: string; notes?: string | null; customFields?: Record<string, unknown> },
): Promise<TTripLog> {
  return apiFetch<TTripLog>(`/canyons/${canyonId}/trips/${id}`, {
    method: "PATCH",
    body: data,
  });
}

export function deleteTripLog(canyonId: string, id: string): Promise<void> {
  return apiFetch<void>(`/canyons/${canyonId}/trips/${id}`, { method: "DELETE" });
}

export type BulkTripLogInput = {
  canyonId: string;
  date: string;
  notes?: string | null;
  customFields?: Record<string, unknown>;
};

export type BulkTripLogResult = {
  imported: number;
  errors: { index: number; error: string }[];
};

export function bulkCreateTripLogs(trips: BulkTripLogInput[]): Promise<BulkTripLogResult> {
  return apiFetch<BulkTripLogResult>("/trips/bulk", { method: "POST", body: { trips } });
}

export type BulkCanyonInput = {
  name: string;
  latitude: number;
  longitude: number;
  altNames?: string[];
  notes?: string | null;
  vGrade?: number | null;
  aGrade?: number | null;
  commitment?: number | null;
  quality?: number | null;
  wetsuits?: number | null;
  numAbseils?: number | null;
  longestAbseil?: number | null;
  hours?: number | null;
  attributes?: Record<string, unknown>;
};

export type BulkCanyonRequest =
  | { mode: "create"; canyons: BulkCanyonInput[] }
  | { mode: "replace"; replacements: { canyonId: string; data: BulkCanyonInput }[] };

export type BulkCanyonResult = {
  created: number;
  replaced: number;
  errors: { rowIndex: number; message: string }[];
};

export function bulkCanyonImport(body: BulkCanyonRequest): Promise<BulkCanyonResult> {
  return apiFetch<BulkCanyonResult>("/canyons/bulk", { method: "POST", body });
}

export function getAllTripLogs(params?: {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<TTripLog[]> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.dateFrom) qs.set("dateFrom", params.dateFrom);
  if (params?.dateTo) qs.set("dateTo", params.dateTo);
  const query = qs.toString();
  return apiFetch<TTripLog[]>(`/trips${query ? `?${query}` : ""}`);
}

export function useTripLogs(enabled: boolean) {
  const [tripLogs, setTripLogs] = useState<TTripLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    getAllTripLogs()
      .then(setTripLogs)
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load trip logs.")); })
      .finally(() => setLoading(false));
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { tripLogs, loading, error, refetch };
}

// ── Analytics ─────────────────────────────────────────────────

export type TAnalytics = {
  heroStats: {
    totalTrips: number;
    uniqueCanyons: number;
    daysCanyoning: number;
    totalAbseils: number | null;
  };
  completion: {
    totalCanyons: number;
    canyonsWithTrips: number;
  };
  tripDates: Record<string, number>;
};

export function getAnalytics(): Promise<TAnalytics> {
  return apiFetch<TAnalytics>("/analytics");
}

export function useAnalytics(enabled: boolean) {
  const [analytics, setAnalytics] = useState<TAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    getAnalytics()
      .then(setAnalytics)
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load analytics.")); })
      .finally(() => setLoading(false));
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { analytics, loading, error, refetch };
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
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    getFriends()
      .then(setFriends)
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load friends.")); });
    getFriendRequests()
      .then(setRequests)
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load friend requests.")); });
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { friends, requests, error, refetch };
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
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    getNotifications()
      .then(setNotifications)
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load notifications.")); });
    getUnreadCount()
      .then((r) => setUnreadCount(r.count))
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load notifications.")); });
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { notifications, unreadCount, error, refetch };
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
  if (!passesSliderFilter(canyon.quality, filters.quality, [1, 5]))
    return false;
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
