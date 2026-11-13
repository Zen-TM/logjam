import { describe, expect, it } from "vitest";
import { nonDevRuntime } from "./runtime";

const DEV = { NODE_ENV: "development", DB_HOST: "localhost" };

// Mutation that turns this red: drop one of the four signals from
// nonDevRuntime (a dev-only switch would then run in that runtime).
describe("nonDevRuntime", () => {
  it.each(["development", "test"])("is a dev runtime in NODE_ENV=%s", (env) => {
    expect(nonDevRuntime({ ...DEV, NODE_ENV: env }).nonDev).toBe(false);
  });

  it.each([
    [
      "a NODE_ENV that is neither development nor test",
      { NODE_ENV: "production" },
    ],
    ["no NODE_ENV", { NODE_ENV: undefined }],
    ["LOGJAM_RUNTIME=prod", { LOGJAM_RUNTIME: "prod" }],
    [
      "an ECS container",
      { ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4" },
    ],
    ["a Lambda", { AWS_LAMBDA_FUNCTION_NAME: "fn" }],
    ["an AWS execution env", { AWS_EXECUTION_ENV: "AWS_ECS_FARGATE" }],
    ["a non-local database", { DB_HOST: "db.example.com" }],
  ])("refuses %s", (_name, extra) => {
    expect(nonDevRuntime({ ...DEV, ...extra }).nonDev).toBe(true);
  });

  it("takes the local database hosts", () => {
    for (const DB_HOST of [
      "localhost",
      "127.0.0.1",
      "host.docker.internal",
      "postgres",
    ]) {
      expect(nonDevRuntime({ ...DEV, DB_HOST }).dbHostNonLocal).toBe(false);
    }
  });
});
