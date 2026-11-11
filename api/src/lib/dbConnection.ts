import { existsSync, readFileSync } from "node:fs";
import type { PoolConfig } from "pg";
import { dbPartsFromEnv } from "./databaseUrl";
import { currentDbPassword } from "./dbPassword";

// How every Postgres connection the API opens is made: the Prisma pool
// (services/prisma.ts) and the sweep lock's own client (lib/sweepLeader.ts)
// both take this, so they cannot drift apart on host, TLS or password. Guards:
// services/prisma.unit.test.ts (the pool), lib/sweepLeader.unit.test.ts (the
// lock client) and lib/dbConnection.unit.test.ts (the password callback).
//
// node-postgres does NOT negotiate TLS by default, and the brain's Postgres
// rejects unencrypted connections from outside its host. The Docker image
// bundles the brain's certificate at /app/brain-ca.pem (the build fails
// without it), and that is the default, so in prod we get TLS verified against
// it; on the dev host the file is absent and the local Postgres connection
// stays plain. DATABASE_SSL_CA overrides the path; a configured-but-missing
// override fails loud, and so does production without any certificate: it
// never falls back to a plain connection. Guard: lib/dbConnection.unit.test.ts.
//
// DATABASE_SSL=disable forces a plain connection even when the CA file is
// present. Needed for local-dev worker containers: they run the prod image
// (which bundles the CA) against the local non-SSL Postgres, where verified TLS
// would otherwise fail with "server does not support SSL connections".
// validateEnv refuses it in production (lib/env.unit.test.ts).
export const BRAIN_CA_PATH = "/app/brain-ca.pem";

export function dbConnectionConfig(): PoolConfig {
  const sslDisabled = process.env.DATABASE_SSL === "disable";
  const configured = process.env.DATABASE_SSL_CA;
  const caPath = configured ?? BRAIN_CA_PATH;
  const haveCa = existsSync(caPath);
  if (!haveCa && configured) {
    throw new Error(`DATABASE_SSL_CA points to a missing file: ${caPath}`);
  }
  if (!haveCa && !sslDisabled && process.env.NODE_ENV === "production") {
    throw new Error(
      `No database certificate at ${caPath}: production never connects in the clear`,
    );
  }
  const ssl =
    !sslDisabled && haveCa ? { ca: readFileSync(caPath, "utf8") } : undefined;

  // `password` as an async function is evaluated by node-postgres on every NEW
  // physical connection, so the pool keeps working across password rotations
  // without a restart (see lib/dbPassword.ts). That holds only with
  // discrete fields: given a connectionString, pg parses the URL over the
  // config and its boot-time password replaces the function. Guard:
  // lib/dbConnection.unit.test.ts.
  //
  // keepAlive and the connect timeout keep a replaced database host from leaving
  // the pool (or the sweep lock's connection, idle for minutes at a time) on
  // dead sockets, or a connect that never answers. No statement timeout: a slow
  // query is not a dead host. Guard: services/prisma.unit.test.ts.
  const { host, port, name, user } = dbPartsFromEnv();
  return {
    host,
    port: Number(port),
    database: name,
    user,
    password: () => currentDbPassword(),
    ssl,
    keepAlive: true,
    connectionTimeoutMillis: 10_000,
  };
}
