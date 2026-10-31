import { describe, it, expect } from "vitest";
import { parseCognitoIssuer } from "./cognitoIssuer.js";

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
