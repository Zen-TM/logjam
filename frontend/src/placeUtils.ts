import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import type { ScopedCustomFieldDef, StandaloneFile, ThemeSchemeId, TripLogCustomFieldDef, NotificationPreferences, MediaItem, MediaLinkedType, MediaMetadata, MediaOrigin, PlaceMergePolicy, ElevationProfile, SharableEntityType } from "@logjam/shared";
import { formatTripPlaceNames, tallyNotifications } from "@logjam/shared";
import { settleReadOverrides, withReadOverrides, type ReadOverrides } from "./notificationReadOverrides";
import type { BulkShareItem, FriendShareRow, FriendShares } from "@logjam/shared";
import { ApiError } from "./errors/ApiError";
import { messageFromError } from "./errors/messageFromError";
// Profiles already sampled this session, so reopening or editing a line does
// not re-ask the DEM a question it has answered (see the module's header).
import { cacheProfile, cachedProfile } from "./elevationCache";

// The server's REST response shapes are declared ONCE in shared/ and
// re-exported here, so the mobile client (mobile/src/api/types.ts) and this
// file cannot drift — they used to be two hand-maintained copies kept in step
// by a comment. Every existing `from "./placeUtils"` import still resolves.
export type {
  TPlace,
  TNotification,
  TTripLog,
  TUser,
} from "@logjam/shared";
import type { TPlace, TNotification, TTripLog, TUser } from "@logjam/shared";

// A trip's title: an explicit displayName always wins; otherwise it's the
// joined names of its linked places; otherwise a generic fallback. Every
// display site must use this — never inline the place?.name ?? displayName
// fallback chain, which predates multi-place trips.
export function tripTitle(trip: TTripLog): string {
  return (
    trip.displayName ??
    formatTripPlaceNames(trip.places.map((c) => c.name)) ??
    "Untitled trip"
  );
}

// Only http(s) URLs are safe to render as a clickable <a href> or store as a
// place source link — any other scheme (javascript:, data:, vbscript:, ...)
// is an XSS/hygiene sink. FEUI-012. Single source for both the save-time
// reject in PlaceDialog and the render-time guard in PlaceDetailPanel.
export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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

export type TPlaceShare = {
  id: string;
  placeId: string;
  sharedWith: { id: string; username: string };
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
    // RopeWiki's OWN shape, which keeps its camelCase names: it is foreign
    // data and its snapshot is persisted on the row and compared field by
    // field on refresh, so renaming these keys would make every stored
    // snapshot look like a user edit. The API translates them to reserved
    // field keys at the boundary where a value reaches a place.
    numAbseils: number | null;
    longestAbseil: number | null;
    vGrade: number | null;
    aGrade: number | null;
    commitment: number | null;
    quality: number | null;
    hours: number | null;
    sources?: [string, string][];
  };
  candidates: {
    placeId: string;
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
  targetPlaceId?: string;
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

export type CreatePlaceData = {
  name: string;
  altNames?: string[];
  latitude: number;
  longitude: number;
  /** Required by the API — a place with no type would have no form to fill in
   *  and no tab to appear under. */
  placeTypeId: string;
  notes?: string | null;
  /** Type-specific values, keyed by definition key. Replaces the seven grade
   *  members this type used to carry. */
  fieldValues?: Record<string, unknown>;
};

export function createPlace(data: CreatePlaceData): Promise<TPlace> {
  return apiFetch<TPlace>("/places", { method: "POST", body: data });
}

export function updatePlace(
  id: string,
  data: Partial<Omit<TPlace, "id" | "createdAt" | "updatedAt" | "ropeWikiId">>,
): Promise<TPlace> {
  return apiFetch<TPlace>(`/places/${id}`, { method: "PATCH", body: data });
}

export function deletePlace(id: string): Promise<void> {
  return apiFetch<void>(`/places/${id}`, { method: "DELETE" });
}

export function bulkDeletePlaces(
  ids: string[],
): Promise<{ deletedIds: string[] }> {
  return apiFetch<{ deletedIds: string[] }>("/places/bulk/delete", {
    method: "POST",
    body: { ids },
  });
}

// Full place record incl. place-level media (and, for owners, trip logs with
// their media). The list endpoints omit media; this is the only source for it.
export type TPlaceDetail = TPlace & {
  media: MediaItem[];
  tripLogs?: (TTripLog & { media: MediaItem[] })[];
};

export function getPlaceDetail(id: string): Promise<TPlaceDetail> {
  return apiFetch<TPlaceDetail>(`/places/${id}`);
}

// A place's track (GPX/KML) for the map track layer: a presigned download URL
// plus its assigned colour. Only places the user can access are returned.
export type PlaceTrack = {
  placeId: string;
  mediaId: string;
  color: string | null;
  displayUrl: string;
  /**
   * What the file IS. Without these a place's track could only be listed as a
   * kind of its own, named for its place, because nothing here said whether it
   * was a recording or an import or what it was called (Ways, 2026-09-17).
   */
  filename: string;
  displayName: string | null;
  origin: MediaOrigin | null;
  fileSizeBytes: number;
  metadata: MediaMetadata;
};

export function getPlaceTracks(): Promise<PlaceTrack[]> {
  return apiFetch<PlaceTrack[]>("/places/tracks");
}

// Fetches place tracks only while the map layer is enabled. Bumping the
// returned `refetch` re-pulls (e.g. after a track upload).
export function usePlaceTracks(enabled: boolean) {
  const [tracks, setTracks] = useState<PlaceTrack[]>([]);
  const [error, setError] = useState<string | null>(null);
  // True once the first fetch settles. An empty list before then is not "no
  // tracks" (DESIGN.md §8), and Ways says so rather than flashing its
  // first-run screen at every user.
  const [loaded, setLoaded] = useState(false);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    // Guards against an earlier in-flight request landing after a newer one
    // (e.g. a write bumps refetch mid-request) and overwriting fresh state
    // with stale data — mirrors useTopoExports (FECO-001).
    let cancelled = false;
    getPlaceTracks()
      .then((data) => { if (!cancelled) setTracks(data); })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(messageFromError(err, "Couldn't load place tracks."));
      })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { tracks, loaded, error, refetch };
}


