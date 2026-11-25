import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { composeDatabaseUrl, databaseUrlFromEnv } from "./databaseUrl";
import {
  composeDatabaseUrl as prismaConfigCompose,
  migrateDatabaseUrl,
} from "../../prisma.config";

// prisma.config.ts loads .env on import; this test wants neither its values
// nor its side effect.
vi.mock("dotenv/config", () => ({}));

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

  // Mutation: drop either encodeURIComponent in prisma.config.ts.
  it("matches the copy in prisma.config.ts, which cannot import this one", () => {
    for (const parts of [
      { host: "db", port: "6543", name: "n", user: "u@x", password: "p!:/#" },
      { host: "db", name: "n", user: "u", password: "p" },
    ]) {
      expect(prismaConfigCompose(parts)).toBe(composeDatabaseUrl(parts));
    }
  });
});

describe("migrateDatabaseUrl", () => {
  const url = "postgresql://u:p@db:5432/n";

  it("leaves the URL as it is outside production without an explicit DATABASE_SSL_CA", () => {
    expect(migrateDatabaseUrl(url, {})).toBe(url);
    expect(migrateDatabaseUrl(url, { NODE_ENV: "development" })).toBe(url);
  });

  // Mutation: dropping the NODE_ENV default in migrateDatabaseUrl
  // (prisma.config.ts): a production migrate with no certificate configured
  // would connect in the clear.
  it("verifies against the brain's certificate in production by default", () => {
    expect(migrateDatabaseUrl(url, { NODE_ENV: "production" })).toBe(
      `${url}?sslmode=require&sslaccept=strict&sslcert=%2Fapp%2Fbrain-ca.pem`,
    );
  });

  // Mutation: `??` back in place of `||` for DATABASE_SSL_CA in migrateDatabaseUrl:
  // an empty value is then a certificate named "", and production connects in the clear.
  it("reads an empty DATABASE_SSL_CA as unset: production still verifies", () => {
    expect(
      migrateDatabaseUrl(url, { NODE_ENV: "production", DATABASE_SSL_CA: "" }),
    ).toBe(
      `${url}?sslmode=require&sslaccept=strict&sslcert=%2Fapp%2Fbrain-ca.pem`,
    );
  });

  // Mutation: remove the production check for DATABASE_SSL=disable in
  // migrateDatabaseUrl: a production migrate then returns the plain URL.
  it("refuses DATABASE_SSL=disable in production", () => {
    expect(() =>
      migrateDatabaseUrl(url, {
        NODE_ENV: "production",
        DATABASE_SSL: "disable",
      }),
    ).toThrow(/forbidden in production/);
  });

  it("leaves the URL as it is when DATABASE_SSL=disable", () => {
    expect(
      migrateDatabaseUrl(url, {
        DATABASE_SSL: "disable",
        DATABASE_SSL_CA: "/etc/ca.pem",
      }),
    ).toBe(url);
  });

  // Mutation: drop `sslaccept=strict`; Prisma then trusts any certificate.
  it("verifies against the named CA and fails closed when it is set", () => {
    expect(
      migrateDatabaseUrl(url, { DATABASE_SSL_CA: "/etc/brain ca.pem" }),
    ).toBe(
      `${url}?sslmode=require&sslaccept=strict&sslcert=%2Fetc%2Fbrain%20ca.pem`,
    );
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

  // Mutation: append the migrate ssl parameters in composeDatabaseUrl.
  it("never adds ssl parameters, which node-postgres would misread", () => {
    process.env.DB_HOST = "db";
    process.env.DB_NAME = "n";
    process.env.DB_USER = "u";
    process.env.DB_PASSWORD = "p";
    process.env.DATABASE_SSL_CA = "/etc/ca.pem";
    expect(databaseUrlFromEnv()).toBe("postgresql://u:p@db:5432/n");
  });

  it("lists all four var names when all are missing", () => {
    expect(() => databaseUrlFromEnv()).toThrow(
      /DB_HOST.*DB_NAME.*DB_USER.*DB_PASSWORD/,
    );
  });
});
