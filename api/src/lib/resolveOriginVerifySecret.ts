import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

// Populate ORIGIN_VERIFY_SECRET in process.env from Secrets Manager
// (ORIGIN_VERIFY_SECRET_ID) when not already set, mirroring resolveDbCredentials.
//
// Why this exists: the Elastic Beanstalk API container can't use ECS secrets
// injection, so the CloudFront origin-verify token (compared per request in
// src/index.ts) must be fetched into the env BEFORE getEnv() parses it. The
// stored secret is the raw token string (no JSON wrapper) — it is the exact
// value CloudFront sends as the X-Origin-Verify header.
//
// Disabled-by-default: unlike DB creds, a MISSING secret id is a no-op (the
// feature is off), not an error — so a deployment that hasn't wired the secret
// yet boots normally with the check inert. Throws only on a real resolution
// failure (id set but fetch/parse fails). Never logs the secret value; the
// caller (boot) decides whether to exit.
export async function resolveOriginVerifySecret(): Promise<void> {
  if (process.env.ORIGIN_VERIFY_SECRET) {
    return;
  }

  const secretId = process.env.ORIGIN_VERIFY_SECRET_ID;
  if (!secretId) {
    return; // feature not configured — leave unset (check stays inert)
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? "ap-southeast-2",
    endpoint: process.env.AWS_ENDPOINT_URL,
  });
  const result = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  if (!result.SecretString) {
    throw new Error("origin-verify secret has no SecretString");
  }
  process.env.ORIGIN_VERIFY_SECRET = result.SecretString;
}
