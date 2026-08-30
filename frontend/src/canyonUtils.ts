import { useEffect, useState, useCallback, useRef } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import type { ThemeSchemeId, TripLogCustomFieldDef, NotificationPreferences, MediaItem, MediaLinkedType, CanyonMergePolicy } from "@logjam/shared";
import { formatTripCanyonNames } from "@logjam/shared";
import { ApiError } from "./errors/ApiError";
import { messageFromError } from "./errors/messageFromError";

export type TCanyonAttributes = {
  sources?: [string, string][];
  customFields?: Record<string, unknown>;
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
  hours: number | null;
  notes: string | null;
  attributes: TCanyonAttributes;
  ropeWikiId: number | null;
  createdAt: string;
  updatedAt: string;
  // Populated only by the canyon-detail endpoint (GET /canyons/:id), not the list.
  media?: MediaItem[];
  // Populated only by the OWNED list (GET /canyons) — never by GET /canyons/shared
  // and never by the detail endpoint. `shares` powers the "shared by me" filter +
  // the card badge; `tripLogLinks` the completion filter + per-row trip count.
  //
  // Optional because on a canyon shared WITH you these counts are absent by
  // design, not zero: the trip tally is the owner's private trip-list
  // cardinality and `shares` is their fan-out to other people, so the API
  // withholds both (see canyonListInclude in api/src/routes/canyons.ts). Absent
  // means "not yours to know" — so never coalesce it to 0 and present that as an
  // answer about a shared canyon. Gate every read on ownership, as passesFilters
  // and the CanyonsPanel row both do.
  _count?: { tripLogLinks: number; shares: number };
};

export type TUser = {
  id: string;
  username: string;
  email: string;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  monthlyTileQuota: number;
  monthlyTileUsage: number;
  monthlyTileResetAt: string;
  consentedAt: string | null;
  consentVersion: string | null;
  uiPreferences?: {
    themeSchemeId?: ThemeSchemeId;
    tripLogCustomFields?: TripLogCustomFieldDef[];
    canyonCustomFields?: TripLogCustomFieldDef[];
    notifications?: NotificationPreferences;
    autoDownloadGeoPdfs?: boolean;
    importMergePolicy?: CanyonMergePolicy;
  } | null;
};

export type TTripLog = {
  id: string;
  // Ordered — order is meaningful, drives the derived title (see tripTitle).
  canyons: { id: string; name: string }[];
  userId: string;
  date: string;
  displayName: string | null;
  types: string[];
  notes: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  // Populated by the per-canyon trip endpoints (GET /canyons/:id/trips[/:id]).
  media?: MediaItem[];
};

// A trip's title: an explicit displayName always wins; otherwise it's the
// joined names of its linked canyons; otherwise a generic fallback. Every
// display site must use this — never inline the canyon?.name ?? displayName
// fallback chain, which predates multi-canyon trips.
export function tripTitle(trip: TTripLog): string {
  return (
    trip.displayName ??
    formatTripCanyonNames(trip.canyons.map((c) => c.name)) ??
    "Untitled trip"
  );
}

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

// [start, end] inclusive ISO-date bounds (yyyy-mm-dd from a date input); either bound nullable.
export type TDateRange = [string | null, string | null];

// A single active custom-field filter. Self-describing (carries its own kind)
// so passesFilters can apply it without consulting the field definitions. The
// kind maps from the field's TripLogCustomFieldType: string→text,
// integer/float→number, date→date, boolean→boolean.
export type TCustomFieldFilter =
  | { kind: "text"; value: string }
  | { kind: "number"; op: "Less than" | "More than" | "Exactly"; value: number }
  // Inclusive [min, max] range for bounded integer/float fields; rendered as a
  // double-ended slider. Full span commits as null (the inactive state).
  | { kind: "numberRange"; range: [number, number] }
  | { kind: "date"; range: TDateRange }
  | { kind: "boolean"; value: boolean };

