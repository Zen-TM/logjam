import { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbConnectionConfig } from "./dbConnection";

vi.mock("./dbPassword", () => ({
  currentDbPassword: async () => "from-the-callback",
}));

beforeEach(() => {
  vi.stubEnv("DB_HOST", "db.internal");
  vi.stubEnv("DB_PORT", "6543");
  vi.stubEnv("DB_NAME", "logjam");
  vi.stubEnv("DB_USER", "u@x");
  vi.stubEnv("DB_PASSWORD", "boot-time-password");
  vi.stubEnv("DATABASE_SSL", "disable");
});

// The real pg driver, never connected: its constructor resolves the config the
// way a new connection will.
//
// Mutation: put `connectionString: databaseUrlFromEnv()` back beside the
// password callback in dbConnectionConfig() (lib/dbConnection.ts). pg then
// parses the URL over the config and `password` is the boot-time string.
describe("dbConnectionConfig", () => {
  it("hands pg the password callback, not the boot-time password", async () => {
    const client = new Client(dbConnectionConfig());
    expect(typeof client.password).toBe("function");
    expect(await (client.password as unknown as () => Promise<string>)()).toBe(
      "from-the-callback",
    );
  });

  it("passes a user name as it is, not URL-encoded", () => {
    const client = new Client(dbConnectionConfig());
    expect(client).toMatchObject({
      host: "db.internal",
      port: 6543,
      database: "logjam",
      user: "u@x",
    });
  });
});
