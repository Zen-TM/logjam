import "dotenv/config";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

// Inline mirror of src/lib/databaseUrl.ts composeDatabaseUrl — this file is
// loaded by the Prisma CLI during the Docker build BEFORE src/ is copied in
// (`prisma generate` runs right after `npm ci`), so it cannot import from
// src/. Parity: src/lib/databaseUrl.unit.test.ts.
export function composeDatabaseUrl(parts: {
  host: string;
  port?: string;
  name: string;
  user: string;
  password: string;
}): string {
  const port = parts.port ?? "5432";
  return `postgresql://${encodeURIComponent(parts.user)}:${encodeURIComponent(parts.password)}@${parts.host}:${port}/${parts.name}`;
}

// The schema engine behind `migrate deploy` ignores node-postgres's ssl
// settings and reads its own URL parameters: without `sslaccept=strict` it
// accepts any certificate, and `sslrootcert` / `sslmode=verify-full` are
// ignored. `sslcert` names the CA to trust (hostname checked too). Only an
// explicit DATABASE_SSL_CA turns this on, so the RDS path keeps its URL as it
// is. These parameters must never reach the runtime URL (src/lib/databaseUrl.ts):
// node-postgres would misread them. Guard: src/lib/databaseUrl.unit.test.ts.
export function migrateDatabaseUrl(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const ca = env.DATABASE_SSL_CA;
  if (!ca || env.DATABASE_SSL === "disable") return url;
  return `${url}?sslmode=require&sslaccept=strict&sslcert=${encodeURIComponent(resolve(ca))}`;
}

// `prisma generate` (run during the Docker build, before DB_HOST/DB_USER/
// DB_PASSWORD are injected at container runtime) doesn't need a real DB
// connection - only `migrate deploy`/`db seed` do. Compose from process.env
// directly (with a build-time placeholder fallback when DB_HOST is unset)
// rather than getEnv(), which exits on a missing var for every CLI command
// including `generate`. services/prisma.ts and prisma/seed.ts independently
// fail loud via databaseUrlFromEnv() if the DB_* vars are unset at runtime.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node prisma/seed.ts",
  },
  datasource: {
    url: process.env.DB_HOST
      ? migrateDatabaseUrl(
          composeDatabaseUrl({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            name: process.env.DB_NAME ?? "",
            user: process.env.DB_USER ?? "",
            password: process.env.DB_PASSWORD ?? "",
          }),
        )
      : "postgresql://placeholder/placeholder",
  },
});
