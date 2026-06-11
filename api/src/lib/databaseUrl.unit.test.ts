import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { composeDatabaseUrl, databaseUrlFromEnv } from "./databaseUrl";

describe("composeDatabaseUrl", () => {
  it("URL-encodes special characters in user and password", () => {
    const url = composeDatabaseUrl({
      host: "db.example.com",
      port: 5432,
      name: "logjam",
      user: "logjam_admin",
      password: "p@ss!w0rd#",
    });
    expect(url).toBe(
      "postgresql://logjam_admin:p%40ss!w0rd%23@db.example.com:5432/logjam",
    );
  });

  it("defaults port to 5432 when omitted", () => {
    const url = composeDatabaseUrl({
      host: "localhost",
      name: "logjam",
      user: "logjam",
      password: "logjam",
    });
    expect(url).toBe("postgresql://logjam:logjam@localhost:5432/logjam");
  });
});

describe("databaseUrlFromEnv", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it("composes a URL from DB_* env vars", () => {
    process.env.DB_HOST = "localhost";
    process.env.DB_PORT = "5433";
    process.env.DB_NAME = "logjam";
    process.env.DB_USER = "logjam";
    process.env.DB_PASSWORD = "logjam";
    expect(databaseUrlFromEnv()).toBe(
      "postgresql://logjam:logjam@localhost:5433/logjam",
    );
  });

  it("defaults DB_PORT to 5432 when unset", () => {
    process.env.DB_HOST = "localhost";
    process.env.DB_NAME = "logjam";
    process.env.DB_USER = "logjam";
    process.env.DB_PASSWORD = "logjam";
    expect(databaseUrlFromEnv()).toContain(":5432/logjam");
  });

  it("throws an error listing only the names of missing vars, never values", () => {
    process.env.DB_HOST = "localhost";
    process.env.DB_PASSWORD = "secret-value";
    expect(() => databaseUrlFromEnv()).toThrow(/DB_NAME/);
    expect(() => databaseUrlFromEnv()).toThrow(/DB_USER/);
    try {
      databaseUrlFromEnv();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("secret-value");
      expect(msg).not.toContain("localhost");
    }
  });

  it("lists all four var names when all are missing", () => {
    expect(() => databaseUrlFromEnv()).toThrow(
      /DB_HOST.*DB_NAME.*DB_USER.*DB_PASSWORD/,
    );
  });
});
