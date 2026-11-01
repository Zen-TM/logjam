// Logjam Web's session: OIDC sign-in (authorization code + PKCE), or the same
// session started from its own forms under a Cognito issuer (ADR 0045). Tokens
// live in localStorage so a session survives a closed tab (ADR 0041); they are
// never logged, and a password is never stored. Fake auth (local dev, e2e)
// never reaches this file.
import {
  ErrorResponse,
  User,
  UserManager,
  WebStorageStateStore,
} from "oidc-client-ts";
import {
  confirmForgotPassword as cognitoConfirmForgotPassword,
  confirmSignUp as cognitoConfirmSignUp,
  endSessionUrl,
  forgotPassword as cognitoForgotPassword,
  hasCognitoAccount as sharedHasCognitoAccount,
  oidcScopes,
  passwordSignIn,
  resendSignUpCode as cognitoResendSignUpCode,
  signUp as cognitoSignUp,
} from "@logjam/shared";

const issuer = (): string => import.meta.env.VITE_OIDC_ISSUER ?? "";
const clientId = (): string => import.meta.env.VITE_OIDC_CLIENT_ID ?? "";

/** The site answers on apex and www, so the origin is read at run time. */
const home = (): string => `${window.location.origin}/`;

/** Change email, delete and sign out everywhere call Cognito directly. */
export function hasCognitoAccount(): boolean {
  return sharedHasCognitoAccount(import.meta.env.VITE_AUTH_MODE, issuer());
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

function jwtClaims(jwt: string): User["profile"] {
  const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Cognito only (hasCognitoAccount): starts the same session the redirect would,
 * so refresh, sign-out and everything else cannot tell them apart. False:
 * Cognito wants more than a password, and the provider's page must ask.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<boolean> {
  const t = await passwordSignIn(issuer(), clientId(), email, password);
  if (!t) return false;
  await userManager().storeUser(
    new User({
      id_token: t.idToken,
      access_token: t.accessToken,
      refresh_token: t.refreshToken,
      token_type: "Bearer",
      scope: "aws.cognito.signin.user.admin",
      profile: jwtClaims(t.idToken),
      expires_at: Math.floor(Date.now() / 1000) + t.expiresIn,
    }),
  );
  return true;
}

export const signUp = (email: string, password: string, name: string) =>
  cognitoSignUp(issuer(), clientId(), { email, password, name });
export const confirmSignUp = (email: string, code: string) =>
  cognitoConfirmSignUp(issuer(), clientId(), email, code);
export const resendSignUpCode = (email: string) =>
  cognitoResendSignUpCode(issuer(), clientId(), email);
export const forgotPassword = (email: string) =>
  cognitoForgotPassword(issuer(), clientId(), email);
export const confirmForgotPassword = (
  email: string,
  code: string,
  password: string,
) => cognitoConfirmForgotPassword(issuer(), clientId(), email, code, password);

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
      // Only a refused grant ends the session: a 500 server_error or 503
      // temporarily_unavailable leaves a good refresh token in place.
      if (err instanceof ErrorResponse && err.error === "invalid_grant") {
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
 * Ends the provider-side session as far as it can from here (revokes the
 * refresh token, forgets the session locally) and returns where the browser
 * should go next: the provider's end-session page, which returns to Logjam Web
 * signed out, or home when the provider has none (or cannot be asked). The
 * caller navigates, after it has finished its own clearing: a navigation
 * already started can abort that.
 */
export async function endProviderSession(): Promise<string> {
  const m = userManager();
  const user = await m.getUser();
  let endpoint: string | undefined;
  try {
    endpoint = (await m.metadataService.getMetadata()).end_session_endpoint;
  } catch (err) {
    console.error(err);
  }
  // /logout only clears the hosted session cookie; revoking is what ends the
  // refresh token (ADR 0041). Best effort: a failure never blocks sign-out.
  try {
    await m.revokeTokens(["refresh_token"]);
  } catch (err) {
    console.error(err);
  }
  await m.removeUser();
  if (!endpoint) return home();
  return endSessionUrl({
    endpoint,
    issuer: issuer(),
    clientId: clientId(),
    postLogoutRedirect: home(),
    idToken: user?.id_token,
  });
}
