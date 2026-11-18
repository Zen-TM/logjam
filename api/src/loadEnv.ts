// The first import of index.ts. It loads the env file and then turns the
// simulated regions on, and it must run before anything loads
// `@logjam/shared`, which reads the switch once, when it loads. Guard:
// loadEnv.unit.test.ts (index.ts's first import, and nothing this file loads
// reaches shared).
import dotenv from "dotenv";
import path from "path";
import { nonDevRuntime } from "./lib/runtime";

// Local dev (run from api/ via `npm run dev`) loads the Terraform-generated root
// .env.local — the single source of dev env (infra/terraform/envs/local). In
// production NODE_ENV is already set by the container's environment, so env comes
// from there and we skip the file (dotenv.config() is a harmless no-op if absent).
if (process.env.NODE_ENV === "production") {
  dotenv.config();
} else {
  dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
}

// SIM_REGIONS=1 adds the simulated regions of shared/src/simRegions.ts. A prod
// runtime refuses it at start instead of serving regions that have no data
// (guard: lib/runtime.unit.test.ts, loadEnv.unit.test.ts).
if (process.env.SIM_REGIONS === "1") {
  const runtime = nonDevRuntime(process.env);
  if (runtime.nonDev) {
    throw new Error(
      `SIM_REGIONS=1 refused: detected non-dev runtime ` +
        `(NODE_ENV=${process.env.NODE_ENV}, awsRuntime=${runtime.hasAwsRuntime}, dbHostNonLocal=${runtime.dbHostNonLocal})`,
    );
  }
  (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS = true;
}
