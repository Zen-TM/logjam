import { defineConfig } from "vitest/config";

// Pure unit tests — colocated with source as *.unit.test.ts. Unlike the
// integration suite in src/__tests__ (which needs a running local API via
// `make dev`), these run with no server, DB, or AWS: Prisma and AWS clients
// are mocked per-test. Run with `npm run test:unit`.
export default defineConfig({
  test: {
    include: ["src/**/*.unit.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.unit.setup.ts"],
  },
});
