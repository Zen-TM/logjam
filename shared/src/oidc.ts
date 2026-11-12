import { parseCognitoIssuer } from "./cognitoIssuer.js";

/** Cognito's own scope for its account calls (change email, global sign-out). */
export const COGNITO_ADMIN_SCOPE = "aws.cognito.signin.user.admin";

/**
 * The scopes a client asks for. `offline_access` only when the provider lists
 * it (Keycloak needs it for a refresh token; Cognito neither lists nor needs
 * it), the Cognito scope only for a Cognito issuer, which is the only one that
 * knows it.
 */
export function oidcScopes(
  issuer: string,
  scopesSupported?: readonly string[],
): string {
  const scopes = ["openid", "email", "profile"];
  if (parseCognitoIssuer(issuer)) scopes.push(COGNITO_ADMIN_SCOPE);
  if (scopesSupported?.includes("offline_access"))
    scopes.push("offline_access");
  return scopes.join(" ");
}

/**
 * Where to send the browser to end the provider's session. Cognito ignores
 * OIDC's `post_logout_redirect_uri` and `id_token_hint` and redirects only for
 * `client_id` + `logout_uri`.
 */
export function endSessionUrl(args: {
  endpoint: string;
  issuer: string;
  clientId: string;
  postLogoutRedirect: string;
  idToken?: string;
}): string {
  const url = new URL(args.endpoint);
  if (parseCognitoIssuer(args.issuer)) {
    url.searchParams.set("client_id", args.clientId);
    url.searchParams.set("logout_uri", args.postLogoutRedirect);
  } else {
    if (args.idToken) url.searchParams.set("id_token_hint", args.idToken);
    url.searchParams.set("post_logout_redirect_uri", args.postLogoutRedirect);
    url.searchParams.set("client_id", args.clientId);
  }
  return url.toString();
}
