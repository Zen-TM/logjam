import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserNotFoundException } from "@aws-sdk/client-cognito-identity-provider";

const send = vi.fn();
const cognitoIdpClient = vi.fn((_region: string) => ({ send }));
vi.mock("../services/awsClients", () => ({
  cognitoIdpClient: (r: string) => cognitoIdpClient(r),
}));
vi.mock("./logger", () => ({
  logger: { warn: vi.fn() },
  safeErrorForLog: (e: unknown) => e,
}));
let issuer: string | undefined;
vi.mock("./env", () => ({ getEnv: () => ({ OIDC_ISSUER: issuer }) }));

import { identityProvider } from "./identityProvider";

const COGNITO = "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_AbCd123";

beforeEach(() => {
  send.mockReset();
  cognitoIdpClient.mockClear();
});

// Mutation: make the Cognito branch swallow UserNotFoundException as true, or
// the catch return false, and the rebind guard is either dead or a takeover hole.
describe("identityProvider — Cognito issuer", () => {
  beforeEach(() => {
    issuer = COGNITO;
  });

  it("asks the pool and region parsed from the issuer", async () => {
    send.mockResolvedValue({});
    expect(await identityProvider().userExists("sub-1")).toBe(true);
    expect(cognitoIdpClient).toHaveBeenCalledWith("eu-west-1");
    expect(send.mock.calls[0][0].input).toEqual({
      UserPoolId: "eu-west-1_AbCd123",
      Username: "sub-1",
    });
  });

  it("is false when Cognito says the user is gone", async () => {
    send.mockRejectedValue(
      new UserNotFoundException({ message: "", $metadata: {} }),
    );
    expect(await identityProvider().userExists("sub-1")).toBe(false);
  });

  it("is true on any other error (fail safe)", async () => {
    send.mockRejectedValue(new Error("AccessDenied"));
    expect(await identityProvider().userExists("sub-1")).toBe(true);
  });

  // Mutation: rethrow UserNotFoundException, or swallow every error.
  it("deletes the user by sub, and treats already-gone as done", async () => {
    send.mockResolvedValue({});
    await identityProvider().deleteUser("sub-1");
    expect(send.mock.calls[0][0].input).toEqual({
      UserPoolId: "eu-west-1_AbCd123",
      Username: "sub-1",
    });
    send.mockRejectedValue(
      new UserNotFoundException({ message: "", $metadata: {} }),
    );
    await expect(
      identityProvider().deleteUser("sub-1"),
    ).resolves.toBeUndefined();
  });

  it("lets any other delete failure through to the caller", async () => {
    send.mockRejectedValue(new Error("AccessDenied"));
    await expect(identityProvider().deleteUser("sub-1")).rejects.toThrow(
      "AccessDenied",
    );
  });
});

describe("identityProvider — any other issuer, or none", () => {
  it.each([undefined, "https://example.auth0.com/", "http://localhost:9000"])(
    "reports every identity as existing (issuer %s)",
    async (i) => {
      issuer = i;
      expect(await identityProvider().userExists("sub-1")).toBe(true);
      expect(cognitoIdpClient).not.toHaveBeenCalled();
    },
  );

  it("deletes nothing", async () => {
    issuer = undefined;
    await expect(
      identityProvider().deleteUser("sub-1"),
    ).resolves.toBeUndefined();
    expect(cognitoIdpClient).not.toHaveBeenCalled();
  });
});
