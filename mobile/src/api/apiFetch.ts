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
import { fetchAuthSession } from "aws-amplify/auth";
import { ApiError } from "@logjam/shared";

import { config, CLIENT_VERSION, CLIENT_VERSION_HEADER } from "../config";
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
  // (1 h) has expired.
  try {
    const session = await fetchAuthSession();
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

export async function apiFetch<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const token = await getIdToken();
  const method = options?.method ?? "GET";
  const res = await fetch(`${config.apiUrl}${path}`, {
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
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Like apiFetch but also surfaces the X-Total-Count header (true owner-
// filtered total before the server's list cap) for "Showing N of TOTAL"
// captions. Mirrors the web apiFetchWithTotal.
export async function apiFetchWithTotal<T>(
  path: string,
): Promise<{ data: T; total: number | null }> {
  const token = await getIdToken();
  const res = await fetch(`${config.apiUrl}${path}`, {
    headers: baseHeaders(token),
  });
  if (!res.ok) await throwApiError(res, path, "GET");
  const header = res.headers.get("X-Total-Count");
  const parsed = header == null ? NaN : Number(header);
  const total = Number.isFinite(parsed) ? parsed : null;
  const data = (await res.json()) as T;
  return { data, total };
}
