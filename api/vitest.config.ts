import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Integration tests import services/prisma directly for setup/teardown
// (e.g. creating fixture rows), which now requires DB_HOST/DB_NAME/DB_USER/
// DB_PASSWORD at construction time (Prisma 7 driver adapter, composed via
// lib/databaseUrl.ts). Load the same .env the local API server reads (api/.env)
// so the suite has a consistent DB target.
dotenv.config();

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
});
