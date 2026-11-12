import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { SMTP_ENV_KEYS } from "@logjam/shared";
import nodemailer from "nodemailer";
import { SMTPServer, type SMTPServerOptions } from "smtp-server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env: Record<string, string | undefined> = {};
vi.mock("../lib/env", () => ({ getEnv: () => env }));
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn } }));

import { sendEmail } from "./email";

const certs = join(import.meta.dirname, "../../../infra/mailpit");
const cert = readFileSync(join(certs, "dev-tls-cert.pem"));
const key = readFileSync(join(certs, "dev-tls-key.pem"));
const msg = { to: "u@example.com", subject: "S", text: "T", html: "<p>T</p>" };

let server: SMTPServer | undefined;
let received: string[];
let logins: { username?: string; password?: string; secure: boolean }[];

// An SMTP server on a free port, with the env pointing at it.
async function listen(options: SMTPServerOptions = {}): Promise<void> {
  const smtp = new SMTPServer({
    cert,
    key,
    authOptional: true,
    allowInsecureAuth: true,
    onAuth(auth, session, callback) {
      logins.push({
        username: auth.username,
        password: auth.password,
        secure: session.secure,
      });
      callback(null, { user: auth.username });
    },
    onData(stream, _session, callback) {
      let data = "";
      stream.on("data", (chunk) => (data += chunk));
      stream.on("end", () => {
        received.push(data);
        callback();
      });
    },
    logger: false,
    ...options,
  });
  server = smtp;
  await new Promise<void>((resolve) =>
    smtp.listen(0, "127.0.0.1", () => resolve()),
  );
  env.SMTP_PORT = String((smtp.server.address() as AddressInfo).port);
}

beforeEach(() => {
  received = [];
  logins = [];
  warn.mockClear();
  Object.assign(env, {
    SMTP_HOST: "localhost",
    SMTP_PORT: "587",
    SMTP_USER: "resend",
    SMTP_PASSWORD: "re_x",
    EMAIL_FROM: "noreply@example.com",
    SMTP_CA_CERT: cert.toString("base64"),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve(),
  );
  server = undefined;
});

describe("sendEmail", () => {
  it.each(SMTP_ENV_KEYS)("no-ops when %s is unset", async (name) => {
    const create = vi.spyOn(nodemailer, "createTransport");
    env[name] = undefined;
    await sendEmail(msg);
    expect(create).not.toHaveBeenCalled();
  });

  it("delivers over STARTTLS with the configured sender and login", async () => {
    await listen();
    await sendEmail({ ...msg, subject: "Topo map ready — Logjam" });
    expect(warn).not.toHaveBeenCalled();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatch(/^To: u@example\.com/m);
    expect(received[0]).toMatch(/^From: noreply@example\.com/m);
    // The em dash travels as an RFC 2047 encoded word.
    expect(received[0]).toMatch(/^Subject: =\?UTF-8\?/im);
    expect(logins).toEqual([
      { username: "resend", password: "re_x", secure: true },
    ]);
  });

  // Mutation that turns it red: `requireTLS: false`. The message then goes out
  // in the clear, with the password before it.
  it("refuses a server that offers no TLS, sending nothing", async () => {
    await listen({ disabledCommands: ["STARTTLS"] });
    await sendEmail(msg);
    expect(received).toEqual([]);
    expect(logins).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ errCode: "ETLS" }),
      "email_send_failed",
    );
  });

  // Mutation that turns it red: `rejectUnauthorized: false` in `tls`.
  it("refuses a certificate no trusted CA signed", async () => {
    await listen();
    env.SMTP_CA_CERT = undefined;
    await sendEmail(msg);
    expect(received).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("uses implicit TLS on 465 and STARTTLS on 587", async () => {
    const create = vi.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail: vi.fn().mockResolvedValue(undefined),
    } as never);
    await sendEmail(msg);
    env.SMTP_PORT = "465";
    await sendEmail(msg);
    expect(create.mock.calls.map(([options]) => options)).toEqual([
      expect.objectContaining({ port: 587, secure: false, requireTLS: true }),
      expect.objectContaining({ port: 465, secure: true }),
    ]);
  });

  // Mutation that turns it red: logging err.message, which quotes the server's
  // refusal of the recipient.
  it("logs a failure with no recipient, swallowing it", async () => {
    await listen({
      onRcptTo: (_address, _session, callback) =>
        callback(new Error("no such mailbox u@example.com")),
    });
    await expect(sendEmail(msg)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("u@example.com");
  });
});
