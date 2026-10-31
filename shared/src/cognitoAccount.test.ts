import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmEmailChange,
  deleteCognitoUser,
  globalSignOut,
  requestEmailChange,
} from "./cognitoAccount.js";
import { mapAuthError } from "./apiErrors.js";

const ISSUER =
  "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_x5zPhJXMk";

function stubFetch(res: { ok: boolean; status?: number; json?: unknown }) {
  const f = vi.fn(async () => ({
    ok: res.ok,
    status: res.status ?? 200,
    json: async () => res.json,
  }));
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe("cognitoAccount", () => {
  it("posts the operation to the issuer's region with the access token", async () => {
    const f = stubFetch({ ok: true });
    await requestEmailChange(ISSUER, "AT", "a@b.co");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cognito-idp.ap-southeast-2.amazonaws.com/");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.UpdateUserAttributes",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      AccessToken: "AT",
      UserAttributes: [{ Name: "email", Value: "a@b.co" }],
    });
  });

  it("sends the code, the sign-out and the delete as their own operations", async () => {
    const f = stubFetch({ ok: true });
    await confirmEmailChange(ISSUER, "AT", "123456");
    await globalSignOut(ISSUER, "AT");
    await deleteCognitoUser(ISSUER, "AT");
    const targets = f.mock.calls.map(
      (c) =>
        (
          (c as unknown as [string, RequestInit])[1].headers as Record<
            string,
            string
          >
        )["X-Amz-Target"],
    );
    expect(targets).toEqual([
      "AWSCognitoIdentityProviderService.VerifyUserAttribute",
      "AWSCognitoIdentityProviderService.GlobalSignOut",
      "AWSCognitoIdentityProviderService.DeleteUser",
    ]);
  });

  // Mutation: name the error from the whole __type, or drop it, and the
  // message users saw with Amplify (mapAuthError) turns generic.
  it("throws an error named for the last segment of __type, so the auth error map reads it", async () => {
    stubFetch({
      ok: false,
      status: 400,
      json: {
        __type:
          "com.amazonaws.cognito.identity.idp.model#CodeMismatchException",
        message: "Invalid code",
      },
    });
    const err = await confirmEmailChange(ISSUER, "AT", "1").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CodeMismatchException");
    expect(mapAuthError(err)).toMatch(/Incorrect verification code/);
  });

  it("throws on a non-JSON failure rather than succeeding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("not json");
        },
      })),
    );
    await expect(globalSignOut(ISSUER, "AT")).rejects.toThrow(/502/);
  });

  it("refuses an issuer that is not Cognito, before any request", async () => {
    const f = stubFetch({ ok: true });
    await expect(
      globalSignOut("https://id.example.com/realms/x", "AT"),
    ).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
