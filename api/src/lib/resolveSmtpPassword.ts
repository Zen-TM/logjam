import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

// Populate SMTP_PASSWORD in process.env from Secrets Manager (RESEND_SECRET_ID)
// when not already set. The Elastic Beanstalk container can't use ECS secrets
// injection; the workers get SMTP_PASSWORD injected from the same secret, a
// JSON object whose `apiKey` is Resend's API key and its SMTP password.
//
// Unlike the DB and origin-verify resolvers this never fails boot: email is
// best-effort, so a failed read leaves email off (services/email.ts) and the
// API up. Never logs the secret value.
export async function resolveSmtpPassword(): Promise<void> {
  const secretId = process.env.RESEND_SECRET_ID;
  if (process.env.SMTP_PASSWORD || !secretId) {
    return;
  }

  try {
    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION ?? "ap-southeast-2",
      endpoint: process.env.AWS_ENDPOINT_URL,
    });
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
    const { apiKey } = JSON.parse(result.SecretString ?? "{}");
    if (!apiKey) {
      throw new Error("Resend secret has no apiKey");
    }
    process.env.SMTP_PASSWORD = apiKey;
  } catch (err) {
    console.error(
      `boot: email stays off, no SMTP password (${(err as Error).constructor.name})`,
    );
  }
}