export type TFilters = {
  name: string | null;
  v_grade: number[] | null;
  a_grade: number[] | null;
  commitment: number[] | null;
  quality: number[] | null;
  pitches: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  longest_pitch: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  hours: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  ownership: "all" | "owned" | "shared";
  // When true, keep only canyons the user has shared with at least one friend.
  shared_by_me: boolean;
  // "Have I done it?" — a canyon is done once it has at least one linked trip,
  // the same rule AnalyticsPanel's completion ring counts (canyonsWithTrips).
  completion: "any" | "done" | "not_done";
  created_at: TDateRange | null;
  updated_at: TDateRange | null;
  ropewiki: "any" | "linked" | "unlinked";
  // Active custom-field filters keyed by field key. Only active filters are
  // present; clearing a field deletes its key. Empty {} means none active.
  custom: Record<string, TCustomFieldFilter>;
  include_unknowns: boolean;
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

// Like apiFetch but also surfaces the X-Total-Count header (the true owner-
// filtered total before the server's list cap). `total` is null when the header
// is absent or unparseable. Used by list hooks to show a "Showing N of TOTAL"
// truncation caption (UX-001). The body shape is unchanged (a bare array), so
// non-paginated consumers keep using plain apiFetch.
export async function apiFetchWithTotal<T>(
  path: string,
): Promise<{ data: T; total: number | null }> {
  const token = await getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401) notifySessionExpired();
    let serverMessage: string | undefined;
    try {
      const body = await res.clone().json();
      if (typeof body?.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON body — ignore
    }
    throw new ApiError(res.status, path, "GET", serverMessage);
  }
  const header = res.headers.get("X-Total-Count");
  const parsed = header == null ? NaN : Number(header);
  const total = Number.isFinite(parsed) ? parsed : null;
  const data = (await res.json()) as T;
  return { data, total };
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

// Like apiFetchBlob but calls onAccepted() as soon as headers arrive (server
// has accepted the request) — before the body is available. Lets callers close
// dialogs / show toasts without waiting for the full response body.
export async function apiFetchBlobStreamed(
  path: string,
  options: { method?: string; body?: unknown },
  onAccepted: () => void,
): Promise<Blob> {
  const token = await getIdToken();
  const method = options.method ?? "GET";
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body != null && { "Content-Type": "application/json" }),
    },
    ...(options.body != null && { body: JSON.stringify(options.body) }),
  });
  if (!res.ok) {
    if (res.status === 401) notifySessionExpired();
    let serverMessage: string | undefined;
    try {
      const body = await res.clone().json();
      if (typeof body?.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON body — ignore
    }
    throw new ApiError(res.status, path, method, serverMessage);
  }
  // Headers received — server accepted. Fire callback before awaiting body.
  onAccepted();
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
  /** ISO timestamp of the RopeWiki corpus the server used. Null if unknown. */
  sourceUpdatedAt: string | null;
};

export type RefreshResult = {
  added: number;
  autoLinked: number;
  review: RopeWikiCandidatePayload[];
  updated: number;
  unchanged: number;
  userEdited: number;
  errors: string[];
  /** ISO timestamp of the RopeWiki corpus the server used. Null if unknown. */
  sourceUpdatedAt: string | null;
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
  /** ISO timestamp of the RopeWiki corpus the server used. Null if unknown. */
  sourceUpdatedAt: string | null;
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

export function bulkDeleteCanyons(
  ids: string[],
): Promise<{ deletedIds: string[] }> {
  return apiFetch<{ deletedIds: string[] }>("/canyons/bulk/delete", {
    method: "POST",
    body: { ids },
  });
}

// Full canyon record incl. canyon-level media (and, for owners, trip logs with
// their media). The list endpoints omit media; this is the only source for it.
export type TCanyonDetail = TCanyon & {
  media: MediaItem[];
  tripLogs?: (TTripLog & { media: MediaItem[] })[];
};

export function getCanyonDetail(id: string): Promise<TCanyonDetail> {
  return apiFetch<TCanyonDetail>(`/canyons/${id}`);
}

// A canyon's track (GPX/KML) for the map track layer: a presigned download URL
// plus its assigned colour. Only canyons the user can access are returned.
export type CanyonTrack = {
  canyonId: string;
  mediaId: string;
  color: string | null;
  displayUrl: string;
};

export function getCanyonTracks(): Promise<CanyonTrack[]> {
  return apiFetch<CanyonTrack[]>("/canyons/tracks");
}

// Fetches canyon tracks only while the map layer is enabled. Bumping the
// returned `refetch` re-pulls (e.g. after a track upload).
export function useCanyonTracks(enabled: boolean) {
  const [tracks, setTracks] = useState<CanyonTrack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    getCanyonTracks()
      .then(setTracks)
      .catch((err) => {
        console.error(err);
        setError(messageFromError(err, "Couldn't load canyon tracks."));
      });
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { tracks, error, refetch };
}


export function useCanyons(enabled: boolean) {
  const [canyons, setCanyons] = useState<TCanyon[]>([]);
  // True owner-filtered total before the server's list cap; null until known.
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    apiFetchWithTotal<TCanyon[]>("/canyons")
      .then(({ data, total }) => {
        setCanyons(data);
        setTotal(total);
      })
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load canyons.")); })
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { canyons, total, loading, loaded, error, refetch };
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

export function useCurrentUser(enabled: boolean) {
  const [currentUser, setCurrentUser] = useState<TUser | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    fetchCurrentUser()
      .then(setCurrentUser)
      // Best-effort: background refresh of the cached current user; callers
      // that need a fresh value already surface their own load errors.
      .catch(console.error);
  }, [enabled, fetchCount]);

  const refetchCurrentUser = useCallback(() => setFetchCount((n) => n + 1), []);

  // Synchronously replace the cached user (e.g. with the row returned by a
  // consent PATCH) so gates keyed on user fields update without a refetch gap.
  return { currentUser, refetchCurrentUser, applyCurrentUser: setCurrentUser };
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
    canyonCustomFields: TripLogCustomFieldDef[];
    notifications: Partial<NotificationPreferences>;
    autoDownloadGeoPdfs: boolean;
    importMergePolicy: CanyonMergePolicy;
  }>,
): Promise<TUser> {
  return apiFetch<TUser>("/users/me", { method: "PATCH", body: prefs });
}

