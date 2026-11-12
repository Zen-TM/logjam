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

import { resolveSmtpPassword } from "./resolveSmtpPassword";

const ORIGINAL = { ...process.env };

describe("resolveSmtpPassword", () => {
  beforeEach(() => {
    sendMock.mockReset();
    delete process.env.SMTP_PASSWORD;
    process.env.RESEND_SECRET_ID = "logjam/resend-api-key";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
    vi.restoreAllMocks();
  });

  it("is a no-op when the password is already set", async () => {
    process.env.SMTP_PASSWORD = "injected";
    await resolveSmtpPassword();
    expect(sendMock).not.toHaveBeenCalled();
    expect(process.env.SMTP_PASSWORD).toBe("injected");
  });

  it("is a no-op when no secret id is configured", async () => {
    delete process.env.RESEND_SECRET_ID;
    await resolveSmtpPassword();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("reads apiKey out of the secret's JSON", async () => {
    sendMock.mockResolvedValue({ SecretString: '{"apiKey":"re_x"}' });
    await resolveSmtpPassword();
    expect(process.env.SMTP_PASSWORD).toBe("re_x");
  });

  // Mutation that turns it red: rethrowing from the catch, which exits boot.
  it.each([
    ["a failed read", () => sendMock.mockRejectedValue(new Error("denied"))],
    ["a secret with no apiKey", () => sendMock.mockResolvedValue({})],
  ])("leaves email off and boot alive on %s", async (_name, arrange) => {
    const consoleError = vi.spyOn(console, "error").mockReturnValue(undefined);
    arrange();
    await expect(resolveSmtpPassword()).resolves.toBeUndefined();
    expect(process.env.SMTP_PASSWORD).toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
