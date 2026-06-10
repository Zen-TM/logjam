import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` (run during the Docker build, before DATABASE_URL is
// injected at container runtime) doesn't need a real DB connection - only
// `migrate deploy`/`db seed` do. Use process.env directly (with a build-time
// placeholder fallback) rather than the env() helper, which throws eagerly
// for every CLI command including `generate`. services/prisma.ts and
// prisma/seed.ts independently fail loud if DATABASE_URL is unset at runtime.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder",
  },
});
