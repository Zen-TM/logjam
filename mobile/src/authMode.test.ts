import { describe, expect, it } from "vitest";

import { hasCognitoAccount, resolveAuthMode } from "./authMode";

// Mutation that turns this red: drop the LOCAL_HOST check in resolveAuthMode
// (fake auth would then resolve for the prod API URL).
describe("resolveAuthMode", () => {
  it("defaults to oidc, whatever the API", () => {
    expect(resolveAuthMode(undefined, "https://api.logjamnsw.com")).toBe(
      "oidc",
    );
    expect(resolveAuthMode("oidc", "https://api.logjamnsw.com")).toBe("oidc");
  });

  it.each([
    "http://127.0.0.1:8080",
    "http://10.0.2.2:8080",
    "http://localhost:8080",
    "http://192.168.1.20:8080",
    "http://172.20.0.5:8080",
  ])("allows fake auth against %s", (url) => {
    expect(resolveAuthMode("fake", url)).toBe("fake");
  });

  it.each([
    "https://api.logjamnsw.com",
    "http://10.example.com",
    "http://172.32.0.1",
    "http://127.0.0.1.evil.com",
  ])("refuses fake auth against %s", (url) => {
    expect(() => resolveAuthMode("fake", url)).toThrow();
  });

  it("refuses an unknown mode instead of treating it as oidc or fake", () => {
    expect(() => resolveAuthMode("Fake", "http://127.0.0.1")).toThrow();
    expect(() => resolveAuthMode("cognito", "http://127.0.0.1")).toThrow();
  });
});

// Mutation that turns this red: return true for any issuer, or drop the Cognito
// check (another provider would then be shown change email and sign out
// everywhere, which only Cognito can do).
describe("hasCognitoAccount", () => {
  const cognito =
    "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_AbC123";

  it("is true for a Cognito issuer", () => {
    expect(hasCognitoAccount("oidc", cognito)).toBe(true);
  });

  it("is false for any other issuer, or none", () => {
    expect(
      hasCognitoAccount("oidc", "https://id.example.com/realms/logjam"),
    ).toBe(false);
    expect(hasCognitoAccount("oidc", undefined)).toBe(false);
  });

  it("is true under fake auth, so the rows can be tried in local dev", () => {
    expect(hasCognitoAccount("fake", undefined)).toBe(true);
  });
});
