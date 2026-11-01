// The one place Logjam GPS holds a sign-in: OIDC authorization code + PKCE in
// the system browser sheet, then the tokens in the secure store.
//
// Offline-session rules (ADR 0041, 0006, useAuth.ts header) that this file
// carries:
//
//  - A stored session works with no network: expiry is read from the ID
//    token's `exp`, and the endpoints a refresh needs are stored beside the
//    tokens, so a cold start never asks for discovery.
//  - Only a refresh the provider ANSWERED with HTTP 400 `invalid_grant`, or no
//    session at all, ends the session. A network error, a timeout, a 5xx or a
//    body that does not parse throws something `classifySessionError` calls
//    transient (Guard: oidcSession.test.ts, sessionErrors.test.ts).
//  - Every call that reaches a token endpoint settles within
//    SESSION_TIMEOUT_MS. A connect that neither succeeds nor fails is the field
//    failure this exists for (apiFetch.ts documents it).
//  - Nothing here arms a timer to refresh: callers ask, on demand and on
//    foreground (ADR 0013).
//  - Tokens are written to `secureKeyValueStorage` only, and never logged.
import { AuthRequest, ResponseType } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { endSessionUrl, globalSignOut, oidcScopes } from "@logjam/shared";

import { config } from "../config";
import { isReachableNow } from "../map/connectivity";
import { REFRESH_REJECTED } from "./sessionErrors";
import { secureKeyValueStorage } from "./secureKeyValueStorage";

/** Matches `apiFetch`'s REQUEST_TIMEOUT_MS: same link, same patience. */
export const SESSION_TIMEOUT_MS = 15_000;
/** Ending the provider's session is a courtesy, so it waits less. */
const REVOKE_TIMEOUT_MS = 5_000;
/** A token this close to expiry is refreshed first, so a request in flight does not outlive it. */
const EXPIRY_MARGIN_MS = 60_000;

const SESSION_KEY = "logjam_oidc_session";

export class SessionTimeoutError extends Error {
  constructor() {
    super("Timed out asking the sign-in provider");
    this.name = "SessionTimeoutError";
  }
}

export type Session = { idToken: string; accessToken: string };

/** What is stored: the tokens, and what a refresh and a sign-out need to reach the provider. */
type Stored = Session & {
  refreshToken?: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  endSessionEndpoint?: string;
};

// ── config ───────────────────────────────────────────────────────────────────

/** Throws at startup (index.ts) when a real-auth build has no provider to talk to. */
export function assertOidcConfigured(): void {
  if (config.authMode === "fake") return;
  if (!config.oidcIssuer || !config.oidcClientId) {
    throw new Error(
      "EXPO_PUBLIC_OIDC_ISSUER and EXPO_PUBLIC_OIDC_CLIENT_ID are required when EXPO_PUBLIC_AUTH_MODE is not 'fake'",
    );
  }
}

function provider(): { issuer: string; clientId: string } {
  assertOidcConfigured();
  return { issuer: config.oidcIssuer!, clientId: config.oidcClientId! };
}

/** `logjam://auth`, `logjamdev://auth` for the dev variant: the scheme is app.config.ts's. */
export function redirectUri(): string {
  const scheme = Constants.expoConfig?.scheme;
  const first = Array.isArray(scheme) ? scheme[0] : scheme;
  if (!first) throw new Error("The app config declares no URL scheme");
  return `${first}://auth`;
}

// ── tokens ───────────────────────────────────────────────────────────────────

function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = JSON.parse(
      // atob is available in Hermes; JWT payload is base64url.
      globalThis.atob(
        token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"),
      ),
    ) as unknown;
    return typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Who an ID token is for: the `sub`, and a name to show for them. Null without a `sub`. */
export function identityFromIdToken(
  idToken: string,
): { sub: string; username: string } | null {
  const claims = decodeClaims(idToken);
  if (typeof claims?.sub !== "string" || claims.sub === "") return null;
  const email = typeof claims.email === "string" ? claims.email : null;
  return { sub: claims.sub, username: email ?? claims.sub };
}

function isFresh(idToken: string): boolean {
  const exp = decodeClaims(idToken)?.exp;
  // No readable expiry: refresh rather than trust it.
  return typeof exp === "number" && exp * 1000 - Date.now() > EXPIRY_MARGIN_MS;
}

