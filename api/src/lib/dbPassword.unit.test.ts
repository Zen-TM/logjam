import { describe, it, expect, beforeEach, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = sendMock;
  },
  GetSecretValueCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { currentDbPassword, resetDbPasswordCache } from "./dbPassword";

describe("currentDbPassword", () => {
  beforeEach(() => {
    resetDbPasswordCache();
    sendMock.mockReset();
    delete process.env.DB_SECRET_ID;
    process.env.DB_PASSWORD = "static-pw";
  });

  it("returns the static DB_PASSWORD when DB_SECRET_ID is unset", async () => {
    await expect(currentDbPassword()).resolves.toBe("static-pw");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("throws when neither DB_SECRET_ID nor DB_PASSWORD is set", async () => {
    delete process.env.DB_PASSWORD;
    await expect(currentDbPassword()).rejects.toThrow(/DB_SECRET_ID nor DB_PASSWORD/);
  });

  it("fetches the password from Secrets Manager when DB_SECRET_ID is set", async () => {
    process.env.DB_SECRET_ID = "rds!db-test";
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ username: "u", password: "rotated-pw" }),
    });
    await expect(currentDbPassword()).resolves.toBe("rotated-pw");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("serves from cache within the TTL without re-fetching", async () => {
    process.env.DB_SECRET_ID = "rds!db-test";
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ password: "pw1" }),
    });
    await currentDbPassword();
    await expect(currentDbPassword()).resolves.toBe("pw1");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the cached password when a refresh fails", async () => {
    process.env.DB_SECRET_ID = "rds!db-test";
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ password: "pw1" }),
    });
    await currentDbPassword();

    // Expire the cache, then make the next fetch blow up.
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(6 * 60 * 1000);
      sendMock.mockRejectedValueOnce(new Error("SM down"));
      await expect(currentDbPassword()).resolves.toBe("pw1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when the secret JSON has no password field", async () => {
    process.env.DB_SECRET_ID = "rds!db-test";
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ username: "only" }),
    });
    await expect(currentDbPassword()).rejects.toThrow(/missing the password/);
  });
});
