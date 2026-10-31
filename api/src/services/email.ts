import nodemailer from "nodemailer";
import { SMTP_ENV_KEYS } from "@logjam/shared";
import { getEnv } from "../lib/env";
import { logger } from "../lib/logger";

const IMPLICIT_TLS_PORT = 465;
const TIMEOUT_MS = 30_000;

/**
 * Send one transactional email over SMTP. Best-effort: callers create the
 * in-app notification first, so a send failure is logged and swallowed, never
 * thrown.
 *
 * No-op (logged) when any of SMTP_ENV_KEYS is unset — keeps an unconfigured
 * process quiet instead of failing.
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const env = getEnv();
  if (SMTP_ENV_KEYS.some((key) => !env[key])) {
    logger.info("email_skipped_no_smtp_config");
    return;
  }
  try {
    const port = Number(env.SMTP_PORT);
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      // Any port but 465 starts in the clear, so requireTLS is what refuses a
      // server that won't upgrade. Guard: email.unit.test.ts.
      secure: port === IMPLICIT_TLS_PORT,
      requireTLS: true,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      tls: {
        ca: env.SMTP_CA_CERT
          ? Buffer.from(env.SMTP_CA_CERT, "base64").toString()
          : undefined,
      },
      connectionTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    await transport.sendMail({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
  } catch (err) {
    // Never err.message: a rejected send quotes the recipient
    // (email.unit.test.ts). errCode is nodemailer's constant, such as EAUTH.
    logger.warn(
      {
        errClass: err instanceof Error ? err.constructor.name : typeof err,
        errCode: (err as { code?: string }).code,
      },
      "email_send_failed",
    );
  }
}