export function updateNotificationPreferences(
  notifications: Partial<NotificationPreferences>,
): Promise<TUser> {
  return apiFetch<TUser>("/users/me", { method: "PATCH", body: { notifications } });
}

// Which custom-field family a management call targets. Maps 1:1 to the API's
// `/custom-fields/:entity/...` route segment and to the User.uiPreferences key
// the definitions live under (trip-log → tripLogCustomFields, canyon →
// canyonCustomFields).
export type CustomFieldEntityKind = "trip-log" | "canyon";

// How many of the user's rows (trip logs or canyons) carry a value for a custom
// field. Shown as an impact warning before renaming or deleting the field. The
// server names the count per-entity (tripLogCount / canyonCount); this
// normalizes it to a plain `count`.
export function getCustomFieldImpact(
  entity: CustomFieldEntityKind,
  key: string,
): Promise<{ count: number }> {
  return apiFetch<{ tripLogCount?: number; canyonCount?: number }>(
    `/custom-fields/${entity}/${encodeURIComponent(key)}/impact`,
  ).then((res) => ({
    count: entity === "canyon" ? (res.canyonCount ?? 0) : (res.tripLogCount ?? 0),
  }));
}

// Delete a custom field: drops its definition and strips its value from every
// row (trip log or canyon) that carried one. Returns the surviving definitions
// and how many rows had a value removed. The server response is per-entity
// (tripLogCustomFields/removedFromTripCount vs canyonCustomFields/
// removedFromCanyonCount); this normalizes it.
export function deleteCustomField(
  entity: CustomFieldEntityKind,
  key: string,
): Promise<{ remainingDefs: TripLogCustomFieldDef[]; removedCount: number }> {
  return apiFetch<{
    tripLogCustomFields?: TripLogCustomFieldDef[];
    canyonCustomFields?: TripLogCustomFieldDef[];
    removedFromTripCount?: number;
    removedFromCanyonCount?: number;
  }>(`/custom-fields/${entity}/${encodeURIComponent(key)}`, {
    method: "DELETE",
  }).then((res) =>
    entity === "canyon"
      ? {
          remainingDefs: res.canyonCustomFields ?? [],
          removedCount: res.removedFromCanyonCount ?? 0,
        }
      : {
          remainingDefs: res.tripLogCustomFields ?? [],
          removedCount: res.removedFromTripCount ?? 0,
        },
  );
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

// Single trip log incl. its media (with fresh presigned URLs). Used by the
// view dialog, which needs media regardless of which list it was opened from.
export function getTripLog(id: string): Promise<TTripLog> {
  return apiFetch<TTripLog>(`/trips/${id}`);
}

export function createTripLog(data: {
  date: string;
  notes?: string | null;
  customFields?: Record<string, unknown>;
  // Ordered, max MAX_CANYONS_PER_TRIP. Independent of displayName — both may be
  // set, either may be omitted.
  canyonIds?: string[];
  displayName?: string | null;
  types?: string[] | null;
}): Promise<TTripLog> {
  return apiFetch<TTripLog>("/trips", {
    method: "POST",
    body: data,
  });
}

export function updateTripLog(
  id: string,
  data: {
    date?: string;
    notes?: string | null;
    customFields?: Record<string, unknown>;
    // Replaces the full linked-canyon set when present.
    canyonIds?: string[];
    displayName?: string | null;
    types?: string[] | null;
  },
): Promise<TTripLog> {
  return apiFetch<TTripLog>(`/trips/${id}`, {
    method: "PATCH",
    body: data,
  });
}

export function deleteTripLog(id: string): Promise<void> {
  return apiFetch<void>(`/trips/${id}`, { method: "DELETE" });
}

// ── Unified file import (idempotent, batch-tagged) ────────────

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
  numAbseils?: number | null;
  longestAbseil?: number | null;
  hours?: number | null;
  attributes?: Record<string, unknown>;
};

