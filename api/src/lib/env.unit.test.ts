import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
  code?: number,
) => {
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

describe("the local template", () => {
  // Mutation: deleting the DB_NAME line from env.local.tftpl, or adding a
  // variable with no default to the schema and not to the template.
  it("sets every variable the schema has no default for", () => {
    setEnv({});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => validateEnv()).toThrow(/process\.exit/);
    const report = String(errors.mock.calls[0]?.[0]);
    errors.mockRestore();
    const needed = [...report.matchAll(/^ {2}- (\w+):/gm)].map((m) => m[1]);
    const template = readFileSync(
      join(
        import.meta.dirname,
        "../../../infra/terraform/templates/env.local.tftpl",
      ),
      "utf8",
    );
    const set = [...template.matchAll(/^(\w+)=/gm)].map((m) => m[1]);
    expect(needed).toContain("DB_NAME");
    expect(needed.filter((key) => !set.includes(key))).toEqual([]);
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

  it("exits when AUTH_MODE=oidc is missing its provider vars", () => {
    process.env.AUTH_MODE = "oidc";
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

// DATABASE_SSL / DATABASE_SSL_CA are read outside getEnv() but
// declared in the schema so boot validates them. DATABASE_SSL is an exact
// "disable" compare in services/prisma.ts — a near-miss value would leave
// verified TLS on and surface as an opaque pg_hba error.
describe("TLS env vars are in the schema", () => {
  it("accepts DATABASE_SSL=disable and the CA path", () => {
    process.env.DATABASE_SSL = "disable";
    process.env.DATABASE_SSL_CA = "/app/rds-ca.pem";
    const env = validateEnv();
    expect(env.DATABASE_SSL).toBe("disable");
    expect(env.DATABASE_SSL_CA).toBe("/app/rds-ca.pem");
  });

  it("rejects a near-miss DATABASE_SSL value instead of silently ignoring it", () => {
    for (const bad of ["DISABLED", "false", "true", "require"]) {
      process.env.DATABASE_SSL = bad;
      expect(() => validateEnv()).toThrow(/process.exit\(1\)/);
    }
  });

  // Mutation: delete the DATABASE_SSL production check in validateEnv.
  it("refuses DATABASE_SSL=disable in production, where it would drop RDS TLS", () => {
    setEnv({
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      OIDC_ISSUER: "https://idp.example.com",
      OIDC_AUDIENCE: "c",
      DB_HOST: "db",
      DB_NAME: "db",
      DB_USER: "u",
      DB_PASSWORD: "p",
      CORS_ORIGIN: "http://x",
      S3_BUCKET_TOPO: "t",
      S3_BUCKET_MEDIA: "m",
      ECS_SUBNETS: "s",
      ECS_SECURITY_GROUPS: "g",
      TOPO_CDN_BASE_URL: "https://cdn.example.com",
    });
    expect(() => validateEnv()).not.toThrow();
    process.env.DATABASE_SSL = "disable";
    expect(() => validateEnv()).toThrow(/process\.exit\(1\)/);
  });

  it("boots with any GIT_SHA, including the empty one a build without the arg bakes in", () => {
    for (const sha of ["", "not-a-sha", "0123abc"]) {
      process.env.GIT_SHA = sha;
      expect(validateEnv().GIT_SHA).toBe(sha);
    }
  });

  it("leaves all three optional", () => {
    expect(validateEnv().DATABASE_SSL).toBeUndefined();
  });
});

// Mutation: drop the OIDC_ISSUER / OIDC_AUDIENCE requirement or the https
// check in validateEnv, and a real-auth process boots unable to verify (or
// verifying over plain http in production).
describe("OIDC token verification config", () => {
  const base = {
    NODE_ENV: "development",
    DB_HOST: "localhost",
    DB_NAME: "db",
    DB_USER: "u",
    DB_PASSWORD: "p",
    OIDC_ISSUER: "http://localhost:9000",
    OIDC_AUDIENCE: "a, b",
  };

  it("accepts AUTH_MODE=oidc and parses the audience list", () => {
    setEnv({ ...base, AUTH_MODE: "oidc" });
    expect(validateEnv().OIDC_AUDIENCE_LIST).toEqual(["a", "b"]);
  });

  it("requires the issuer", () => {
    setEnv({ ...base, AUTH_MODE: "oidc", OIDC_ISSUER: undefined });
    expect(() => validateEnv()).toThrow(/process\.exit\(1\)/);
  });

  it("requires the audience", () => {
    setEnv({ ...base, AUTH_MODE: "oidc", OIDC_AUDIENCE: undefined });
    expect(() => validateEnv()).toThrow(/process\.exit\(1\)/);
  });

  it("fails on an audience that is empty after parsing", () => {
    setEnv({ ...base, AUTH_MODE: "oidc", OIDC_AUDIENCE: " , ," });
    expect(() => validateEnv()).toThrow(/process\.exit\(1\)/);
  });

  it("needs neither in fake mode", () => {
    setEnv({
      ...base,
      AUTH_MODE: "fake",
      OIDC_ISSUER: undefined,
      OIDC_AUDIENCE: undefined,
    });
    expect(validateEnv().OIDC_AUDIENCE_LIST).toEqual([]);
  });

  it("refuses an http issuer in production only", () => {
    const prod = {
      ...base,
      AUTH_MODE: "oidc",
      NODE_ENV: "production",
      CORS_ORIGIN: "http://x",
      S3_BUCKET_TOPO: "t",
      S3_BUCKET_MEDIA: "m",
      ECS_SUBNETS: "s",
      ECS_SECURITY_GROUPS: "g",
      TOPO_CDN_BASE_URL: "https://cdn.example.com",
    };
    setEnv(prod);
    expect(() => validateEnv()).toThrow(/process\.exit\(1\)/);
    setEnv({ ...prod, OIDC_ISSUER: "https://idp.example.com" });
    expect(() => validateEnv()).not.toThrow();
  });
});
