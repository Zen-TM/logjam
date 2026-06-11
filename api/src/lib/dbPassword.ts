import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

// Per-connection DB password resolution (rotation-proof).
//
// The RDS master password rotates via the RDS-managed Secrets Manager secret.
// Anything that captures the password once at boot (ECS secrets injection, EB
// secret-referenced env vars, boot.ts) goes stale on rotation until the
// process restarts. node-postgres accepts `password` as an async function
// evaluated each time the pool opens a NEW physical connection, so resolving
// it here means a long-running API picks up the rotated password without a
// restart: existing sessions survive rotation (Postgres doesn't kill live
// connections on password change) and new ones authenticate with the value
// fetched below.
//
// When DB_SECRET_ID is unset (local dev, ECS workers with injected
// DB_PASSWORD) this degenerates to the static env var.

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedPassword: string | null = null;
let cachedAt = 0;

let client: SecretsManagerClient | null = null;

function secretsClient(): SecretsManagerClient {
  if (!client) {
    client = new SecretsManagerClient({
      region: process.env.AWS_REGION ?? "ap-southeast-2",
      endpoint: process.env.AWS_ENDPOINT_URL,
    });
  }
  return client;
}

/** Test hook: clear the module-level cache. */
export function resetDbPasswordCache(): void {
  cachedPassword = null;
  cachedAt = 0;
  client = null;
}

export async function currentDbPassword(): Promise<string> {
  const secretId = process.env.DB_SECRET_ID;
  if (!secretId) {
    const staticPassword = process.env.DB_PASSWORD;
    if (!staticPassword) {
      throw new Error(
        "Neither DB_SECRET_ID nor DB_PASSWORD is set — cannot resolve database password.",
      );
    }
    return staticPassword;
  }

  if (cachedPassword !== null && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedPassword;
  }

  try {
    const result = await secretsClient().send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
    if (!result.SecretString) {
      throw new Error("Secret has no SecretString");
    }
    const parsed = JSON.parse(result.SecretString) as { password?: string };
    if (!parsed.password) {
      throw new Error("Secret JSON is missing the password field");
    }
    cachedPassword = parsed.password;
    cachedAt = Date.now();
    return cachedPassword;
  } catch (err) {
    // A transient Secrets Manager outage must not take down DB connectivity:
    // fall back to the last known password (likely still valid — rotation is
    // rare). With no cache at all, fail loud.
    if (cachedPassword !== null) {
      console.error(
        `dbPassword: refresh failed, using cached password (${(err as Error).constructor.name})`,
      );
      return cachedPassword;
    }
    throw err;
  }
}