// One canyon row to import. The client decides per row whether the data should
// merge into an existing canyon or create a new one (see the unified importer).
export type BulkCanyonRow = {
  data: BulkCanyonInput;
  resolution: { kind: "create" } | { kind: "merge"; canyonId: string };
};

export type BulkCanyonRequest = {
  importBatchId: string;
  rows: BulkCanyonRow[];
  mergePolicy?: CanyonMergePolicy;
};

// One row that folded into an existing canyon: the name as it appeared in the
// user's file, and the canyon it merged into. Reported per merge so the import
// can say which canyons it changed, not just how many.
export type CanyonMergePair = {
  sourceName: string;
  targetName: string;
};

export type BulkCanyonResult = {
  batchId: string;
  created: number;
  merged: number;
  merges: CanyonMergePair[];
  skipped: number;
  errors: { rowIndex: number; message: string }[];
};

export function bulkCanyonImport(body: BulkCanyonRequest): Promise<BulkCanyonResult> {
  return apiFetch<BulkCanyonResult>("/canyons/bulk", { method: "POST", body });
}

// One trip row to import. `canyonId` is resolved client-side (null = canyon-less);
// `sourceCanyonName` is ALWAYS the raw file string and is the idempotency basis.
export type BulkTripLogInput = {
  canyonId: string | null;
  sourceCanyonName: string;
  displayName?: string | null;
  types?: string[] | null;
  date: string;
  notes?: string | null;
  customFields?: Record<string, unknown>;
};

export type BulkTripLogRequest = {
  importBatchId: string;
  trips: BulkTripLogInput[];
};

export type BulkTripLogResult = {
  batchId: string;
  imported: number;
  updated: number;
  errors: { index: number; error: string }[];
};

export function bulkCreateTripLogs(body: BulkTripLogRequest): Promise<BulkTripLogResult> {
  return apiFetch<BulkTripLogResult>("/trips/bulk", { method: "POST", body });
}

export type UndoImportResult = {
  deletedCanyons: number;
  deletedTrips: number;
};

export function undoImport(batchId: string): Promise<UndoImportResult> {
  return apiFetch<UndoImportResult>(`/imports/${batchId}`, { method: "DELETE" });
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
  // True owner-filtered total before the server's list cap; null until known.
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    apiFetchWithTotal<TTripLog[]>("/trips")
      .then(({ data, total }) => {
        setTripLogs(data);
        setTotal(total);
      })
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load trip logs.")); })
      .finally(() => setLoading(false));
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { tripLogs, total, loading, error, refetch };
}

// ── Media (object storage) ────────────────────────────────────

type MediaUploadMeta = {
  linkedType: MediaLinkedType;
  linkedId: string;
  filename: string;
  mediaType: string;
};

type PresignMediaResponse = {
  mediaId: string;
  displayUploadUrl: string;
  thumbnailUploadUrl: string | null;
};

// Direct PUT to a presigned S3 URL. Intentionally raw (not apiFetch): the target
// is S3, not our API, and it must NOT carry the Authorization header. The
// Content-Type must match what the presign signed, or S3 rejects it.
//
// Uses XMLHttpRequest rather than fetch so an optional onProgress callback can
// report upload progress — fetch cannot observe request-body upload progress.
// onProgress fires with bytes (loaded, total) as the body streams to S3.
export function putToPresignedUrl(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed (network error)"));
    xhr.ontimeout = () => reject(new Error("Upload failed (timeout)"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(body);
  });
}

// Orchestrates the two-phase upload: presign → PUT display (+ thumbnail) → confirm.
// `thumbnail` is the client-generated JPEG for images/videos, or null for tracks.
export async function uploadMedia(params: {
  linkedType: MediaLinkedType;
  linkedId: string;
  file: File;
  mediaType: string;
  thumbnail: Blob | null;
}): Promise<MediaItem> {
  const meta: MediaUploadMeta = {
    linkedType: params.linkedType,
    linkedId: params.linkedId,
    filename: params.file.name,
    mediaType: params.mediaType,
  };
  // Declared sizes are signed into the presigned PUT's Content-Length, so the
  // uploaded bytes must match what's declared here (server caps per category).
  const presigned = await apiFetch<PresignMediaResponse>("/media/presign", {
    method: "POST",
    body: {
      ...meta,
      sizeBytes: params.file.size,
      thumbnailSizeBytes: params.thumbnail ? params.thumbnail.size : undefined,
    },
  });
  await putToPresignedUrl(presigned.displayUploadUrl, params.file, params.mediaType);
  if (presigned.thumbnailUploadUrl && params.thumbnail) {
    await putToPresignedUrl(presigned.thumbnailUploadUrl, params.thumbnail, "image/jpeg");
  }
  return apiFetch<MediaItem>(`/media/${presigned.mediaId}/confirm`, {
    method: "POST",
    body: meta,
  });
}

