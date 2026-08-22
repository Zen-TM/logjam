// Runtime config, read from EXPO_PUBLIC_* env at build time (parallels the web
// VITE_* split: dev vs prod parity via separate env files / EAS profiles).
// Non-secret values only — Cognito pool/client IDs are public by design; no
// secrets belong here.

function required(name: string, value: string | undefined): string {
  if (!value) {
    // Fail loudly — a missing API URL must not silently fall back.
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export const config = {
  apiUrl: required("EXPO_PUBLIC_API_URL", process.env.EXPO_PUBLIC_API_URL),
  authMode: process.env.EXPO_PUBLIC_AUTH_MODE ?? "cognito",
  // Which seeded user a fake-auth dev build acts as ("fake-bob-sub").
  // Unset = alice, the historical default. Ignored outside fake auth.
  fakeSub: process.env.EXPO_PUBLIC_FAKE_SUB ?? null,
  cognitoUserPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID,
  cognitoClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID,
  // CDN serving master topo tiles + (future) Protomaps basemap/glyphs —
  // parallels the web TOPO_CDN_BASE_URL.
  topoCdnBaseUrl:
    process.env.EXPO_PUBLIC_TOPO_CDN_BASE_URL ?? "https://logjamnsw.com",
} as const;

// Client-version discipline (Stage 0): every API request carries this header so
// the server can enforce a min-supported-version / forced-upgrade lever before
// any stale build ships. Keep in sync with package.json version.
export const CLIENT_VERSION_HEADER = "x-logjam-client";
export const CLIENT_SEMVER = "0.1.0";
export const CLIENT_VERSION = `mobile/${CLIENT_SEMVER}`;
