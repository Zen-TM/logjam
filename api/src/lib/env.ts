import { z } from "zod";

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  DATABASE_URL: z.string().url(),

  AUTH_MODE: z.enum(["fake", "cognito"]),
  FAKE_USER_SUB: z.string().optional(),
  COGNITO_REGION: z.string().optional(),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_APP_CLIENT_ID: z.string().optional(),

  AWS_REGION: z.string().default("ap-southeast-2"),
  AWS_ENDPOINT_URL: z.string().url().optional(),

  CORS_ORIGIN: z.string().optional(),

  S3_BUCKET_TOPO: z.string().optional(),
  S3_BUCKET_MEDIA: z.string().optional(),
  ECS_CLUSTER: z.string().default("logjam-cluster"),
  ECS_TOPO_TASK_DEF: z.string().default("logjam-topo-worker"),
  ECS_TOPO_EXPORT_TASK_DEF: z.string().default("logjam-topo-export-worker"),
  ECS_SUBNETS: z.string().optional(),
  ECS_SECURITY_GROUPS: z.string().optional(),
  TOPO_CDN_BASE_URL: z.string().url().optional(),

  SES_FROM_ADDRESS: z.string().optional(),

  // Stuck-topo-job reaper (ARCH-002). A job stuck in `pending` longer than the
  // PENDING timeout (task never placed / never started) or in `processing`
  // longer than the PROCESSING timeout (Fargate task SIGKILLed before its
  // Python `except` ran) is force-failed by the periodic sweep. Set
  // TOPO_REAPER_INTERVAL_MS to 0 to disable the sweep entirely.
  TOPO_REAPER_INTERVAL_MS: z.coerce.number().int().nonnegative().default(300_000), // 5 min
  TOPO_REAPER_PENDING_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000), // 15 min
  TOPO_REAPER_PROCESSING_TIMEOUT_MS: z.coerce.number().int().positive().default(10_800_000), // 3 h
});

type Env = z.infer<typeof baseSchema> & {
  ECS_SUBNETS_LIST: string[];
  ECS_SECURITY_GROUPS_LIST: string[];
  CORS_ORIGIN_LIST: string[];
};

const required = (key: keyof z.infer<typeof baseSchema>, val: unknown) =>
  val === undefined || val === "" ? key : null;

export function validateEnv(): Env {
  const parsed = baseSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    console.error(`Environment validation failed:\n${issues}`);
    process.exit(1);
  }

  const env = parsed.data;
  const missing: string[] = [];

  if (env.AUTH_MODE === "cognito") {
    const c1 = required("COGNITO_REGION", env.COGNITO_REGION);
    const c2 = required("COGNITO_USER_POOL_ID", env.COGNITO_USER_POOL_ID);
    const c3 = required("COGNITO_APP_CLIENT_ID", env.COGNITO_APP_CLIENT_ID);
    if (c1) missing.push(c1);
    if (c2) missing.push(c2);
    if (c3) missing.push(c3);
  }

  if (env.AUTH_MODE === "fake" && env.NODE_ENV === "production") {
    console.error("AUTH_MODE=fake is forbidden in production.");
    process.exit(1);
  }

  if (env.NODE_ENV === "production") {
    const prodRequired: Array<[keyof typeof env, unknown]> = [
      ["CORS_ORIGIN", env.CORS_ORIGIN],
      ["S3_BUCKET_TOPO", env.S3_BUCKET_TOPO],
      ["S3_BUCKET_MEDIA", env.S3_BUCKET_MEDIA],
      ["ECS_SUBNETS", env.ECS_SUBNETS],
      ["ECS_SECURITY_GROUPS", env.ECS_SECURITY_GROUPS],
      ["TOPO_CDN_BASE_URL", env.TOPO_CDN_BASE_URL],
    ];
    for (const [k, v] of prodRequired) {
      const m = required(k, v);
      if (m) missing.push(m);
    }
  }

  if (missing.length > 0) {
    console.error(
      `Missing required environment variables for NODE_ENV=${env.NODE_ENV}, AUTH_MODE=${env.AUTH_MODE}:\n${missing.map((k) => `  - ${k}`).join("\n")}`,
    );
    process.exit(1);
  }

  const corsList = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
    : env.AUTH_MODE === "fake"
      ? ["http://localhost:5173", "http://127.0.0.1:5173"]
      : [];

  return {
    ...env,
    ECS_SUBNETS_LIST: env.ECS_SUBNETS
      ? env.ECS_SUBNETS.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    ECS_SECURITY_GROUPS_LIST: env.ECS_SECURITY_GROUPS
      ? env.ECS_SECURITY_GROUPS.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    CORS_ORIGIN_LIST: corsList,
  };
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) cached = validateEnv();
  return cached;
}
