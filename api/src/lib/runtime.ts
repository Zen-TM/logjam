// What a dev-only switch (fake auth, simulated regions) refuses to run in.
// Reads the env it is given, so the unit test needs no real runtime.
// Four independent signals, any one sufficient to refuse:
//   1. NODE_ENV is not "development" or "test"
//   2. AWS runtime env vars present (ECS and Lambda inject these)
//   3. DB_HOST points to a non-local host
//   4. LOGJAM_RUNTIME=prod, which a host with no AWS-injected variables (a
//      plain Docker Compose host) sets itself
// Guard: lib/runtime.unit.test.ts.
/** The variables read; `process.env` has them all, and `getEnv()` drops the AWS ones. */
export type RuntimeEnv = {
  NODE_ENV?: string;
  DB_HOST?: string;
  LOGJAM_RUNTIME?: string;
  AWS_EXECUTION_ENV?: string;
  ECS_CONTAINER_METADATA_URI_V4?: string;
  AWS_LAMBDA_FUNCTION_NAME?: string;
};

export function nonDevRuntime(env: RuntimeEnv): {
  nonDev: boolean;
  looksProd: boolean;
  hasAwsRuntime: boolean;
  dbHostNonLocal: boolean;
} {
  const looksProd = env.NODE_ENV !== "development" && env.NODE_ENV !== "test";
  const hasAwsRuntime =
    env.LOGJAM_RUNTIME === "prod" ||
    Boolean(env.AWS_EXECUTION_ENV) ||
    Boolean(env.ECS_CONTAINER_METADATA_URI_V4) ||
    Boolean(env.AWS_LAMBDA_FUNCTION_NAME);
  const dbHost = env.DB_HOST ?? "";
  const dbHostNonLocal =
    dbHost !== "" &&
    !/^(localhost|127\.0\.0\.1|host\.docker\.internal|postgres)$/.test(dbHost);
  return {
    nonDev: looksProd || hasAwsRuntime || dbHostNonLocal,
    looksProd,
    hasAwsRuntime,
    dbHostNonLocal,
  };
}
