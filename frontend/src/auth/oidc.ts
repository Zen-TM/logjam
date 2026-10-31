// The one OIDC sign-in (authorization code + PKCE) for Logjam Web. Tokens live
// in localStorage so a session survives a closed tab (ADR 0041); they are never
// logged. Fake auth (local dev, e2e) never reaches this file.
import {
  ErrorResponse,
  UserManager,
  WebStorageStateStore,
  type User,
} from "oidc-client-ts";
import { endSessionUrl, oidcScopes, parseCognitoIssuer } from "@logjam/shared";

const issuer = (): string => import.meta.env.VITE_OIDC_ISSUER ?? "";
const clientId = (): string => import.meta.env.VITE_OIDC_CLIENT_ID ?? "";

/** The site answers on apex and www, so the origin is read at run time. */
const home = (): string => `${window.location.origin}/`;

/** Change email, delete and sign out everywhere call Cognito directly. */
export function hasCognitoAccount(): boolean {
  return (
    import.meta.env.VITE_AUTH_MODE === "fake" ||
    parseCognitoIssuer(issuer()) !== null
  );
}

let manager: UserManager | undefined;
export function userManager(): UserManager {
  manager ??= new UserManager({
    authority: issuer(),
    client_id: clientId(),
    redirect_uri: home(),
    post_logout_redirect_uri: home(),
    response_type: "code",
    scope: "openid",
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: false,
  });
  return manager;
}

/** Sends the browser to the provider's sign-in and sign-up page. */
export async function signInRedirect(): Promise<void> {
  const m = userManager();
  const meta = await m.metadataService.getMetadata();
  await m.signinRedirect({
    scope: oidcScopes(issuer(), meta.scopes_supported),
  });
}

const CALLBACK_PARAMS = [
  "code",
  "state",
  "error",
  "error_description",
  "error_uri",
  "session_state",
  "iss",
];

let callback: Promise<User | null> | undefined;
/**
 * Finishes a sign-in when the address carries the provider's answer, and takes
 * it out of the address bar. Null when it carries none. Runs once, however
 * many times it is asked (StrictMode mounts effects twice).
 */
export function completeSignInFromUrl(): Promise<User | null> {
  callback ??= (async () => {
    const url = new URL(window.location.href);
    const q = url.searchParams;
    if (!((q.has("code") && q.has("state")) || q.has("error"))) return null;
    const answer = url.href;
    for (const p of CALLBACK_PARAMS) q.delete(p);
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    return (await userManager().signinCallback(answer)) ?? null;
  })();
  return callback;
}

let inflight: Promise<User | null> | undefined;
/**
 * The signed-in user with an unexpired token, refreshing with the refresh
 * token when needed. Null: no session, or the provider refused the refresh (the
 * stored session is then removed). Throws when the refresh could not be tried
 * to its end (offline, a 5xx): the session may still be good. Callers that
 * arrive while a refresh runs share it.
 */
export function loadSession(force = false): Promise<User | null> {
  if (inflight && !force) return inflight;
  const run = (async () => {
    const m = userManager();
    const user = await m.getUser();
    if (!user) return null;
    if (!force && user.id_token && (user.expires_in ?? 0) > 30) return user;
    if (!user.refresh_token) {
      await m.removeUser();
      return null;
    }
    try {
      // The library keeps the old refresh token: Cognito sends no new one.
      return await m.signinSilent();
    } catch (err) {
      if (err instanceof ErrorResponse) {
        await m.removeUser();
        return null;
      }
      throw err;
    }
  })();
  inflight = run;
  const clear = () => {
    if (inflight === run) inflight = undefined;
  };
  run.then(clear, clear);
  return run;
}

export async function accessToken(): Promise<string> {
  const user = await loadSession();
  if (!user) throw new Error("No auth session");
  return user.access_token;
}

export const issuerUrl = issuer;

/**
 * Forgets the session here and sends the browser to the provider's end-session
 * page, which returns to Logjam Web signed out. A provider without one (or
 * unreachable) just reloads: the local session is already gone.
 */
export async function signOutRedirect(): Promise<void> {
  const m = userManager();
  const user = await m.getUser();
  let endpoint: string | undefined;
  try {
    endpoint = (await m.metadataService.getMetadata()).end_session_endpoint;
  } catch (err) {
    console.error(err);
  }
  await m.removeUser();
  if (!endpoint) {
    window.location.assign(home());
    return;
  }
  window.location.assign(
    endSessionUrl({
      endpoint,
      issuer: issuer(),
      clientId: clientId(),
      postLogoutRedirect: home(),
      idToken: user?.id_token,
    }),
  );
}
