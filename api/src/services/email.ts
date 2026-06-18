import { Resend } from "resend";
import { getEnv } from "../lib/env";
import { logger } from "../lib/logger";

/**
 * Send one transactional email via Resend. Best-effort: callers create the
 * in-app notification first, so a send failure is logged and swallowed, never
 * thrown.
 *
 * No-op (logged) when RESEND_API_KEY or EMAIL_FROM is unset — keeps local dev
 * and any unconfigured worker quiet instead of failing. This replaces the
 * former AWS SES path (SES production access was denied; Resend needs only DNS
 * domain verification).
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM } = getEnv();
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    logger.info("email_skipped_no_resend_config");
    return;
  }
  try {
    const resend = new Resend(RESEND_API_KEY);
    // The Resend SDK does NOT throw on API errors (invalid key, unverified
    // sender domain, etc.) — it returns them in `error`. Must inspect it, or
    // failures are silent.
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    if (error) {
      // error.name/message are API-level (no recipient/canyon detail).
      logger.warn(
        { errName: error.name, errMessage: error.message },
        "email_send_rejected",
      );
    }
  } catch (err) {
    // Never reference recipient/canyon detail in the log (CLAUDE.md privacy
    // rule); the send is best-effort and the notification row already exists.
    logger.warn(
      { errClass: err instanceof Error ? err.constructor.name : typeof err },
      "email_send_failed",
    );
  }
}