// ponytail: the web has no marker-specific surface at all until phase 6 — a
// marker is listed, edited and mapped as the place it is. Upgrade path: the
// type-tabbed places panel and the Linked places section, which need the
// type-management screens beside them.
//
// Waypoints are GONE as a separate thing: phase 1c folded them into places of
// the system "Marker" type, so the list, the map pins and the detail view are
// the PLACE ones. The web's own marker surfaces (a type-tabbed places list, a
// Linked places section) land with the rest of the web rework — until then a
// marker is a place in the places panel, which is where it already appears.

// ── Routes ───────────────────────────────────────────────────────────────
// User-authored lines. Unlike tracks, geometry arrives INLINE (no presigned
// blob to fetch and parse) — see the Route model in the API schema.

export type TRoute = {
  id: string;
  ownerId: string;
  placeId: string | null;
  name: string;
  color: string;
  points: [number, number][];
  /**
   * Indices into `points` marking the vertices the USER placed, as opposed to
   * the ones snapping filled in. Null on routes drawn before snapping existed,
   * which reads as "every point is the user's".
   */
  anchors: number[] | null;
  createdAt: string;
  updatedAt: string;
};

/** A PATCH/POST that changed a place link reports which route it displaced. */
export type RouteWriteResult = TRoute & {
  displacedRoute: { id: string; name: string } | null;
};

export function getRoutes(): Promise<TRoute[]> {
  return apiFetch<TRoute[]>("/routes");
}

export function createRoute(data: {
  name: string;
  points: [number, number][];
  anchors?: number[] | null;
  placeId?: string | null;
  color?: string;
}): Promise<RouteWriteResult> {
  return apiFetch<RouteWriteResult>("/routes", { method: "POST", body: data });
}

export function updateRoute(
  id: string,
  data: Partial<{
    name: string;
    points: [number, number][];
    anchors: number[] | null;
    placeId: string | null;
    color: string;
  }>,
): Promise<RouteWriteResult> {
  return apiFetch<RouteWriteResult>(`/routes/${id}`, {
    method: "PATCH",
    body: data,
  });
}

export function deleteRoute(id: string): Promise<void> {
  return apiFetch<void>(`/routes/${id}`, { method: "DELETE" });
}

/**
 * Elevation profile for an arbitrary line, sampled from the DEM server-side.
 *
 * Never stored: geometry is the source of truth, so the profile is re-derived
 * whenever it is shown. See shared/src/elevation.ts.
 */
export function getElevationProfile(
  points: [number, number][],
): Promise<ElevationProfile & { attribution: string }> {
  return apiFetch<ElevationProfile & { attribution: string }>(
    "/elevation/profile",
    { method: "POST", body: { points } },
  );
}

/**
 * Loads a profile for the given points, keyed on the geometry itself: move a
 * vertex and it re-samples, reopen the same line and it does not.
 *
 * The second half of that is `elevationCache.ts`, and it was a promise this
 * docstring made without keeping until 2026-09-17 — opening a way, editing it
 * and leaving the editor were three requests for a line nobody had touched.
 * A cache hit is seeded SYNCHRONOUSLY, before the first paint, so a line that
 * has already been sampled draws its chart immediately rather than flashing
 * "Reading the terrain…" at someone who was just looking at it.
 */
