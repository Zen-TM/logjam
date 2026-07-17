// Production container entrypoint (compiles to dist/boot.js, run via
// `node dist/boot.js` — see Dockerfile CMD).
//
// 1. If DB_PASSWORD is unset and DB_SECRET_ID is set, fetch the RDS-managed
//    secret from Secrets Manager and populate DB_USER/DB_PASSWORD from it.
//    The Elastic Beanstalk container can't use ECS secrets injection, so this
//    is how it gets DB credentials. ECS workers get DB_USER/DB_PASSWORD
//    injected directly and never need DB_SECRET_ID.
// 2. Start the API (dist/index.js) in the same process.
//
// Database migrations are NOT run here. They run in a gated one-shot Fargate
// task (aws_ecs_task_definition.api_migrate) BEFORE the EB version swap, driven
// by .github/workflows/deploy-api.yml, so a failing migration aborts the deploy
// instead of crash-looping this container at boot (ARCH-001 half B). Instance
// replacement reuses an already-migrated image, so no pending migrations exist
// at plain container start. New schema is applied before the new image serves;
// migrations MUST stay backward-compatible with the currently-running image for
// the swap window (expand/contract — see api/CLAUDE.md).
//
// Fails loud (exit 1) on any error. Never logs secret values.

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

  await import("./index");
}

main().catch((err) => {
  console.error(`boot: fatal error (${(err as Error).message})`);
  process.exit(1);
});
