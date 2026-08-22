// Authenticated API client — port of the web apiFetch (frontend/src/
// canyonUtils.ts) with mobile offline-session semantics.
//
// Differences from web, both deliberate (MOBILE_APP_PLAN Stage 1):
//  - Every request carries the x-logjam-client version header (forced-upgrade
//    lever — never drop it).
//  - No auto-sign-out on token trouble. The web flips to the sign-in screen on
//    any 401/refresh failure; here that would brick the app mid-trip. The
//    session-rejected handler fires ONLY when Cognito actively rejects the
//    refresh while online (classifySessionError), never on network failure.
import { ApiError } from "@logjam/shared";

import { config, CLIENT_VERSION, CLIENT_VERSION_HEADER } from "../config";
import { fetchAuthSessionWithTimeout } from "../auth/authSession";
import { classifySessionError } from "../auth/sessionErrors";

// useAuth registers a handler so the UI can drop to the sign-in screen (with
// an explanatory banner) when the refresh token is actively rejected —
// revoked, expired-and-online, disabled, or password changed.
let sessionRejectedHandler: (() => void) | null = null;
export function setSessionRejectedHandler(handler: (() => void) | null): void {
  sessionRejectedHandler = handler;
}
function notifySessionRejected(): void {
  if (sessionRejectedHandler) sessionRejectedHandler();
}

async function getIdToken(): Promise<string> {
  if (config.authMode === "fake") return "fake-token";
  // Amplify refreshes automatically via the refresh token when the ID token
  // (1 h) has expired. Timed out (authSession.ts) rather than bare: this runs
  // BEFORE fetchWithTimeout below, so a hang here hangs the request no matter
  // what REQUEST_TIMEOUT_MS says.
  try {
    const session = await fetchAuthSessionWithTimeout();
    const token = session.tokens?.idToken?.toString();
    if (!token) {
      // No token and no throw: no session exists at all (signed out).
      notifySessionRejected();
      throw new Error("No auth session");
    }
    return token;
  } catch (err) {
    if (classifySessionError(err) === "rejected") notifySessionRejected();
    // Transient (offline, flaky network): surface the error to the caller —
    // the request fails, the session survives.
    throw err;
  }
}

function baseHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    [CLIENT_VERSION_HEADER]: CLIENT_VERSION,
    // DEV ONLY, and only in fake-auth builds: act as a specific seeded user.
    // Without it every fake-auth client is alice, which makes anything with a
    // second person in it — sharing, sending a copy, a friend request —
    // untestable on real devices.
    //
    // Safe by construction rather than by discipline: `config.authMode` is
    // "fake" only in a dev build, and the API's matching `x-fake-sub` handling
    // lives INSIDE its own fake-auth branch, which throws at module load when
    // NODE_ENV=production (api/src/middleware/auth.ts). A production build
    // sends this header to a server that has no code to read it.
    ...(config.authMode === "fake" && config.fakeSub
      ? { "x-fake-sub": config.fakeSub }
      : {}),
  };
}

/**
 * Auth + client-version headers for non-JSON transports (file downloads via
 * expo-file-system) that can't go through apiFetch. Same token path, same
 * offline-session semantics.
 */
export async function getAuthedRequestHeaders(): Promise<Record<string, string>> {
  return baseHeaders(await getIdToken());
}

// A request that can hang forever hangs the UI that awaits it: observed on
// hardware (Pixel 9, airplane mode) where a connect() neither succeeds nor
// fails, leaving the app shell on its loading spinner indefinitely. Offline
// must fail fast so screens fall through to their offline paths.
const REQUEST_TIMEOUT_MS = 15_000;

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

async function throwApiError(res: Response, path: string, method: string): Promise<never> {
  let serverMessage: string | undefined;
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    if (typeof body?.error === "string") serverMessage = body.error;
  } catch {
    // non-JSON body — ignore
  }
  throw new ApiError(res.status, path, method, serverMessage);
}

// ── the user record, cached for a minute ─────────────────────────────────────
//
// Eight screens fetch `/users/me` on mount with nothing between them and no
// cache of any kind, so opening five canyons was five identical round-trips —
// each one a radio wakeup, an Amplify token check and a 15 s timeout's worth of
// hang when there is no signal. The record only changes through a PATCH from
// this device (which lands its own response in the cache below) or from another
// device (a minute late is fine for a username and a theme).
//
// It lives HERE, not beside `fetchCurrentUser`, because six modules PATCH this
// path: an invalidation each caller has to remember is one a caller forgets.
const CURRENT_USER_PATH = "/users/me";
const CURRENT_USER_TTL_MS = 60_000;
let currentUser: { value: unknown; atMs: number } | null = null;

/** Drop the cached user record. Called from `wipeAllLocalData`, which is the
 *  one path both sign-out and a DIFFERENT user signing in go through — the next
 *  person to use this phone must not read the last one's name out of memory. */
export function invalidateCurrentUser(): void {
  currentUser = null;
}

export async function apiFetch<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const method = options?.method ?? "GET";
  const cacheable = path === CURRENT_USER_PATH;
  if (
    cacheable &&
    method === "GET" &&
    currentUser !== null &&
    Date.now() - currentUser.atMs < CURRENT_USER_TTL_MS
  ) {
    return currentUser.value as T;
  }
  const token = await getIdToken();
  const res = await fetchWithTimeout(`${config.apiUrl}${path}`, {
    method,
    headers: {
      ...baseHeaders(token),
      ...(options?.body != null && { "Content-Type": "application/json" }),
    },
    ...(options?.body != null && { body: JSON.stringify(options.body) }),
  });
  if (!res.ok) {
    // Unlike web: a 401 does NOT flip the session. A stale-but-refreshable
    // token self-heals on the next getIdToken; an actively-rejected refresh
    // already fired the handler above.
    await throwApiError(res, path, method);
  }
  if (res.status === 204) {
    if (cacheable) invalidateCurrentUser();
    return undefined as T;
  }
  const value = (await res.json()) as T;
  if (cacheable) {
    // A PATCH answers with the updated record, so the write refreshes the cache
    // instead of merely dropping it. Anything else (a DELETE with a body, a
    // future verb) drops it — the safe direction.
    if (method === "GET" || method === "PATCH") {
      currentUser = { value, atMs: Date.now() };
    } else {
      invalidateCurrentUser();
    }
  }
  return value;
}

// Like apiFetch but also surfaces the X-Total-Count header (true owner-
// filtered total before the server's list cap) for "Showing N of TOTAL"
// captions. Mirrors the web apiFetchWithTotal.
export async function apiFetchWithTotal<T>(
  path: string,
): Promise<{ data: T; total: number | null }> {
  const token = await getIdToken();
  const res = await fetchWithTimeout(`${config.apiUrl}${path}`, {
    headers: baseHeaders(token),
  });
  if (!res.ok) await throwApiError(res, path, "GET");
  const header = res.headers.get("X-Total-Count");
  const parsed = header == null ? NaN : Number(header);
  const total = Number.isFinite(parsed) ? parsed : null;
  const data = (await res.json()) as T;
  return { data, total };
}
