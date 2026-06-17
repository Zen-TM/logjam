import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrlFromEnv } from "../lib/databaseUrl";
import { currentDbPassword } from "../lib/dbPassword";

const databaseUrl = databaseUrlFromEnv();

// node-postgres (unlike the pre-7 Prisma engine) does NOT negotiate TLS by
// default, and RDS rejects unencrypted connections ("no pg_hba.conf entry ...
// no encryption"). The Docker image bundles the RDS CA at /app/rds-ca.pem, so
// in prod we get verified TLS; on the dev host the file is absent and the local
// Postgres connection stays plain. DATABASE_SSL_CA overrides the
// bundle path; a configured-but-missing override fails loud.
//
// DATABASE_SSL=disable forces a plain connection even when the CA file is
// present. Needed for local-dev worker containers: they run the prod image
// (which bundles the CA) against the local non-SSL Postgres, where verified TLS
// would otherwise fail with "server does not support SSL connections". Never
// set in prod.
const sslDisabled = process.env.DATABASE_SSL === "disable";
const caPath = process.env.DATABASE_SSL_CA ?? "/app/rds-ca.pem";
if (process.env.DATABASE_SSL_CA && !existsSync(process.env.DATABASE_SSL_CA)) {
  throw new Error(`DATABASE_SSL_CA points to a missing file: ${caPath}`);
}
const ssl = !sslDisabled && existsSync(caPath) ? { ca: readFileSync(caPath, "utf8") } : undefined;

// `password` as an async function is evaluated by node-postgres on every NEW
// physical connection and overrides the connectionString's password, so the
// pool keeps working across RDS password rotations without a restart (see
// lib/dbPassword.ts). The boot-time password in the URL is only a fallback
// for pg internals that never invoke the callback.
const adapter = new PrismaPg({
  connectionString: databaseUrl,
  password: () => currentDbPassword(),
  ssl,
});

// Single shared Prisma instance across the app
const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
});

export default prisma;