export function deleteMedia(id: string): Promise<void> {
  return apiFetch<void>(`/media/${id}`, { method: "DELETE" });
}

// ── Analytics ─────────────────────────────────────────────────

// /analytics is the canyoning surface: the server scopes every trip-derived
// stat to trips that are canyon-linked OR tagged canyoning (a canyon link means
// "I completed that canyon on that trip"). There is no type filter — it took no
// argument but "canyoning" from its only caller, and there is no dropdown.
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
  // Per-day trip counts across ALL trip types — drives the Activity calendar.
  tripDates: Record<string, number>;
  // Distinct types across ALL the user's trips, canyoning or not.
  types: string[];
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

// ── Sharing audit, per friend (fix 24) ────────────────────────
// Answers "what does Bob see?" from the Friends panel. Deliberately a dedicated
// endpoint rather than share rows on the /canyons list payload: the list is
// capped at 500 (so client-side grouping would silently under-count), and the
// list helper also serves /canyons/shared, where recipient rows would expose the
// owner's other recipients to a sharee.

export type TFriendShareRow = {
  canyonId: string;
  name: string;
  sharedAt: string;
};

export type TFriendShares = {
  // Canyons I own that this friend can see.
  sharedWithThem: TFriendShareRow[];
  // Canyons this friend owns that I can see. Read-only in bulk — see
  // FriendSharingSection.
  sharedWithYou: TFriendShareRow[];
};

export function getFriendShares(friendshipId: string): Promise<TFriendShares> {
  return apiFetch<TFriendShares>(`/friends/${friendshipId}/shares`);
}

/** Revoke every canyon I own that is shared with this friend. Friendship survives. */
export function unshareAllWithFriend(
  friendshipId: string,
): Promise<{ revokedCount: number }> {
  return apiFetch<{ revokedCount: number }>(`/friends/${friendshipId}/shares`, {
    method: "DELETE",
  });
}

export function copyCanyon(canyonId: string): Promise<TCanyon> {
  return apiFetch<TCanyon>(`/canyons/${canyonId}/copy`, { method: "POST" });
}

// ── Notifications ─────────────────────────────────────────────

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
  // True total (pre server-side list cap); null until known.
  const [total, setTotal] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    apiFetchWithTotal<TNotification[]>("/notifications")
      .then(({ data, total }) => { setNotifications(data); setTotal(total); })
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load notifications.")); });
    getUnreadCount()
      .then((r) => setUnreadCount(r.count))
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load notifications.")); });
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { notifications, total, unreadCount, error, refetch };
}

// ── Filters ───────────────────────────────────────────────────

export const emptyFilters: TFilters = {
  name: null,
  v_grade: null,
  a_grade: null,
  commitment: null,
  quality: null,
  pitches: null,
  longest_pitch: null,
  hours: null,
  ownership: "all",
  shared_by_me: false,
  completion: "any",
  created_at: null,
  updated_at: null,
  ropewiki: "any",
  custom: {},
  include_unknowns: false,
};

// Range sliders whose default [min, max] means "inactive".
const RANGE_FILTER_DEFAULTS: [keyof TFilters, [number, number]][] = [
  ["v_grade", [1, 7]],
  ["a_grade", [1, 7]],
  ["commitment", [1, 6]],
  ["quality", [1, 5]],
];

const THRESHOLD_FILTER_KEYS: (keyof TFilters)[] = [
  "pitches",
  "longest_pitch",
  "hours",
];

const DATE_FILTER_KEYS: (keyof TFilters)[] = ["created_at", "updated_at"];

// Returns true when a single filter field is set to anything other than its
// inactive default. Single source of truth for hasActiveFilters/activeFilterCount.
function isFilterActive(filters: TFilters, key: keyof TFilters): boolean {
  if (key === "name") return !!filters.name && filters.name.trim() !== "";
  if (key === "ownership") return filters.ownership !== "all";
  if (key === "shared_by_me") return filters.shared_by_me;
  if (key === "completion") return filters.completion !== "any";
  if (key === "ropewiki") return filters.ropewiki !== "any";
  if (key === "include_unknowns") return false; // a modifier, not a filter
  const rangeDefault = RANGE_FILTER_DEFAULTS.find(([k]) => k === key);
  if (rangeDefault) {
    const [, [min, max]] = rangeDefault;
    const val = filters[key] as number[] | null;
    return !!val && (val[0] !== min || val[1] !== max);
  }
  if (THRESHOLD_FILTER_KEYS.includes(key)) {
    const val = filters[key] as
      | ["Any" | "Less than" | "More than" | "Exactly", number]
      | null;
    return !!val && val[0] !== "Any";
  }
  if (DATE_FILTER_KEYS.includes(key)) {
    const val = filters[key] as TDateRange | null;
    return !!val && (val[0] != null || val[1] != null);
  }
  return false;
}

