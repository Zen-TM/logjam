import {
  SESClient,
  VerifyEmailIdentityCommand,
  SendEmailCommand,
} from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: process.env.COGNITO_REGION ?? "ap-southeast-2",
});

const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? "noreply@logjamnsw.com";

/**
 * Trigger SES sandbox verification for a recipient email.
 * SES will send them a verification link they must click.
 */
export async function verifyEmail(email: string): Promise<void> {
  await ses.send(new VerifyEmailIdentityCommand({ EmailAddress: email }));
}

/**
 * Send an email via SES. In sandbox mode, the recipient must be verified.
 * Fails silently with a console warning if SES rejects (e.g. unverified recipient).
 */
export async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string,
): Promise<void> {
  try {
    await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: htmlBody, Charset: "UTF-8" },
          },
        },
      }),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Failed to send email to ${to}: ${message}`);
  }
}
