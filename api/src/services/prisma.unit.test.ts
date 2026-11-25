import { beforeEach, expect, it, vi } from "vitest";

const adapterConfigs: Record<string, unknown>[] = [];
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(config: Record<string, unknown>) {
      adapterConfigs.push(config);
    }
  },
}));
vi.mock("@prisma/client", () => ({ PrismaClient: class {} }));

beforeEach(() => {
  adapterConfigs.length = 0;
  vi.resetModules();
  vi.stubEnv("DB_HOST", "db");
  vi.stubEnv("DB_NAME", "n");
  vi.stubEnv("DB_USER", "u");
  vi.stubEnv("DB_PASSWORD", "p");
});

// Mutation: drop keepAlive or connectionTimeoutMillis from dbConnectionConfig()
// (lib/dbConnection.ts). The pool reaches it through the real services/prisma
// import. The sweep lock's client reaches the same function; its half is
// guarded in lib/sweepLeader.unit.test.ts.
it("keeps connections alive and bounds the connect", async () => {
  await import("./prisma");
  const { dbConnectionConfig } = await import("../lib/dbConnection");
  expect(dbConnectionConfig()).toMatchObject({
    keepAlive: true,
    connectionTimeoutMillis: 10_000,
  });
  expect(adapterConfigs[0]).toMatchObject({
    keepAlive: true,
    connectionTimeoutMillis: 10_000,
  });
  expect(adapterConfigs[0]).not.toHaveProperty("statement_timeout");
});