async function readStored(): Promise<Stored | null> {
  const raw = await secureKeyValueStorage.getItem(SESSION_KEY);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (
      typeof parsed.idToken === "string" &&
      typeof parsed.accessToken === "string" &&
      typeof parsed.tokenEndpoint === "string"
    ) {
      return parsed as Stored;
    }
  } catch {
    // fall through: an unreadable record is no session
  }
  await secureKeyValueStorage.removeItem(SESSION_KEY);
  return null;
}

async function writeStored(stored: Stored): Promise<void> {
  await secureKeyValueStorage.setItem(SESSION_KEY, JSON.stringify(stored));
}

async function clearStored(): Promise<void> {
  await secureKeyValueStorage.removeItem(SESSION_KEY);
}

// ── the provider ─────────────────────────────────────────────────────────────

/** Runs `work` and settles within `ms` however `work` behaves; aborts its request when time is up. */
function within<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SessionTimeoutError());
    }, ms);
  });
  return Promise.race([work(controller.signal), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function postForm(
  endpoint: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form(params),
    signal,
  });
}

type TokenAnswer = {
  id_token: string;
  access_token: string;
  refresh_token?: string;
};

/**
 * One token-endpoint call. Throws the rejection (named `invalid_grant`) only
 * for HTTP 400 `{"error":"invalid_grant"}`; every other failure is an error
 * `classifySessionError` leaves transient.
 */
async function tokenRequest(
  endpoint: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<TokenAnswer> {
  const res = await postForm(endpoint, params, signal);
  let body: Partial<TokenAnswer> & { error?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // not JSON: judged by the status below
  }
  if (res.status === 400 && body.error === REFRESH_REJECTED) {
    const err = new Error(
      "The sign-in provider no longer accepts this session",
    );
    err.name = REFRESH_REJECTED;
    throw err;
  }
  if (!res.ok) throw new Error(`Token endpoint answered ${res.status}`);
  if (
    typeof body.id_token !== "string" ||
    typeof body.access_token !== "string"
  ) {
    throw new Error("Token endpoint answered without tokens");
  }
  return body as TokenAnswer;
}

type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
  scopes_supported?: string[];
};

async function discover(issuer: string, signal: AbortSignal) {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
    signal,
  });
  if (!res.ok) throw new Error(`Discovery answered ${res.status}`);
  const doc = (await res.json()) as Partial<Discovery>;
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error("The sign-in provider's discovery document is incomplete");
  }
  return doc as Discovery;
}

// ── sign in ──────────────────────────────────────────────────────────────────

/**
 * `commit` stores the session. It is not stored here: `finishSignIn` may have
 * to unregister push and wipe the departing user's data under THEIR session
 * first, and that session is the one in the store until `commit` replaces it.
 */
export type BrowserSignIn =
  | ({ type: "success"; commit: () => Promise<void> } & Session)
  | { type: "cancel" };

/**
 * Opens the provider's sign-in and sign-up page in the system browser sheet and
 * returns the session it ends in, to be stored by `commit`. Closing the sheet is `cancel`, which changes
 * nothing; any other failure throws.
 */
export async function signInWithBrowser(): Promise<BrowserSignIn> {
  const { issuer, clientId } = provider();
  const doc = await within(SESSION_TIMEOUT_MS, (s) => discover(issuer, s));
  const request = new AuthRequest({
    clientId,
    redirectUri: redirectUri(),
    scopes: oidcScopes(issuer, doc.scopes_supported).split(" "),
    responseType: ResponseType.Code,
    usePKCE: true,
  });
  const result = await request.promptAsync({
    authorizationEndpoint: doc.authorization_endpoint,
  });
  if (result.type === "error")
    throw result.error ?? new Error("Sign-in failed");
  if (result.type !== "success") return { type: "cancel" };
  const code = result.params.code;
  if (!code) throw new Error("The sign-in provider returned no code");
  const tokens = await within(SESSION_TIMEOUT_MS, (s) =>
    tokenRequest(
      doc.token_endpoint,
      {
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri(),
        code_verifier: request.codeVerifier ?? "",
      },
      s,
    ),
  );
  const next: Stored = {
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenEndpoint: doc.token_endpoint,
    revocationEndpoint: doc.revocation_endpoint,
    endSessionEndpoint: doc.end_session_endpoint,
  };
  return {
    type: "success",
    commit: () => writeStored(next),
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
  };
}

// ── the session ──────────────────────────────────────────────────────────────

let refreshing: Promise<Session | null> | undefined;

