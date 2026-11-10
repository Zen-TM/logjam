import { existsSync, readFileSync } from "node:fs";
import type { PoolConfig } from "pg";
import { databaseUrlFromEnv } from "./databaseUrl";
import { currentDbPassword } from "./dbPassword";

// How every Postgres connection the API opens is made: the Prisma pool
// (services/prisma.ts) and the sweep lock's own client (lib/sweepLeader.ts)
// both take this, so they cannot drift apart on URL, TLS or password. Guards:
// services/prisma.unit.test.ts (the pool) and lib/sweepLeader.unit.test.ts
// (the lock client).
//
// node-postgres does NOT negotiate TLS by
// default, and RDS rejects unencrypted connections ("no pg_hba.conf entry ...
// no encryption"). The Docker image bundles the RDS CA at /app/rds-ca.pem, so
// in prod we get verified TLS; on the dev host the file is absent and the local
// Postgres connection stays plain. DATABASE_SSL_CA overrides the
// bundle path; a configured-but-missing override fails loud.
//
// DATABASE_SSL=disable forces a plain connection even when the CA file is
// present. Needed for local-dev worker containers: they run the prod image
// (which bundles the CA) against the local non-SSL Postgres, where verified TLS
// would otherwise fail with "server does not support SSL connections".
// validateEnv refuses it in production (lib/env.unit.test.ts).
export function dbConnectionConfig(): PoolConfig {
  const sslDisabled = process.env.DATABASE_SSL === "disable";
  const caPath = process.env.DATABASE_SSL_CA ?? "/app/rds-ca.pem";
  if (process.env.DATABASE_SSL_CA && !existsSync(process.env.DATABASE_SSL_CA)) {
    throw new Error(`DATABASE_SSL_CA points to a missing file: ${caPath}`);
  }
  const ssl =
    !sslDisabled && existsSync(caPath)
      ? { ca: readFileSync(caPath, "utf8") }
      : undefined;

  // `password` as an async function is evaluated by node-postgres on every NEW
  // physical connection and overrides the connectionString's password, so the
  // pool keeps working across RDS password rotations without a restart (see
  // lib/dbPassword.ts). The boot-time password in the URL is only a fallback
  // for pg internals that never invoke the callback.
  //
  // keepAlive and the connect timeout keep a replaced database host from leaving
  // the pool (or the sweep lock's connection, idle for minutes at a time) on
  // dead sockets, or a connect that never answers. No statement timeout: a slow
  // query is not a dead host. Guard: services/prisma.unit.test.ts.
  return {
    connectionString: databaseUrlFromEnv(),
    password: () => currentDbPassword(),
    ssl,
    keepAlive: true,
    connectionTimeoutMillis: 10_000,
  };
}
