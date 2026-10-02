import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Integration tests import services/prisma directly for setup/teardown
// (e.g. creating fixture rows), which now requires DB_HOST/DB_NAME/DB_USER/
// DB_PASSWORD at construction time (Prisma 7 driver adapter, composed via
// lib/databaseUrl.ts). Load the same file the local API server reads — the
// Terraform-generated root .env.local (src/index.ts) — so the suite targets
// the DB the server does. dotenv never overrides a set var, so CI's job-level
// env wins and a missing file is a no-op there.
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
    // The API's global rate limiter keys pre-auth requests by IP, so the whole
    // suite shares ONE 300-req/60s bucket regardless of acting user, and the
    // suite's total demand exceeds a single window. Run files sequentially and
    // let the per-file gate (_rateLimitGate.ts) sleep to the window reset when
    // the remaining budget is too low — see that file for details.
    fileParallelism: false,
    setupFiles: [
      "src/__tests__/_rateLimitGate.ts",
      "src/__tests__/_cleanup.ts",
    ],
    globalSetup: ["src/__tests__/_globalSetup.ts"],
  },
});