function refresh(stored: Stored): Promise<Session | null> {
  if (refreshing) return refreshing;
  const flight = within(SESSION_TIMEOUT_MS, async (signal) => {
    const { clientId } = provider();
    if (!stored.refreshToken) {
      await clearStored();
      return null;
    }
    try {
      const tokens = await tokenRequest(
        stored.tokenEndpoint,
        {
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: stored.refreshToken,
        },
        signal,
      );
      // Signed out (or in again) while the request was out: writing now would
      // bring a signed-out session back.
      const current = await readStored();
      if (current?.refreshToken !== stored.refreshToken) return null;
      const next: Stored = {
        ...stored,
        idToken: tokens.id_token,
        accessToken: tokens.access_token,
        // Cognito sends no new refresh token: the old one stays good.
        refreshToken: tokens.refresh_token ?? stored.refreshToken,
      };
      await writeStored(next);
      return { idToken: next.idToken, accessToken: next.accessToken };
    } catch (err) {
      if ((err as Error).name === REFRESH_REJECTED) {
        // Tokens only: the local identity stays, so the same user signing in
        // again keeps their data. Not a session that replaced this one while
        // the request was out.
        const current = await readStored().catch(() => null);
        if (current?.refreshToken === stored.refreshToken) {
          await clearStored().catch(console.error);
        }
      }
      throw err;
    }
  });
  refreshing = flight;
  const done = () => {
    if (refreshing === flight) refreshing = undefined;
  };
  flight.then(done, done);
  return flight;
}

/**
 * The ID and access tokens, refreshed when the ID token is within a minute of
 * expiring (or `forceRefresh`). Null: no session (never signed in, or the
 * provider rejected the refresh and the tokens are gone). Throws when the
 * refresh could not be tried to its end: the session may still be good. Callers
 * that arrive while a refresh runs share it.
 */
export async function getSession(
  options: { forceRefresh?: boolean } = {},
): Promise<Session | null> {
  const stored = await readStored();
  if (!stored) return null;
  if (!options.forceRefresh && isFresh(stored.idToken)) {
    return { idToken: stored.idToken, accessToken: stored.accessToken };
  }
  return refresh(stored);
}

// ── sign out ─────────────────────────────────────────────────────────────────

/** Forgets the tokens on this phone and hands back what ending the provider's session needs. */
export async function signOutLocally(): Promise<Stored | null> {
  const stored = await readStored().catch(() => null);
  await clearStored();
  return stored;
}

/**
 * Best effort and silent, after `signOutLocally`: revoke the refresh token,
 * then end the provider's browser session so the next sign-in does not offer
 * "Sign in as <previous user>". Offline it does neither, so signing out never
 * needs a connection.
 */
export async function endProviderSession(stored: Stored | null): Promise<void> {
  if (!stored || config.authMode === "fake") return;
  if (!(await isReachableNow().catch(() => false))) return;
  const { issuer, clientId } = provider();
  if (stored.revocationEndpoint && stored.refreshToken) {
    const { revocationEndpoint: endpoint, refreshToken: token } = stored;
    await within(REVOKE_TIMEOUT_MS, (s) =>
      postForm(endpoint, { token, client_id: clientId }, s),
    ).catch(() => undefined);
  }
  if (stored.endSessionEndpoint) {
    const url = endSessionUrl({
      endpoint: stored.endSessionEndpoint,
      issuer,
      clientId,
      postLogoutRedirect: redirectUri(),
      idToken: stored.idToken,
    });
    await WebBrowser.openAuthSessionAsync(url, redirectUri()).catch(
      () => undefined,
    );
  }
}

/**
 * Sign out everywhere, step one: the refresh is forced so a stale access token
 * cannot make step two fail after the user has confirmed. Throws when the
 * phone cannot reach the provider; nothing is cleared (ADR 0041).
 */
export async function assertCanSignOutEverywhere(): Promise<void> {
  if (config.authMode === "fake") return;
  const session = await getSession({ forceRefresh: true });
  if (!session) throw new Error("No session to refresh");
}

/**
 * Sign out everywhere, step two: Cognito's GlobalSignOut ends every refresh
 * token the user holds. Its failure is the caller's to act on; it is not
 * swallowed (the library that did is gone).
 */
export async function signOutEverywhereAtProvider(): Promise<void> {
  if (config.authMode === "fake") return;
  const session = await getSession();
  if (!session) throw new Error("No session to sign out");
  const { issuer } = provider();
  await within(SESSION_TIMEOUT_MS, () =>
    globalSignOut(issuer, session.accessToken),
  );
}
