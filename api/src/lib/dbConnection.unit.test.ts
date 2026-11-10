// The TLS rule for every Postgres connection the API opens: the brain's
// certificate is the default, production never connects in the clear, and
// local dev (no certificate file) stays plain.
//
// Mutations that turn it red: the default path back to a bundle the image no
// longer carries; the production refusal dropped (the `NODE_ENV ===
// "production"` clause); the configured-but-missing refusal dropped.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
vi.mock("node:fs", () => ({
  existsSync: (path: string) => files.has(path),
  readFileSync: (path: string) => files.get(path),
}));

import { dbConnectionConfig } from "./dbConnection";

beforeEach(() => {
  files.clear();
  vi.stubEnv("DB_HOST", "db");
  vi.stubEnv("DB_NAME", "n");
  vi.stubEnv("DB_USER", "u");
  vi.stubEnv("DB_PASSWORD", "p");
  delete process.env.DATABASE_SSL;
  delete process.env.DATABASE_SSL_CA;
});
afterEach(() => vi.unstubAllEnvs());

describe("dbConnectionConfig TLS", () => {
  it("verifies against the brain's certificate by default", () => {
    files.set("/app/brain-ca.pem", "BRAIN");
    vi.stubEnv("NODE_ENV", "production");
    expect(dbConnectionConfig().ssl).toEqual({ ca: "BRAIN" });
  });

  it("takes the certificate from DATABASE_SSL_CA when set", () => {
    files.set("/etc/other.pem", "OTHER");
    vi.stubEnv("DATABASE_SSL_CA", "/etc/other.pem");
    expect(dbConnectionConfig().ssl).toEqual({ ca: "OTHER" });
  });

  it("refuses production without a certificate instead of connecting in the clear", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => dbConnectionConfig()).toThrow(/never connects in the clear/);
  });

  it("refuses a configured certificate that is missing", () => {
    vi.stubEnv("DATABASE_SSL_CA", "/etc/gone.pem");
    expect(() => dbConnectionConfig()).toThrow(/missing file/);
  });

  it("stays plain in development without a certificate file", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(dbConnectionConfig().ssl).toBeUndefined();
  });

  it("stays plain where DATABASE_SSL=disable, even with the certificate in the image", () => {
    files.set("/app/brain-ca.pem", "BRAIN");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_SSL", "disable");
    expect(dbConnectionConfig().ssl).toBeUndefined();
  });
});