// Every filter key that contributes to the active-count badge (excludes name,
// which lives in the separate fly-to search box, and include_unknowns).
const COUNTED_FILTER_KEYS: (keyof TFilters)[] = [
  ...RANGE_FILTER_DEFAULTS.map(([k]) => k),
  ...THRESHOLD_FILTER_KEYS,
  ...DATE_FILTER_KEYS,
  "ownership",
  "shared_by_me",
  "completion",
  "ropewiki",
];

export function activeFilterCount(filters: TFilters): number {
  const builtIn = COUNTED_FILTER_KEYS.reduce(
    (count, key) => count + (isFilterActive(filters, key) ? 1 : 0),
    0,
  );
  return builtIn + Object.keys(filters.custom ?? {}).length;
}

// Maps a custom-field definition to the filter kind it produces, so a stored
// filter can be validated against the current definition. Bounded integer/float
// fields render a range slider (numberRange); unbounded ones use op+value.
export function customFilterKind(
  def: TripLogCustomFieldDef,
): TCustomFieldFilter["kind"] {
  switch (def.type) {
    case "string":
      return "text";
    case "integer":
    case "float":
      return def.min != null && def.max != null ? "numberRange" : "number";
    case "date":
      return "date";
    case "boolean":
      return "boolean";
  }
}

// Drops custom-field filters that no longer correspond to a live definition
// (deleted field) or whose stored kind no longer matches the field's type
// (deleted-then-recreated with a different type). Returns the same reference
// when nothing changes so callers can rely on identity stability.
export function reconcileCustomFilters(
  filters: TFilters,
  defs: TripLogCustomFieldDef[],
): TFilters {
  const current = filters.custom ?? {};
  const next: Record<string, TCustomFieldFilter> = {};
  for (const [key, filter] of Object.entries(current)) {
    const def = defs.find((d) => d.key === key);
    if (def && customFilterKind(def) === filter.kind) {
      next[key] = filter;
    }
  }
  if (Object.keys(next).length === Object.keys(current).length) return filters;
  return { ...filters, custom: next };
}

export function hasActiveFilters(filters: TFilters): boolean {
  if (isFilterActive(filters, "name")) return true;
  return activeFilterCount(filters) > 0;
}

// isOwned distinguishes the owner's own canyons from canyons shared with them.
// It's structural (which list the canyon came from), so it can't be read off
// TCanyon — callers pass it per bucket. See Map.tsx / App.tsx.
// "Done" = the viewer has run this canyon. Self-only: only readable for canyons
// the viewer owns. A trip can only link to its own owner's canyons, so on a canyon
// shared *with* the viewer `_count.tripLogLinks` is the OWNER's tally, not theirs —
// reading it would answer the wrong question and leak how often that friend runs it.
// A missing `_count` is a payload shape, not a data gap: zero trips is a real answer.
// Single source for both the completion filter and the map's completed-marker style.
export function isCanyonDoneByViewer(canyon: TCanyon, isOwned: boolean): boolean {
  return isOwned && (canyon._count?.tripLogLinks ?? 0) > 0;
}

