/**
 * Cognito CustomEmailSender Lambda.
 *
 * Why this exists: the user pool was on `email_sending_account = COGNITO_DEFAULT`,
 * which mails verification codes from `no-reply@verificationemail.com` on AWS's
 * shared IP pool — no DKIM/DMARC alignment with logjamnsw.com, so Gmail spam-bins
 * every signup code. SES is unavailable (prod access denied; Resend replaced it).
 * Routing Cognito's emails through Resend (verified DKIM/SPF/DMARC on
 * notifications.logjamnsw.com) lands them in the inbox.
 *
 * Mechanism: enabling CustomEmailSender means Cognito no longer sends mail itself.
 * For every email trigger it encrypts the code with our KMS CMK and invokes this
 * function; we decrypt with the AWS Encryption SDK and send via Resend.
 *
 * Privacy: never log the decrypted code or the recipient address (mirrors the
 * api/src/lib/logger.ts redaction discipline). Errors are logged by class only.
 */
import {
  buildClient,
  CommitmentPolicy,
  KmsKeyringNode,
} from "@aws-crypto/client-node";
import { SecretsManager } from "@aws-sdk/client-secrets-manager";
import type { CustomEmailSenderTriggerEvent } from "aws-lambda";
import { Resend } from "resend";

const { decrypt } = buildClient(
  CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT,
);

const KMS_KEY_ARN = process.env.KMS_KEY_ARN;
const EMAIL_FROM = process.env.EMAIL_FROM;
// JSON secret { "apiKey": "re_..." } — same secret/key the ECS workers read.
const RESEND_SECRET_ARN = process.env.RESEND_SECRET_ARN;

// Cached across warm invocations.
let resendApiKeyPromise: Promise<string> | undefined;

function loadResendApiKey(): Promise<string> {
  if (!RESEND_SECRET_ARN) {
    throw new Error("RESEND_SECRET_ARN unset");
  }
  if (!resendApiKeyPromise) {
    const secrets = new SecretsManager({});
    resendApiKeyPromise = secrets
      .getSecretValue({ SecretId: RESEND_SECRET_ARN })
      .then((out) => {
        if (!out.SecretString) {
          throw new Error("resend secret has no SecretString");
        }
        const apiKey = (JSON.parse(out.SecretString) as { apiKey?: string })
          .apiKey;
        if (!apiKey) {
          throw new Error("resend secret missing apiKey field");
        }
        return apiKey;
      });
  }
  return resendApiKeyPromise;
}

async function decryptCode(ciphertextBase64: string): Promise<string> {
  if (!KMS_KEY_ARN) {
    throw new Error("KMS_KEY_ARN unset");
  }
  const keyring = new KmsKeyringNode({ keyIds: [KMS_KEY_ARN] });
  const { plaintext } = await decrypt(
    keyring,
    Buffer.from(ciphertextBase64, "base64"),
  );
  return plaintext.toString("utf-8");
}

interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