export function useElevationProfile(points: [number, number][] | null) {
  const geometryKey = points ? JSON.stringify(points) : null;
  const [profile, setProfile] = useState<
    (ElevationProfile & { attribution: string }) | null
  >(() => (geometryKey ? cachedProfile(geometryKey) : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!geometryKey) {
      setProfile(null);
      return;
    }
    const known = cachedProfile(geometryKey);
    if (known) {
      setProfile(known);
      setLoading(false);
      setError(null);
      return;
    }
    // A late response from a previous line must not overwrite this one's.
    let current = true;
    setLoading(true);
    setError(null);
    getElevationProfile(JSON.parse(geometryKey) as [number, number][])
      .then((result) => {
        // Cached even if this hook has moved on: the answer is about the
        // geometry, not about who asked.
        cacheProfile(geometryKey, result);
        if (current) setProfile(result);
      })
      .catch((err) => {
        console.error(err);
        if (current) setError(messageFromError(err, "Couldn't load elevation."));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [geometryKey]);

  return { profile, loading, error };
}

/** Fetches routes only while the map layer is enabled, mirroring
 * usePlaceTracks. Bump `refetch` after any route write. */
export function useRoutes(enabled: boolean) {
  const [routes, setRoutes] = useState<TRoute[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** True once the first fetch settles — see `usePlaceTracks`. */
  const [loaded, setLoaded] = useState(false);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    // Guards a stale in-flight response landing after a newer one (FECO-001).
    let cancelled = false;
    getRoutes()
      .then((data) => { if (!cancelled) setRoutes(data); })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(messageFromError(err, "Couldn't load routes."));
      })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { routes, loaded, error, refetch };
}

export function usePlaces(enabled: boolean) {
  const [places, setPlaces] = useState<TPlace[]>([]);
  // True owner-filtered total before the server's list cap; null until known.
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    // Guards a stale in-flight response landing after a newer one (FECO-001).
    let cancelled = false;
    apiFetchWithTotal<TPlace[]>("/places")
      .then(({ data, total }) => {
        if (cancelled) return;
        setPlaces(data);
        setTotal(total);
      })
      .catch((err) => { console.error(err); if (!cancelled) setError(messageFromError(err, "Couldn't load places.")); })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { places, total, loading, loaded, error, refetch };
}

export function useSharedPlaces(enabled: boolean) {
  const [places, setPlaces] = useState<TPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    // Guards a stale in-flight response landing after a newer one (FECO-001).
    let cancelled = false;
    apiFetch<TPlace[]>("/places/shared")
      .then((data) => { if (!cancelled) setPlaces(data); })
      .catch((err) => { console.error(err); if (!cancelled) setError(messageFromError(err, "Couldn't load shared places.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { places, loading, error, refetch };
}

// ── Current user ──────────────────────────────────────────────

export function fetchCurrentUser(): Promise<TUser> {
  return apiFetch<TUser>("/users/me");
}

// ── Processing credits ────────────────────────────────────────

/** What a worker job would cost, and what the caller has left this month.
 * `credits` is null when the server's adaptive estimator has too little
 * history to have an opinion — render that as unknown, never as free. */
export type ComputeEstimate = {
  estimatedSeconds: number | null;
  credits: number | null;
  used: number;
  quota: number;
  remaining: number;
  resetAt: string;
  wouldExceed: boolean;
};

export type ComputeEstimateRequest =
  | { kind: "topo"; tileCount: number | null }
  | { kind: "topoExport"; sourceJobId: string; format: string; bundling: string }
  | { kind: "geoPdf"; config: unknown };

export function fetchComputeEstimate(
  request: ComputeEstimateRequest,
): Promise<ComputeEstimate> {
  return apiFetch<ComputeEstimate>("/compute-estimate", {
    method: "POST",
    body: request,
  });
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
    // NOTE: no `tripLogCustomFields` / `placeCustomFields` here. Definitions
    // are rows, written through the row-grain calls below; sending them here
    // is a 400 naming the replacement rather than a silent no-op.
    notifications: Partial<NotificationPreferences>;
    autoDownloadGeoPdfs: boolean;
    importMergePolicy: PlaceMergePolicy;
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
// the definitions live under (trip-log → tripLogCustomFields, place →
// placeCustomFields).
export type CustomFieldEntityKind = "trip-log" | "place";

// ── place types ─────────────────────────────────────────────────────────────
//
// A type is a CATEGORY of place, carrying its icon and colour and owning the
// field definitions scoped to it. Three are SYSTEM types (`ownerId: null`) —
// global rows every account shares, which is what lets a shared or copied place
// of a system type resolve for its recipient with no reconciliation at all.
// They cannot be renamed or deleted; the API answers 404 rather than 403 for
// either, the same way every id-addressed surface does.

export type TPlaceType = {
  id: string;
  ownerId: string | null;
  name: string;
  iconKey: string;
  color: string;
  position: number;
  isSystem: boolean;
  /** The caller's own places of this type. Two rules read it: a type with
   *  none is hidden from the tab bar and the layer list (but ALWAYS offered
   *  when creating a place, or a user could never make their first canyon),
   *  and a type with places in it cannot be deleted. */
  placeCount: number;
};

export function getPlaceTypes(): Promise<TPlaceType[]> {
  return apiFetch<{ types: TPlaceType[] }>("/place-types").then((r) => r.types);
}

export function createPlaceType(body: {
  name: string;
  iconKey: string;
  color: string;
}): Promise<TPlaceType> {
  return apiFetch<TPlaceType>("/place-types", { method: "POST", body });
}

export function updatePlaceType(
  id: string,
  body: Partial<{ name: string; iconKey: string; color: string; position: number }>,
): Promise<TPlaceType> {
  return apiFetch<TPlaceType>(`/place-types/${id}`, { method: "PATCH", body });
}

/** Deletes an EMPTY type. A type holding places is refused — deleting a
 *  category must never delete what is in it — and the caller offers a reassign
 *  instead. Returns how many definitions scoped only to it went with it. */
export function deletePlaceType(id: string): Promise<{ removedFieldCount: number }> {
  return apiFetch<{ removedFieldCount: number }>(`/place-types/${id}`, {
    method: "DELETE",
  });
}

/** Move every place of one type to another, so an unwanted type can then be
 *  deleted without taking its places with it. */
export function reassignPlaceType(
  id: string,
  toPlaceTypeId: string,
): Promise<{ movedCount: number }> {
  return apiFetch<{ movedCount: number }>(`/place-types/${id}/reassign`, {
    method: "POST",
    // The server reads `placeTypeId` (routes/placeTypes.ts, pinned by
    // `__tests__/placeTypes.test.ts`). Sent as `toPlaceTypeId`, every move
    // came back 400 "A different placeTypeId is required" — the destination
    // simply was not in the payload the route read.
    body: { placeTypeId: toPlaceTypeId },
  });
}

/**
 * Adopt, discard or append one value the place is holding for a field this
 * owner has no definition for (§2.6).
 *
 * ONE endpoint for the three because they share every precondition and differ
 * only in what they do at the end. Returns the updated place, so a caller can
 * render the result without a refetch — though adopting also creates a
 * definition, and the caller has to reload those.
 */
export function resolveForeignField(
  placeId: string,
  key: string,
  action: "adopt" | "discard" | "notes",
): Promise<TPlace> {
  return apiFetch<TPlace>(
    `/places/${placeId}/foreign-fields/${encodeURIComponent(key)}`,
    { method: "POST", body: { action } },
  );
}

// ── custom field definitions: ROW-GRAIN, always ─────────────────────────────
//
// These used to go through `PATCH /users/me { placeCustomFields: [...] }` — a
// whole-list reconcile of `{key,label,type,min,max}`. That path is GONE, and
// its removal is not a tidy-up: the shape cannot express what a definition is
// any more. It carries no `placeTypeIds` and no `appliesToAllTypes`, so every
// save from a dialog that round-tripped the list would have wiped the scoping
// off every definition — silently, because the payload does not mention it —
// and it matched only the caller's own rows, so the SYSTEM definitions fell
// through to the create branch and gave the user a private duplicate of every
// built-in field, colliding under the same key.
//
// Per-row writes also mean two devices that each add a field both keep it,
// which is the same reason the phone's definitions moved off the user record.

/** Every definition for one entity, WITH its scoping. */
export function getCustomFields(
  entity: CustomFieldEntityKind,
): Promise<ScopedCustomFieldDef[]> {
  return apiFetch<{ fields: ScopedCustomFieldDef[] }>(
    `/custom-fields/${entity}`,
  ).then((res) => res.fields);
}

/**
 * Add one definition. `placeTypeIds` says which types it appears on;
 * `appliesToAllTypes` covers types created later, which join rows cannot.
 * Neither given means the field appears on NO form — visible and fixable,
 * unlike one that appears on every form.
 */
export function createCustomField(
  entity: CustomFieldEntityKind,
  field: TripLogCustomFieldDef,
  scope?: { placeTypeIds?: string[]; appliesToAllTypes?: boolean },
): Promise<ScopedCustomFieldDef[]> {
  // The server answers with the ONE definition it made ({ field }), and every
  // caller wants the list that definition now belongs to, in the server's
  // order — so read the list back. Taking `res.fields` off that answer handed
  // callers `undefined`, and the trip form crashed on its next render.
  return apiFetch<{ field: ScopedCustomFieldDef }>(`/custom-fields/${entity}`, {
    method: "POST",
    body: { field, ...scope },
  }).then(() => getCustomFields(entity));
}

/**
 * Change a definition in place, addressed by KEY. The key is not writable: it
 * is what stored values are keyed by, so a rename that moved it would orphan
 * every value the field already holds.
 */
export function updateCustomField(
  entity: CustomFieldEntityKind,
  key: string,
  patch: {
    label?: string;
    type?: string;
    min?: number | null;
    max?: number | null;
    position?: number;
    placeTypeIds?: string[];
    appliesToAllTypes?: boolean;
  },
): Promise<ScopedCustomFieldDef[]> {
  return apiFetch<{ fields: ScopedCustomFieldDef[] }>(
    `/custom-fields/${entity}/${encodeURIComponent(key)}`,
    { method: "PATCH", body: patch },
  ).then((res) => res.fields);
}

// How many of the user's rows (trip logs or places) carry a value for a custom
// field. Shown as an impact warning before renaming or deleting the field. The
// server names the count per-entity (tripLogCount / placeCount); this
// normalizes it to a plain `count`.
export function getCustomFieldImpact(
  entity: CustomFieldEntityKind,
  key: string,
): Promise<{ count: number }> {
  return apiFetch<{ tripLogCount?: number; placeCount?: number }>(
    `/custom-fields/${entity}/${encodeURIComponent(key)}/impact`,
  ).then((res) => ({
    count: entity === "place" ? (res.placeCount ?? 0) : (res.tripLogCount ?? 0),
  }));
}

// Delete a custom field: drops its definition and strips its value from every
// row (trip log or place) that carried one. Returns the surviving definitions
// and how many rows had a value removed. The server response is per-entity
// (tripLogCustomFields/removedFromTripCount vs placeCustomFields/
// removedFromPlaceCount); this normalizes it.
export function deleteCustomField(
  entity: CustomFieldEntityKind,
  key: string,
): Promise<{ remainingDefs: ScopedCustomFieldDef[]; removedCount: number }> {
  return apiFetch<{
    tripLogCustomFields?: ScopedCustomFieldDef[];
    placeCustomFields?: ScopedCustomFieldDef[];
    removedFromTripCount?: number;
    removedFromPlaceCount?: number;
  }>(`/custom-fields/${entity}/${encodeURIComponent(key)}`, {
    method: "DELETE",
  }).then((res) =>
    entity === "place"
      ? {
          remainingDefs: res.placeCustomFields ?? [],
          removedCount: res.removedFromPlaceCount ?? 0,
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

export function getTripLogs(placeId: string): Promise<TTripLog[]> {
  return apiFetch<TTripLog[]>(`/places/${placeId}/trips`);
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
  // Ordered, max MAX_PLACES_PER_TRIP. Independent of displayName — both may be
  // set, either may be omitted.
  placeIds?: string[];
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
    // Replaces the full linked-place set when present.
    placeIds?: string[];
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

/** Owner-only, one request for a selection. The server refuses more than its
 *  `BULK_DELETE_LIMIT` at once (413), so a longer selection is sent in chunks. */
export async function bulkDeleteTripLogs(ids: string[], chunkSize = 500): Promise<string[]> {
  const deleted: string[] = [];
  for (let start = 0; start < ids.length; start += chunkSize) {
    const { deletedIds } = await apiFetch<{ deletedIds: string[] }>("/trips/bulk/delete", {
      method: "POST",
      body: { ids: ids.slice(start, start + chunkSize) },
    });
    deleted.push(...deletedIds);
  }
  return deleted;
}

// ── Unified file import (idempotent, batch-tagged) ────────────

export type BulkPlaceInput = {
  name: string;
  latitude: number;
  longitude: number;
  altNames?: string[];
  notes?: string | null;
  fieldValues?: Record<string, unknown>;
};

// One place row to import. The client decides per row whether the data should
// merge into an existing place or create a new one (see the unified importer).
export type BulkPlaceRow = {
  data: BulkPlaceInput;
  resolution: { kind: "create" } | { kind: "merge"; placeId: string };
};

export type BulkPlaceRequest = {
  importBatchId: string;
  /** Every row of one import lands in ONE type, chosen before column mapping —
   *  the type's field labels are what the columns map onto. */
  placeTypeId: string;
  rows: BulkPlaceRow[];
  mergePolicy?: PlaceMergePolicy;
};

// One row that folded into an existing place: the name as it appeared in the
// user's file, and the place it merged into. Reported per merge so the import
// can say which places it changed, not just how many.
export type PlaceMergePair = {
  sourceName: string;
  targetName: string;
};

export type BulkPlaceResult = {
  batchId: string;
  created: number;
  merged: number;
  merges: PlaceMergePair[];
  skipped: number;
  errors: { rowIndex: number; message: string }[];
};

export function bulkPlaceImport(body: BulkPlaceRequest): Promise<BulkPlaceResult> {
  return apiFetch<BulkPlaceResult>("/places/bulk", { method: "POST", body });
}

// One trip row to import. `placeId` is resolved client-side (null = place-less);
// `sourcePlaceName` is ALWAYS the raw file string and is the idempotency basis.
export type BulkTripLogInput = {
  placeId: string | null;
  sourcePlaceName: string;
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
  deletedPlaces: number;
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
  // False until the first fetch settles: an empty list before then is not "no
  // trips yet", and saying so flashes a first-run screen at every user.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    // Guards a stale in-flight response landing after a newer one (FECO-001).
    let cancelled = false;
    apiFetchWithTotal<TTripLog[]>("/trips")
      .then(({ data, total }) => {
        if (cancelled) return;
        setTripLogs(data);
        setTotal(total);
      })
      .catch((err) => { console.error(err); if (!cancelled) setError(messageFromError(err, "Couldn't load trip logs.")); })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { tripLogs, total, loading, loaded, error, refetch };
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

// ── Standalone files ──────────────────────────────────────────
// A file that belongs to nobody but the user: a GPX/KML/GeoJSON they imported,
// or a track Logjam GPS recorded. The list is metadata only — blob content
// comes from POST /media/download-urls, which is where the egress gate lives,
// so a URL is minted only for the files actually being drawn.

export function getStandaloneFiles(): Promise<StandaloneFile[]> {
  return apiFetch<StandaloneFile[]>("/media/standalone");
}

export function useStandaloneFiles(enabled: boolean) {
  const [files, setFiles] = useState<StandaloneFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** True once the first fetch settles — see `usePlaceTracks`. */
  const [loaded, setLoaded] = useState(false);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getStandaloneFiles()
      .then((data) => { if (!cancelled) setFiles(data); })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(messageFromError(err, "Couldn't load your files."));
      })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { files, loaded, error, refetch };
}

export function renameMedia(id: string, displayName: string): Promise<MediaItem> {
  return apiFetch<MediaItem>(`/media/${id}`, {
    method: "PATCH",
    body: { displayName },
  });
}

export function getMediaDownloadUrls(
  ids: string[],
): Promise<{ items: { id: string; displayUrl: string; thumbnailUrl: string | null }[] }> {
  return apiFetch<{
    items: { id: string; displayUrl: string; thumbnailUrl: string | null }[];
  }>("/media/download-urls", { method: "POST", body: { ids } });
}

/** A standalone file resolved to something the map track layer can fetch. */
export type StandaloneTrack = {
  mediaId: string;
  color: string | null;
  displayUrl: string;
};

/**
 * Presigned URLs for the standalone files currently toggled onto the map.
 * Ids the server won't serve (egress cap, deleted row) are simply absent from
 * the response — they drop off the map rather than erroring the whole layer.
 *
 * A file LINKED to a place is excluded: it is that place's way, and the
 * place-tracks layer already draws it. Without this the same geometry is
 * fetched twice, presigned twice against the egress meter, and stacked on
 * itself — invisible until two colours disagree.
 */
export function useStandaloneTracks(files: StandaloneFile[], shownIds: string[]) {
  const [tracks, setTracks] = useState<StandaloneTrack[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const shown = files.filter(
      (file) => file.linkedPlaceId === null && shownIds.includes(file.id),
    );
    if (shown.length === 0) {
      setTracks([]);
      return;
    }
    let cancelled = false;
    getMediaDownloadUrls(shown.map((file) => file.id))
      .then(({ items }) => {
        if (cancelled) return;
        const colorById = new Map(shown.map((file) => [file.id, file.color]));
        setTracks(
          items.map((item) => ({
            mediaId: item.id,
            color: colorById.get(item.id) ?? null,
            displayUrl: item.displayUrl,
          })),
        );
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(messageFromError(err, "Couldn't load your files."));
      });
    return () => { cancelled = true; };
  }, [files, shownIds]);

  return { tracks, error };
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
    // Guards a stale in-flight response landing after a newer one (FECO-001).
    let cancelled = false;
    getFriends()
      .then((data) => { if (!cancelled) setFriends(data); })
      .catch((err) => { console.error(err); if (!cancelled) setError(messageFromError(err, "Couldn't load friends.")); });
    getFriendRequests()
      .then((data) => { if (!cancelled) setRequests(data); })
      .catch((err) => { console.error(err); if (!cancelled) setError(messageFromError(err, "Couldn't load friend requests.")); });
    return () => { cancelled = true; };
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  return { friends, requests, error, refetch };
}

// ── Sharing ───────────────────────────────────────────────────

export function sharePlaceWith(
  placeId: string,
  sharedWithUserId: string,
): Promise<void> {
  return apiFetch<void>(`/places/${placeId}/share`, {
    method: "POST",
    body: { sharedWithUserId },
  });
}

export function unsharePlaceWith(
  placeId: string,
  userId: string,
): Promise<void> {
  return apiFetch<void>(`/places/${placeId}/share/${userId}`, {
    method: "DELETE",
  });
}

export function getPlaceShares(placeId: string): Promise<TPlaceShare[]> {
  return apiFetch<TPlaceShare[]>(`/places/${placeId}/shares`);
}

// ── Direct sharing, non-place entities ───────────────────────
// Waypoints, routes, LiDAR topo jobs and GeoPDF jobs. A live, read-only view
// the owner can revoke — NOT the same promise as a sent copy below.

export type TEntityShare = {
  id: string;
  entityType: SharableEntityType;
  entityId: string;
  sharedWith: { id: string; username: string };
};

export function getEntityShares(
  entityType: SharableEntityType,
  entityId: string,
): Promise<TEntityShare[]> {
  return apiFetch<TEntityShare[]>(`/shares/${entityType}/${entityId}`);
}

export function shareEntityWith(
  entityType: SharableEntityType,
  entityId: string,
  sharedWithUserId: string,
): Promise<void> {
  return apiFetch<void>(`/shares`, {
    method: "POST",
    body: { entityType, entityId, sharedWithUserId },
  });
}

export function unshareEntityWith(
  entityType: SharableEntityType,
  entityId: string,
  userId: string,
): Promise<void> {
  return apiFetch<void>(`/shares/${entityType}/${entityId}/${userId}`, {
    method: "DELETE",
  });
}

/**
 * Who owns a row shared with you, for the confirms that name them.
 *
 * The friends list is the only place the web holds a username for an id: rows
 * shared with you carry `ownerId` and nothing else, and a share can only exist
 * between friends — so a miss here means the friendship has just gone, and the
 * copy falls back to "The owner" rather than inventing a name.
 */
export function ownerUsername(
  friends: TFriend[],
  ownerId: string,
): string | null {
  return friends.find((friend) => friend.id === ownerId)?.username ?? null;
}

// ── Sent copies (FileSend), recipient side ────────────────────
// A file a friend handed over. Accepting downloads it and it is then THEIRS —
// there is no revoking a copy, so nothing here may be worded as if there were.
// Web has no vector-import feature, so accepting means a browser download, not
// an import. There is no sender side on web: nothing here holds a local file to
// send.

// NO `GET /file-sends/inbox` HELPER. The Inbox draws every send from the
// notification each one writes, and answers it there; the Friends page held a
// second, separately-fetched copy of that list until 2026-09-18, which could
// disagree with the Inbox about what was still pending.

/** Returns a short-lived presigned URL. Accepted rows stay downloadable until
 *  the send expires, which is what makes a re-download possible after a failed
 *  transfer (the API flips status when the URL is issued, not when it lands). */
export function acceptFileSend(
  fileSendId: string,
): Promise<{ downloadUrl: string; filename: string }> {
  return apiFetch<{ downloadUrl: string; filename: string }>(
    `/file-sends/${fileSendId}/accept`,
    { method: "POST" },
  );
}

export function declineFileSend(fileSendId: string): Promise<void> {
  return apiFetch<void>(`/file-sends/${fileSendId}/decline`, { method: "POST" });
}

// ── Sharing audit, per friend (fix 24) ────────────────────────
// Answers "what does Bob see?" from the Friends panel. Deliberately a dedicated
// endpoint rather than share rows on the /places list payload: the list is
// capped at 500 (so client-side grouping would silently under-count), and the
// list helper also serves /places/shared, where recipient rows would expose the
// owner's other recipients to a sharee.

// The row shape is `FriendShareRow` in shared/src/sharing.ts — (entityType,
// entityId, name, sharedAt), the same pair a bulk share speaks, because the
// payload covers every shareable kind and not just places. THIS panel still
// renders places only (it filters on `entityType`), so waypoint/route/topo/
// GeoPDF shares are visible on Logjam GPS and not here yet.
export type TFriendShareRow = FriendShareRow;
export type TFriendShares = FriendShares;

export function getFriendShares(friendshipId: string): Promise<TFriendShares> {
  return apiFetch<TFriendShares>(`/friends/${friendshipId}/shares`);
}

/**
 * Revoke what I own that is shared with this friend. Friendship survives.
 *
 * `items` NAMES what to revoke, and this panel always passes the place rows it
 * is showing: the endpoint's no-body form means "everything, both tables", and
 * a panel whose confirm counts places must not silently revoke the item shares
 * it never listed.
 */
export function unshareAllWithFriend(
  friendshipId: string,
  items: BulkShareItem[],
): Promise<{ revokedCount: number }> {
  return apiFetch<{ revokedCount: number }>(`/friends/${friendshipId}/shares`, {
    method: "DELETE",
    body: { items: items.map(({ entityType, entityId }) => ({ entityType, entityId })) },
  });
}

/** What a place copy did beyond minting the row — see `PlaceCopyResult`. */
export type CopiedPlace = TPlace & {
  mediaCopied?: number;
  mediaSkipped?: number;
  mediaOutOfSpace?: true;
};

/**
 * Copy a shared place into my own account.
 *
 * NO `copyMedia` IN THE BODY, deliberately: the server then falls back to the
 * account's `uiPreferences.copyPlaceMedia`, which is what the user last chose
 * on Logjam GPS. Sending a value here would silently override a preference this
 * app has no switch for. The response says what actually happened to the media,
 * which is what the caller reports.
 */
export function copyPlace(placeId: string): Promise<CopiedPlace> {
  return apiFetch<CopiedPlace>(`/places/${placeId}/copy`, { method: "POST" });
}

/** The route sibling. A copy is always unlinked — see api/src/routes/routes.ts. */
export function copyRoute(routeId: string): Promise<TRoute> {
  return apiFetch<TRoute>(`/routes/${routeId}/copy`, { method: "POST" });
}

// ── Notifications ─────────────────────────────────────────────

/** `read: false` marks it unread again (the Inbox's ⋯ and its selection bar). */
export function markNotificationRead(id: string, read = true): Promise<void> {
  return apiFetch<void>(`/notifications/${id}/read`, { method: "PATCH", body: { read } });
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
  // True once the first fetch has SETTLED, either way: an empty list before
  // then is not "Nothing yet".
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);
  const [readOverrides, setReadOverrides] = useState<ReadOverrides>(() => new Map());

  useEffect(() => {
    if (!enabled) return;
    // Guards a stale in-flight response landing after a newer one (FECO-001).
    let cancelled = false;
    apiFetchWithTotal<TNotification[]>("/notifications")
      .then(({ data, total }) => {
        if (cancelled) return;
        setNotifications(data);
        setTotal(total);
        setError(null);
        setReadOverrides((prev) => settleReadOverrides(prev, data));
      })
      .catch((err) => { console.error(err); if (!cancelled) setError(messageFromError(err, "Couldn't load notifications.")); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [enabled, fetchCount]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);

  // The badge counts the list the Inbox shows, the way Logjam GPS's tab badge
  // does. `/notifications/unread-count` counts every stored row, including the
  // ones the list drops because their share or friendship is gone, so the rail
  // said 11 over an inbox that said "5 unread". A batch counts once, as its row.
  const shown = useMemo(() => withReadOverrides(notifications, readOverrides), [notifications, readOverrides]);
  const unreadCount = useMemo(() => tallyNotifications(shown).unread, [shown]);

  /** Show `read` for these rows now, ahead of the write; `null` takes it back
   *  (the write failed). */
  const overrideRead = useCallback(
    (ids: string[], read: boolean | null) =>
      setReadOverrides((prev) => {
        const next = new Map(prev);
        for (const id of ids) {
          if (read === null) next.delete(id);
          else next.set(id, read);
        }
        return next;
      }),
    [],
  );

  return { notifications: shown, total, loaded, unreadCount, error, refetch, overrideRead };
}

// ── Filters ───────────────────────────────────────────────────
//
// The predicate itself lives in `shared/src/placeFilter.ts` so the mobile
// Places screen applies the SAME rules; re-exported here under the names the
// web callers have always used.

export {
  passesPlaceFilters as passesFilters,
  isPlaceDoneByViewer,
  activePlaceFilterCount as activeFilterCount,
  hasActivePlaceFilters as hasActiveFilters,
  placeMatchesSearch,
  comparePlaces,
  customFilterKind,
  reconcileCustomFilters,
  EMPTY_PLACE_FILTERS as emptyFilters,
} from "@logjam/shared";
export type {
  PlaceFilters as TFilters,
  PlaceDateRange as TDateRange,
  PlaceCustomFieldFilter as TCustomFieldFilter,
  PlaceSortKey,
} from "@logjam/shared";


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
  // True once the first fetch has settled, either way. `loading` alone starts
  // false, so a list reading it would flash "nothing yet" before any request.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    apiFetchWithTotal<{ jobs: GeoPdfJobView[] }>("/geo-pdf")
      .then(({ data, total }) => { if (!cancelled) { setJobs(data.jobs); setTotal(total); setError(null); } })
      .catch((err) => { console.error(err); if (!cancelled) setError(messageFromError(err, "Couldn't load GeoPDF jobs.")); })
      .finally(() => { if (!cancelled) { setLoading(false); setLoaded(true); } });
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
  return { jobs, total, loading, loaded, error, refetch };
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

// Renders `v3a4 III`, omitting unset segments (UX fix 4). Moved to
// shared/src/canyonGrade.ts so web and mobile format identically; re-exported
// here to keep existing import sites stable.
export { formatCanyonGrade } from "@logjam/shared";
