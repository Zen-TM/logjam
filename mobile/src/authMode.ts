import { parseCognitoIssuer } from "@logjam/shared";

// Fake auth sends a fixed token and skips the provider, so it must never be
// baked into a build that talks to a real server (Guard: authMode.test.ts).
// Local dev and the local release-APK loop (scripts/build-local-apk.sh) dial
// loopback, the emulator alias or a LAN address; anything else fails the
// bundle's startup rather than falling back.
const LOCAL_HOST =
  /^(localhost|127(\.\d+){3}|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2})$/;

export function resolveAuthMode(
  mode: string | undefined,
  apiUrl: string,
): "oidc" | "fake" {
  if (mode === undefined || mode === "oidc") return "oidc";
  if (mode !== "fake") {
    throw new Error(`EXPO_PUBLIC_AUTH_MODE must be oidc or fake, got ${mode}`);
  }
  if (!LOCAL_HOST.test(new URL(apiUrl).hostname)) {
    throw new Error("Fake auth is only allowed against a local API");
  }
  return "fake";
}

/**
 * Change email and sign out everywhere call Cognito directly, so they exist
 * only when the issuer is Cognito (Logjam Web's `hasCognitoAccount`). Fake
 * auth counts, so the rows can be exercised in local dev.
 */
export function hasCognitoAccount(
  mode: "oidc" | "fake",
  issuer: string | undefined,
): boolean {
  return mode === "fake" || (!!issuer && parseCognitoIssuer(issuer) !== null);
}
