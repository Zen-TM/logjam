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
});
