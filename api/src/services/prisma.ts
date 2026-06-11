import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrlFromEnv } from "../lib/databaseUrl";

const databaseUrl = databaseUrlFromEnv();

// node-postgres (unlike the pre-7 Prisma engine) does NOT negotiate TLS by
// default, and RDS rejects unencrypted connections ("no pg_hba.conf entry ...
// no encryption"). The Docker image bundles the RDS CA at /app/rds-ca.pem, so
// in prod we get verified TLS; on the dev host the file is absent and local
// Postgres/LocalStack connections stay plain. DATABASE_SSL_CA overrides the
// bundle path; a configured-but-missing override fails loud.
const caPath = process.env.DATABASE_SSL_CA ?? "/app/rds-ca.pem";
if (process.env.DATABASE_SSL_CA && !existsSync(process.env.DATABASE_SSL_CA)) {
  throw new Error(`DATABASE_SSL_CA points to a missing file: ${caPath}`);
}
const ssl = existsSync(caPath) ? { ca: readFileSync(caPath, "utf8") } : undefined;

const adapter = new PrismaPg({
  connectionString: databaseUrl,
  ssl,
});

// Single shared Prisma instance across the app
const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
});

export default prisma;
