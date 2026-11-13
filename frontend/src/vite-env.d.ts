/// <reference types="vite/client" />

declare module "virtual:maplibre-worker-url" {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  /** "fake" skips sign-in entirely; "oidc" is the real thing. */
  readonly VITE_AUTH_MODE?: string;
  /** "1" adds the simulated regions; refused unless VITE_AUTH_MODE is "fake". */
  readonly VITE_SIM_REGIONS?: string;
  readonly VITE_OIDC_ISSUER?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
}
