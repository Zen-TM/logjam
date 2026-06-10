import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Integration tests import services/prisma directly for setup/teardown
// (e.g. creating fixture rows), which now requires DATABASE_URL at
// construction time (Prisma 7 driver adapter). Load the same .env the
// local API server reads so the suite has a consistent DB target.
dotenv.config();

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
});
