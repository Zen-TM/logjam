import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

// Populate DB_USER/DB_PASSWORD in process.env from the RDS-managed Secrets
// Manager secret (DB_SECRET_ID) when DB_PASSWORD is not already set.
//
// Why this exists in two callers: lib/databaseUrl.ts composes the connection
// string from DB_USER/DB_PASSWORD and throws if either is missing, so both the
// EB container entrypoint (src/boot.ts) and the GeoPDF Lambda
// (src/worker/geoPdfLambda.ts) must resolve credentials BEFORE prisma.ts is
// imported. ECS Fargate workers get DB_USER/DB_PASSWORD via ECS secrets
// injection and local dev sets DB_PASSWORD directly, so for them this is a
// no-op. (lib/dbPassword.ts separately re-resolves the *password* per physical
// connection for rotation; this fills the env once at startup.)
//
// Throws on any resolution failure. Never logs secret values. Callers decide
// whether to exit (boot) or let the error surface (Lambda invocation failure).

export async function resolveDbCredentials(): Promise<void> {
  if (process.env.DB_PASSWORD) {
    return;
  }

  const secretId = process.env.DB_SECRET_ID;
  if (!secretId) {
    throw new Error(
      "neither DB_PASSWORD nor DB_SECRET_ID is set — cannot resolve database credentials",
    );
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? "ap-southeast-2",
    endpoint: process.env.AWS_ENDPOINT_URL,
  });
  const result = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  if (!result.SecretString) {
    throw new Error("Secret has no SecretString");
  }
  const parsed = JSON.parse(result.SecretString) as {
    username?: string;
    password?: string;
  };
  if (!parsed.username || !parsed.password) {
    throw new Error("Secret JSON is missing username or password field");
  }
  process.env.DB_USER = parsed.username;
  process.env.DB_PASSWORD = parsed.password;
}
