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
    // The API's global rate limiter keys pre-auth requests by IP, so the whole
    // suite shares ONE 300-req/60s bucket regardless of acting user, and the
    // suite's total demand exceeds a single window. Run files sequentially and
    // let the per-file gate (_rateLimitGate.ts) sleep to the window reset when
    // the remaining budget is too low — see that file for details.
    fileParallelism: false,
    setupFiles: ["src/__tests__/_rateLimitGate.ts"],
  },
});
