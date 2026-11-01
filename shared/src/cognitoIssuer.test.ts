import { describe, it, expect } from "vitest";
import { hasCognitoAccount, parseCognitoIssuer } from "./cognitoIssuer.js";

describe("parseCognitoIssuer", () => {
  it("reads region and pool id from a Cognito issuer", () => {
    expect(
      parseCognitoIssuer(
        "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_x5zPhJXMk",
      ),
    ).toEqual({ region: "ap-southeast-2", poolId: "ap-southeast-2_x5zPhJXMk" });
  });

  it("is null for other issuers, a trailing slash, plain http or a lookalike host", () => {
    for (const issuer of [
      "https://accounts.google.com",
      "https://example.auth0.com/",
      "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_x5zPhJXMk/",
      "http://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_x5zPhJXMk",
      "https://cognito-idp.ap-southeast-2.amazonaws.com.evil.example/ap-southeast-2_x5zPhJXMk",
      "",
    ]) {
      expect(parseCognitoIssuer(issuer)).toBeNull();
    }
  });
});

// Mutation: drop the issuer check (another provider would be offered change
// email and sign out everywhere, which only Cognito can do), or the fake case.
describe("hasCognitoAccount", () => {
  const cognito =
    "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_AbC123";

  it("is true for a Cognito issuer", () => {
    expect(hasCognitoAccount("oidc", cognito)).toBe(true);
    expect(hasCognitoAccount(undefined, cognito)).toBe(true);
  });

  it("is false for any other issuer, or none", () => {
    expect(
      hasCognitoAccount("oidc", "https://id.example.com/realms/logjam"),
    ).toBe(false);
    expect(hasCognitoAccount("oidc", undefined)).toBe(false);
    expect(hasCognitoAccount("oidc", "")).toBe(false);
  });

  it("is true under fake auth, so the rows can be tried in local dev", () => {
    expect(hasCognitoAccount("fake", undefined)).toBe(true);
  });
});
