import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { validateEnv } from "./env";

// validateEnv reads process.env and calls process.exit(1) on failure. Snapshot
// the real env, drive a clean baseline per test, and make process.exit throw so
// we can assert the exit paths without killing the test runner.
const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
}

const exitSpy = vi
  .spyOn(process, "exit")
  .mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);

beforeEach(() => {
  exitSpy.mockClear();
  setEnv({
    NODE_ENV: "development",
    AUTH_MODE: "fake",
    DB_HOST: "localhost",
    DB_NAME: "db",
    DB_USER: "u",
    DB_PASSWORD: "p",
  });
});

afterAll(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, ORIGINAL_ENV);
  exitSpy.mockRestore();
});

describe("validateEnv — valid configurations", () => {
  it("parses CORS_ORIGIN into a trimmed, filtered list", () => {
    process.env.CORS_ORIGIN = "http://a.com, http://b.com ,";
    const env = validateEnv();
    expect(env.CORS_ORIGIN_LIST).toEqual(["http://a.com", "http://b.com"]);
  });

  it("defaults the CORS list to localhost in fake auth when unset", () => {
    const env = validateEnv();
    expect(env.CORS_ORIGIN_LIST).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
  });

  it("splits ECS_SUBNETS and ECS_SECURITY_GROUPS into lists", () => {
    process.env.ECS_SUBNETS = "subnet-1, subnet-2 ,subnet-3";
    process.env.ECS_SECURITY_GROUPS = "sg-1";
    const env = validateEnv();
    expect(env.ECS_SUBNETS_LIST).toEqual(["subnet-1", "subnet-2", "subnet-3"]);
    expect(env.ECS_SECURITY_GROUPS_LIST).toEqual(["sg-1"]);
  });

  it("applies defaults for unset numeric/string fields", () => {
    const env = validateEnv();
    expect(env.PORT).toBe(8080);
    expect(env.DB_PORT).toBe(5432);
    expect(env.AWS_REGION).toBe("ap-southeast-2");
    expect(env.TOPO_REAPER_INTERVAL_MS).toBe(300_000);
    expect(env.TOPO_REAPER_EXPORT_QUEUED_TIMEOUT_MS).toBe(900_000);
    expect(env.TOPO_REAPER_EXPORT_RUNNING_TIMEOUT_MS).toBe(10_800_000);
    expect(env.TOPO_EXPORT_TTL_MS).toBe(604_800_000);
  });
});

describe("validateEnv — failure paths exit the process", () => {
  it("exits when DB_HOST is missing", () => {
    delete process.env.DB_HOST;
    expect(() => validateEnv()).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when DB_PASSWORD is missing", () => {
    delete process.env.DB_PASSWORD;
    expect(() => validateEnv()).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when AUTH_MODE=fake in production", () => {
    process.env.NODE_ENV = "production";
    // satisfy prod-required vars so we hit the fake-in-prod guard specifically
    process.env.CORS_ORIGIN = "http://x";
    process.env.S3_BUCKET_TOPO = "t";
    process.env.S3_BUCKET_MEDIA = "m";
    process.env.ECS_SUBNETS = "s";
    process.env.ECS_SECURITY_GROUPS = "g";
    process.env.TOPO_CDN_BASE_URL = "https://cdn.example.com";
    expect(() => validateEnv()).toThrow(/process\.exit/);
  });

  it("exits when AUTH_MODE=cognito is missing Cognito vars", () => {
    process.env.AUTH_MODE = "cognito";
    expect(() => validateEnv()).toThrow(/process\.exit/);
  });

  it("exits when ORIGIN_VERIFY_ENFORCE=true with no secret (fail closed)", () => {
    process.env.ORIGIN_VERIFY_ENFORCE = "true";
    // No ORIGIN_VERIFY_SECRET set — enforcing with nothing to compare would
    // 403 every request, so validateEnv must refuse to start.
    expect(() => validateEnv()).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("validateEnv — origin-verify", () => {
  it("defaults ORIGIN_VERIFY_ENFORCE to false and leaves the secret unset", () => {
    const env = validateEnv();
    expect(env.ORIGIN_VERIFY_ENFORCE).toBe(false);
    expect(env.ORIGIN_VERIFY_SECRET).toBeUndefined();
  });

  it("coerces ORIGIN_VERIFY_ENFORCE='true' to a real boolean", () => {
    process.env.ORIGIN_VERIFY_ENFORCE = "true";
    process.env.ORIGIN_VERIFY_SECRET = "token";
    const env = validateEnv();
    expect(env.ORIGIN_VERIFY_ENFORCE).toBe(true);
  });

  it("permits enforce=false with a secret present (permissive/log-only mode)", () => {
    process.env.ORIGIN_VERIFY_SECRET = "token";
    const env = validateEnv();
    expect(env.ORIGIN_VERIFY_ENFORCE).toBe(false);
    expect(env.ORIGIN_VERIFY_SECRET).toBe("token");
  });
});

// APIC-004: DATABASE_SSL / DATABASE_SSL_CA / GEO_PDF_JOB_ID were consumed but
// absent from the schema, so nothing validated them. DATABASE_SSL is an exact
// "disable" compare in services/prisma.ts — a near-miss value used to leave
// verified TLS on and surface as an opaque pg_hba error.
describe("TLS + worker env vars are in the schema", () => {
  it("accepts DATABASE_SSL=disable and the CA path", () => {
    process.env.DATABASE_SSL = "disable";
    process.env.DATABASE_SSL_CA = "/app/rds-ca.pem";
    process.env.GEO_PDF_JOB_ID = "job-1";
    const env = validateEnv();
    expect(env.DATABASE_SSL).toBe("disable");
    expect(env.DATABASE_SSL_CA).toBe("/app/rds-ca.pem");
    expect(env.GEO_PDF_JOB_ID).toBe("job-1");
  });

  it("rejects a near-miss DATABASE_SSL value instead of silently ignoring it", () => {
    for (const bad of ["DISABLED", "false", "true", "require"]) {
      process.env.DATABASE_SSL = bad;
      expect(() => validateEnv()).toThrow(/process.exit\(1\)/);
    }
  });

  it("leaves all three optional", () => {
    expect(validateEnv().DATABASE_SSL).toBeUndefined();
  });
});

