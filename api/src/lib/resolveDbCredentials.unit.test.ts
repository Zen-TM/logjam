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

import { resolveDbCredentials } from "./resolveDbCredentials";

const ORIGINAL = { ...process.env };

describe("resolveDbCredentials", () => {
  beforeEach(() => {
    sendMock.mockReset();
    delete process.env.DB_PASSWORD;
    delete process.env.DB_USER;
    delete process.env.DB_SECRET_ID;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("is a no-op when DB_PASSWORD is already set (ECS injection / local dev)", async () => {
    process.env.DB_PASSWORD = "static-pw";
    await resolveDbCredentials();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("throws when neither DB_PASSWORD nor DB_SECRET_ID is set", async () => {
    await expect(resolveDbCredentials()).rejects.toThrow(
      /neither DB_PASSWORD nor DB_SECRET_ID/,
    );
  });

  it("populates DB_USER/DB_PASSWORD from the secret when DB_SECRET_ID is set", async () => {
    process.env.DB_SECRET_ID = "rds!db-test";
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ username: "u", password: "p" }),
    });
    await resolveDbCredentials();
    expect(process.env.DB_USER).toBe("u");
    expect(process.env.DB_PASSWORD).toBe("p");
  });

  it("throws when the secret JSON is missing username or password", async () => {
    process.env.DB_SECRET_ID = "rds!db-test";
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ username: "only" }),
    });
    await expect(resolveDbCredentials()).rejects.toThrow(
      /missing username or password/,
    );
  });
});
