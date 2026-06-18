import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  // `function` (not arrow) so `new Resend(key)` returns this object.
  Resend: vi.fn(function () {
    return { emails: { send: sendMock } };
  }),
}));

// Mutable env the helper reads via getEnv() at call time.
const env: { RESEND_API_KEY?: string; EMAIL_FROM?: string } = {};
vi.mock("../lib/env", () => ({ getEnv: () => env }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { Resend } from "resend";
import { sendEmail } from "./email";

const ResendCtor = Resend as unknown as Mock;
const msg = { to: "u@example.com", subject: "S", text: "T", html: "<p>T</p>" };

beforeEach(() => {
  sendMock.mockReset();
  ResendCtor.mockClear();
  env.RESEND_API_KEY = undefined;
  env.EMAIL_FROM = undefined;
});

describe("sendEmail", () => {
  it("no-ops when RESEND_API_KEY is unset", async () => {
    env.EMAIL_FROM = "noreply@x";
    await sendEmail(msg);
    expect(ResendCtor).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("no-ops when EMAIL_FROM is unset", async () => {
    env.RESEND_API_KEY = "re_x";
    await sendEmail(msg);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends with from/to/subject/body when fully configured", async () => {
    env.RESEND_API_KEY = "re_x";
    env.EMAIL_FROM = "noreply@x";
    await sendEmail(msg);
    expect(ResendCtor).toHaveBeenCalledWith("re_x");
    expect(sendMock).toHaveBeenCalledWith({
      from: "noreply@x",
      to: "u@example.com",
      subject: "S",
      text: "T",
      html: "<p>T</p>",
    });
  });

  it("swallows send failures (best-effort, never throws)", async () => {
    env.RESEND_API_KEY = "re_x";
    env.EMAIL_FROM = "noreply@x";
    sendMock.mockRejectedValue(new Error("boom"));
    await expect(sendEmail(msg)).resolves.toBeUndefined();
  });
});
