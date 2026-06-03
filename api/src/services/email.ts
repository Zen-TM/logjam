import { VerifyEmailIdentityCommand } from "@aws-sdk/client-ses";
import { ses } from "./awsClients";

/**
 * Trigger SES sandbox verification for a recipient email.
 * SES will send them a verification link they must click.
 */
export async function verifyEmail(email: string): Promise<void> {
  await ses.send(new VerifyEmailIdentityCommand({ EmailAddress: email }));
}
