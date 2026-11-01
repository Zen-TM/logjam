import { describe, it, expect } from "vitest";
import { oidcScopes, endSessionUrl } from "./oidc.js";

const COGNITO =
  "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_x5zPhJXMk";
const KEYCLOAK = "https://id.example.com/realms/logjam";

describe("oidcScopes", () => {
  // Mutation: add the Cognito scope for every issuer and the second goes red.
  it("adds the Cognito scope only for a Cognito issuer", () => {
    expect(oidcScopes(COGNITO)).toBe(
      "openid email profile aws.cognito.signin.user.admin",
    );
    expect(oidcScopes(KEYCLOAK)).toBe("openid email profile");
  });

  // Mutation: always add offline_access and the Cognito cases go red.
  it("adds offline_access only when the provider lists it", () => {
    expect(oidcScopes(COGNITO, ["openid", "email"])).not.toContain(
      "offline_access",
    );
    expect(oidcScopes(KEYCLOAK, ["openid", "offline_access"])).toBe(
      "openid email profile offline_access",
    );
  });
});

describe("endSessionUrl", () => {
  const base = {
    clientId: "cid",
    postLogoutRedirect: "https://logjamnsw.com/",
    idToken: "tok",
  };

  // Mutation: send the OIDC form to Cognito and logout never returns.
  it("uses client_id and logout_uri for Cognito", () => {
    const u = new URL(
      endSessionUrl({
        ...base,
        endpoint: "https://auth.example.com/logout",
        issuer: COGNITO,
      }),
    );
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("logout_uri")).toBe("https://logjamnsw.com/");
    expect(u.searchParams.has("id_token_hint")).toBe(false);
    expect(u.searchParams.has("post_logout_redirect_uri")).toBe(false);
  });

  it("uses the OIDC form elsewhere", () => {
    const u = new URL(
      endSessionUrl({
        ...base,
        endpoint: "https://id.example.com/realms/logjam/logout",
        issuer: KEYCLOAK,
      }),
    );
    expect(u.searchParams.get("id_token_hint")).toBe("tok");
    expect(u.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://logjamnsw.com/",
    );
    expect(u.searchParams.has("logout_uri")).toBe(false);
  });
});
