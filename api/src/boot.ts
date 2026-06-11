// Production container entrypoint (compiles to dist/boot.js, run via
// `node dist/boot.js` — see Dockerfile CMD).
//
// 1. If DB_PASSWORD is unset and DB_SECRET_ID is set, fetch the RDS-managed
//    secret from Secrets Manager and populate DB_USER/DB_PASSWORD from it.
//    The Elastic Beanstalk container can't use ECS secrets injection, so this
//    is how it gets DB credentials. ECS workers get DB_USER/DB_PASSWORD
//    injected directly and never need DB_SECRET_ID.
// 2. Run `npx prisma migrate deploy` against the resolved DB credentials.
// 3. Start the API (dist/index.js) in the same process.
//
// Fails loud (exit 1) on any error. Never logs secret values.

import { spawnSync } from "node:child_process";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

async function resolveDbCredentials(): Promise<void> {
  if (process.env.DB_PASSWORD) {
    return;
  }

  const secretId = process.env.DB_SECRET_ID;
  if (!secretId) {
    console.error(
      "boot: neither DB_PASSWORD nor DB_SECRET_ID is set — cannot resolve database credentials.",
    );
    process.exit(1);
  }

  try {
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
  } catch (err) {
    const e = err as Error;
    console.error(
      `boot: failed to resolve DB credentials from Secrets Manager (${e.constructor.name}: ${e.message})`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await resolveDbCredentials();

  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: process.env,
  });
  if (migrate.status !== 0) {
    process.exit(migrate.status ?? 1);
  }

  await import("./index");
}

main().catch((err) => {
  console.error(`boot: fatal error (${(err as Error).message})`);
  process.exit(1);
});
