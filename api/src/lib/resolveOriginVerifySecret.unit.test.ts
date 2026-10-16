import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = sendMock;
  },
  GetSecretValueCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { resolveOriginVerifySecret } from "./resolveOriginVerifySecret";

const ORIGINAL = { ...process.env };

describe("resolveOriginVerifySecret", () => {
  beforeEach(() => {
    sendMock.mockReset();
    delete process.env.ORIGIN_VERIFY_SECRET;
    delete process.env.ORIGIN_VERIFY_SECRET_ID;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("is a no-op when the secret is already set", async () => {
    process.env.ORIGIN_VERIFY_SECRET = "token";
    process.env.ORIGIN_VERIFY_SECRET_ID = "origin-verify";
    await resolveOriginVerifySecret();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("leaves the check inert, without throwing, when no secret id is set", async () => {
    await resolveOriginVerifySecret();
    expect(sendMock).not.toHaveBeenCalled();
    expect(process.env.ORIGIN_VERIFY_SECRET).toBeUndefined();
  });

  it("stores the raw secret string as the token", async () => {
    process.env.ORIGIN_VERIFY_SECRET_ID = "origin-verify";
    sendMock.mockResolvedValueOnce({ SecretString: "raw-token" });
    await resolveOriginVerifySecret();
    expect(process.env.ORIGIN_VERIFY_SECRET).toBe("raw-token");
  });

  it("throws when the id is set but the secret is empty", async () => {
    process.env.ORIGIN_VERIFY_SECRET_ID = "origin-verify";
    sendMock.mockResolvedValueOnce({});
    await expect(resolveOriginVerifySecret()).rejects.toThrow(/SecretString/);
    expect(process.env.ORIGIN_VERIFY_SECRET).toBeUndefined();
  });
});
