import "dotenv/config";
import { defineConfig } from "prisma/config";
import { composeDatabaseUrl } from "./src/lib/databaseUrl";

// `prisma generate` (run during the Docker build, before DB_HOST/DB_USER/
// DB_PASSWORD are injected at container runtime) doesn't need a real DB
// connection - only `migrate deploy`/`db seed` do. Compose from process.env
// directly (with a build-time placeholder fallback when DB_HOST is unset)
// rather than the env() helper, which throws eagerly for every CLI command
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
      ? composeDatabaseUrl({
          host: process.env.DB_HOST,
          port: process.env.DB_PORT,
          name: process.env.DB_NAME ?? "",
          user: process.env.DB_USER ?? "",
          password: process.env.DB_PASSWORD ?? "",
        })
      : "postgresql://placeholder/placeholder",
  },
});