// Branded-minimal wrapper. No external images (blocked images hurt
// deliverability and look broken) — a styled text wordmark instead.
function wrap(bodyHtml: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
  <div style="font-size:20px;font-weight:700;letter-spacing:-0.5px;color:#1f6f4a;margin-bottom:16px">Logjam</div>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0"/>
  <div style="font-size:12px;color:#888">Logjam — canyoning logbook for NSW.</div>
</div>`;
}

function codeBlock(code: string): string {
  return `<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${code}</p>`;
}

// Build the email for a given trigger. Throws on an unknown trigger so a missing
// flow fails loud (a silently-unhandled type would send no mail at all).
function buildEmail(
  triggerSource: string,
  code: string | undefined,
): EmailContent {
  switch (triggerSource) {
    case "CustomEmailSender_SignUp":
    case "CustomEmailSender_ResendCode": {
      if (!code) throw new Error(`${triggerSource} without code`);
      return {
        subject: "Your Logjam verification code",
        text: `Your Logjam verification code is ${code}. It expires in 24 hours. If you didn't request this, ignore this email.`,
        html: wrap(
          `<p>Your Logjam verification code is:</p>${codeBlock(
            code,
          )}<p style="font-size:13px;color:#666">It expires in 24 hours. If you didn't request this, ignore this email.</p>`,
        ),
      };
    }
    case "CustomEmailSender_ForgotPassword": {
      if (!code) throw new Error(`${triggerSource} without code`);
      return {
        subject: "Reset your Logjam password",
        text: `Your Logjam password reset code is ${code}. It expires in 24 hours. If you didn't request this, ignore this email.`,
        html: wrap(
          `<p>Your Logjam password reset code is:</p>${codeBlock(
            code,
          )}<p style="font-size:13px;color:#666">It expires in 24 hours. If you didn't request this, ignore this email.</p>`,
        ),
      };
    }
    case "CustomEmailSender_UpdateUserAttribute":
    case "CustomEmailSender_VerifyUserAttribute": {
      if (!code) throw new Error(`${triggerSource} without code`);
      return {
        subject: "Confirm your Logjam email change",
        text: `Your Logjam confirmation code is ${code}. It expires in 24 hours.`,
        html: wrap(
          `<p>Your Logjam confirmation code is:</p>${codeBlock(
            code,
          )}<p style="font-size:13px;color:#666">It expires in 24 hours.</p>`,
        ),
      };
    }
    case "CustomEmailSender_AdminCreateUser": {
      if (!code) throw new Error(`${triggerSource} without code`);
      return {
        subject: "You've been invited to Logjam",
        text: `You've been added to Logjam. Your temporary password is ${code}. Sign in and you'll be prompted to set a new one.`,
        html: wrap(
          `<p>You've been added to Logjam. Your temporary password is:</p>${codeBlock(
            code,
          )}<p style="font-size:13px;color:#666">Sign in and you'll be prompted to set a new one.</p>`,
        ),
      };
    }
    case "CustomEmailSender_AccountTakeOverNotification": {
      // Security notification — no code in the payload.
      return {
        subject: "Security alert for your Logjam account",
        text: "We detected a sign-in to your Logjam account that looked unusual. If this was you, no action is needed. If not, reset your password.",
        html: wrap(
          `<p>We detected a sign-in to your Logjam account that looked unusual.</p><p style="font-size:13px;color:#666">If this was you, no action is needed. If not, reset your password.</p>`,
        ),
      };
    }
    default:
      throw new Error(`unhandled trigger source: ${triggerSource}`);
  }
}

export async function handler(
  event: CustomEmailSenderTriggerEvent,
): Promise<void> {
  if (!EMAIL_FROM) {
    throw new Error("EMAIL_FROM unset");
  }

  // userAttributes is a union across trigger types; the AccountTakeOver variant
  // omits a typed `email`. Read through a string map — every flow we mail
  // carries the verified email here.
  const userAttributes = event.request.userAttributes as Record<
    string,
    string | undefined
  >;
  const recipient = userAttributes.email;
  if (!recipient) {
    throw new Error("event missing recipient email");
  }

  const code = event.request.code
    ? await decryptCode(event.request.code)
    : undefined;

  const { subject, text, html } = buildEmail(event.triggerSource, code);

  const resend = new Resend(await loadResendApiKey());
  // The Resend SDK does NOT throw on API errors (invalid key, unverified sender
  // domain, etc.) — it returns them in `error`. Unlike the best-effort api/
  // sender, here we THROW on failure: there is no in-app notification fallback,
  // and a Cognito-trigger throw lets the auth flow surface the failure instead
  // of silently swallowing an undelivered verification code.
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: recipient,
    subject,
    text,
    html,
  });
  if (error) {
    // error.name/message are API-level (no code/recipient detail).
    throw new Error(`resend rejected: ${error.name}`);
  }
}
