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
import { resolveDbCredentials } from "./lib/resolveDbCredentials";
import { resolveOriginVerifySecret } from "./lib/resolveOriginVerifySecret";

async function main(): Promise<void> {
  try {
    await resolveDbCredentials();
    await resolveOriginVerifySecret();
  } catch (err) {
    const e = err as Error;
    console.error(
      `boot: failed to resolve startup secrets (${e.constructor.name}: ${e.message})`,
    );
    process.exit(1);
  }

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