export function passesFilters(
  canyon: TCanyon,
  filters: TFilters,
  isOwned: boolean,
): boolean {
  const includeUnknowns = filters.include_unknowns;

  function passesSliderFilter(
    value: number | null | undefined,
    filter: number[] | null,
    range: [number, number],
  ): boolean {
    if (filter && (filter[0] !== range[0] || filter[1] !== range[1])) {
      if (value == null) return includeUnknowns;
      if (value < filter[0] || value > filter[1]) return false;
    }
    return true;
  }

  function passesSelectNumberFilter(
    value: number | null | undefined,
    filter: ["Any" | "Less than" | "More than" | "Exactly", number] | null,
  ): boolean {
    if (filter && filter[0] !== "Any") {
      if (value == null) return includeUnknowns;
      if (filter[0] === "Less than" && value >= filter[1]) return false;
      if (filter[0] === "More than" && value <= filter[1]) return false;
      if (filter[0] === "Exactly" && value !== filter[1]) return false;
    }
    return true;
  }

  function passesDateRangeFilter(
    value: string | null | undefined,
    filter: TDateRange | null,
  ): boolean {
    if (!filter) return true;
    const [start, end] = filter;
    if (start == null && end == null) return true;
    if (value == null) return includeUnknowns;
    const time = Date.parse(value);
    if (start != null && time < Date.parse(start)) return false;
    if (end != null) {
      // end is a yyyy-mm-dd day; include the whole day by extending to its end.
      const endOfDay = Date.parse(end) + 24 * 60 * 60 * 1000 - 1;
      if (time > endOfDay) return false;
    }
    return true;
  }

  if (filters.ownership === "owned" && !isOwned) return false;
  if (filters.ownership === "shared" && isOwned) return false;

  if (filters.shared_by_me && (canyon._count?.shares ?? 0) === 0) return false;

  // "Have *I* done it" — self-only, see isCanyonDoneByViewer for the privacy rationale.
  if (filters.completion !== "any") {
    const doneByViewer = isCanyonDoneByViewer(canyon, isOwned);
    if (filters.completion === "done" && !doneByViewer) return false;
    if (filters.completion === "not_done" && doneByViewer) return false;
  }

  if (filters.ropewiki === "linked" && canyon.ropeWikiId == null) return false;
  if (filters.ropewiki === "unlinked" && canyon.ropeWikiId != null) return false;

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
  if (!passesDateRangeFilter(canyon.createdAt, filters.created_at)) return false;
  if (!passesDateRangeFilter(canyon.updatedAt, filters.updated_at)) return false;

  for (const [key, filter] of Object.entries(filters.custom ?? {})) {
    const value = canyon.attributes?.customFields?.[key];
    if (value == null) {
      if (!includeUnknowns) return false;
      continue;
    }
    switch (filter.kind) {
      case "text":
        if (!String(value).toLowerCase().includes(filter.value.toLowerCase()))
          return false;
        break;
      case "number": {
        const num = typeof value === "number" ? value : Number(value);
        if (filter.op === "Less than" && !(num < filter.value)) return false;
        if (filter.op === "More than" && !(num > filter.value)) return false;
        if (filter.op === "Exactly" && num !== filter.value) return false;
        break;
      }
      case "numberRange": {
        const num = typeof value === "number" ? value : Number(value);
        if (Number.isNaN(num)) {
          if (!includeUnknowns) return false;
          break;
        }
        if (num < filter.range[0] || num > filter.range[1]) return false;
        break;
      }
      case "boolean":
        if (Boolean(value) !== filter.value) return false;
        break;
      case "date":
        if (!passesDateRangeFilter(String(value), filter.range)) return false;
        break;
    }
  }

  return true;
}

// ── Vector style (live, per-user) ─────────────────────────────

import type { VectorStyleSettings, TopoExportJobView } from "@logjam/shared";

// ── Topo exports (Stage 2 on-demand pipeline) ────────────────

// Polls every `pollMs` while enabled AND at least one export is in progress
// (queued/running), so a completing export is observed without always-on
// polling. Falls back to a single fetch once everything is terminal.
export function useTopoExports(enabled: boolean, pollMs: number = 5000) {
  const [exports, setExports] = useState<TopoExportJobView[]>([]);
  // True total (pre server-side list cap); null until known.
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    apiFetchWithTotal<{ exports: TopoExportJobView[] }>("/topo-exports")
      .then(({ data, total }) => { if (!cancelled) { setExports(data.exports); setTotal(total); setError(null); } })
      .catch((err) => { console.error(err); if (!cancelled) setError(messageFromError(err, "Couldn't load exports.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, fetchCount]);

  const hasInProgress = exports.some(
    (e) => e.status === "queued" || e.status === "running",
  );
  useEffect(() => {
    if (!enabled || pollMs <= 0 || !hasInProgress) return;
    const id = setInterval(() => setFetchCount((n) => n + 1), pollMs);
    return () => clearInterval(id);
  }, [enabled, pollMs, hasInProgress]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);
  return { exports, total, loading, error, refetch };
}

export function deleteTopoExport(id: string): Promise<void> {
  return apiFetch<void>(`/topo-exports/${id}`, { method: "DELETE" });
}

export function getTopoExport(id: string): Promise<TopoExportJobView> {
  return apiFetch<TopoExportJobView>(`/topo-exports/${id}`);
}

// ── GeoPDF jobs (async export pipeline) ──────────────────────

export type { GeoPdfJobView } from "@logjam/shared";
import type { GeoPdfJobView } from "@logjam/shared";

// Polls every `pollMs` while enabled AND at least one job is in progress
// (queued/running), mirroring useTopoExports.
export function useGeoPdfJobs(enabled: boolean, pollMs: number = 5000) {
  const [jobs, setJobs] = useState<GeoPdfJobView[]>([]);
  // True total (pre server-side list cap); null until known.
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    apiFetchWithTotal<{ jobs: GeoPdfJobView[] }>("/geo-pdf")
      .then(({ data, total }) => { if (!cancelled) { setJobs(data.jobs); setTotal(total); setError(null); } })
      .catch((err) => { console.error(err); if (!cancelled) setError(messageFromError(err, "Couldn't load GeoPDF jobs.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, fetchCount]);

  const hasInProgress = jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  useEffect(() => {
    if (!enabled || pollMs <= 0 || !hasInProgress) return;
    const id = setInterval(() => setFetchCount((n) => n + 1), pollMs);
    return () => clearInterval(id);
  }, [enabled, pollMs, hasInProgress]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);
  return { jobs, total, loading, error, refetch };
}

export function getGeoPdfJob(id: string): Promise<GeoPdfJobView> {
  return apiFetch<GeoPdfJobView>(`/geo-pdf/${id}`);
}

export function deleteGeoPdfJob(id: string): Promise<void> {
  return apiFetch<void>(`/geo-pdf/${id}`, { method: "DELETE" });
}


export function useVectorStyle(enabled: boolean) {
  const [vectorStyle, setVectorStyle] = useState<VectorStyleSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    apiFetch<VectorStyleSettings>("/vector-style")
      .then((v) => { setVectorStyle(v); setError(null); })
      .catch((err) => { console.error(err); setError(messageFromError(err, "Couldn't load vector style.")); })
      .finally(() => setLoading(false));
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  const save = useCallback(async (next: VectorStyleSettings): Promise<VectorStyleSettings> => {
    const saved = await apiFetch<VectorStyleSettings>("/vector-style", {
      method: "PUT",
      body: next,
    });
    setVectorStyle(saved);
    return saved;
  }, []);

  return { vectorStyle, loading, error, refetch, save };
}

const VECTOR_STYLE_SAVE_DEBOUNCE_MS = 400;

// useLiveVectorStyle: wraps useVectorStyle to give a single, app-level source of
// truth for the vector style. The returned `vectorStyle` updates optimistically
// the instant `setVectorStyle` is called (so the map repaints live), while the
// server PUT is debounced. This lets the LiDAR Topos panel be a controlled editor
// whose edits flow straight to the MapLibre overlay without a page refresh.
export function useLiveVectorStyle(enabled: boolean): {
  vectorStyle: VectorStyleSettings | null;
  setVectorStyle: (next: VectorStyleSettings) => void;
  loadError: string | null;
  saveError: string | null;
} {
  const { vectorStyle: serverStyle, error: loadError, save } = useVectorStyle(enabled);
  const [liveStyle, setLiveStyle] = useState<VectorStyleSettings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed the live style once from the server value; never clobber an in-flight
  // edit on a later server refetch (the saved value already equals the draft).
  useEffect(() => {
    if (serverStyle && liveStyle === null) setLiveStyle(serverStyle);
  }, [serverStyle, liveStyle]);

  const setVectorStyle = useCallback((next: VectorStyleSettings) => {
    setLiveStyle(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      save(next)
        .then(() => setSaveError(null))
        .catch((err) => {
          console.error(err);
          setSaveError(messageFromError(err, "Couldn't save vector style."));
        });
    }, VECTOR_STYLE_SAVE_DEBOUNCE_MS);
  }, [save]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  return { vectorStyle: liveStyle, setVectorStyle, loadError, saveError };
}

const COMMITMENT_NUMERALS = ["I", "II", "III", "IV", "V", "VI"];

/**
 * Render a canyon's grade as `v3a4 III`, omitting any segment that isn't set.
 *
 * Unset segments are dropped rather than filled with a placeholder: a literal
 * `v2a?` reads as corrupt data, when it only means "no A grade recorded"
 * (UX fix 4). `v` and `a` stay glued together (`v2a3`) because that's how the
 * grade is written; the commitment numeral is space-separated.
 *
 * Returns null when nothing is set, so callers can drop the "Grade:" label
 * entirely instead of printing an empty one.
 */
export function formatCanyonGrade(canyon: TCanyon): string | null {
  const { vGrade, aGrade, commitment } = canyon;
  const vaGrade = `${vGrade ? `v${vGrade}` : ""}${aGrade ? `a${aGrade}` : ""}`;
  // Commitment is validated to 1-6 (shared/src/canyonValidation.ts), but index
  // defensively: a display formatter must never render "undefined" to the user.
  const commitmentNumeral = commitment
    ? (COMMITMENT_NUMERALS[commitment - 1] ?? "")
    : "";
  const segments = [vaGrade, commitmentNumeral].filter((s) => s !== "");
  if (segments.length === 0) return null;
  return segments.join(" ");
}
