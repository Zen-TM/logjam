// geoPdfLambda.ts
// ---------------
// AWS Lambda entrypoint for GeoPDF rendering. Thin wrapper over the shared
// processGeoPdfJob() lifecycle in geoPdfWorker.ts — all the claim/render/
// terminal-write/notify invariants (Design L1, ARCH-003, privacy rule) live
// there, not here. Async-invoked ("Event") by POST /geo-pdf via
// api/src/lib/lambdaInvoke.ts with payload { GEO_PDF_JOB_ID }.
//
// Container-image Lambda reusing the logjam-api image; the handler path is set
// via image_config.command (see infra/terraform/envs/prod/lambda.tf).
//
// DB credentials: unlike the Fargate worker (ECS secrets injection), Lambda
// resolves DB_USER/DB_PASSWORD from DB_SECRET_ID at startup. This MUST happen
// before geoPdfWorker.ts (→ prisma.ts → lib/databaseUrl.ts, which throws if
// either is unset) is imported — hence the deferred dynamic import below rather
// than a static top-of-file import. Required env otherwise matches the Fargate
// worker: S3_BUCKET_TOPO, AWS_REGION, TOPO_CDN_BASE_URL, DB_HOST/DB_PORT/DB_NAME,
// AUTH_MODE + COGNITO_* (getEnv validates them).

import { resolveDbCredentials } from "../lib/resolveDbCredentials";

// NB: nothing here may statically import a module that calls getEnv() at load
// time (e.g. lib/logger, services/prisma) — getEnv()/validateEnv() requires
// DB_USER/DB_PASSWORD, which aren't in env until resolveDbCredentials() runs.
// The worker (and its logger/Prisma) is therefore loaded via the deferred
// dynamic import below, AFTER credentials are resolved. The pre-resolution
// misconfig path uses console directly.

// Cached across warm invocations: resolve credentials + load the worker module
// (and its Prisma singleton) once, then reuse.
let cachedProcessor: ((jobId: string) => Promise<number>) | null = null;

async function getProcessor(): Promise<(jobId: string) => Promise<number>> {
  if (!cachedProcessor) {
    await resolveDbCredentials();
    const mod = await import("./geoPdfWorker");
    cachedProcessor = mod.processGeoPdfJob;
  }
  return cachedProcessor;
}

interface GeoPdfLambdaEvent {
  GEO_PDF_JOB_ID?: string;
}

/**
 * Lambda handler. Renders one GeoPdfJob then returns. Does NOT process.exit or
 * prisma.$disconnect — the Prisma singleton is kept warm across container
 * reuse. The job's status column is the source of truth for success/failure;
 * the "Event" invoke discards this return value.
 */
export async function handler(event: GeoPdfLambdaEvent): Promise<void> {
  const jobId = event?.GEO_PDF_JOB_ID;
  if (!jobId) {
    console.error(JSON.stringify({ event: "geo_pdf_lambda_missing_job_id" }));
    // Throw so the failure is visible in CloudWatch / async dead-letter; this
    // is a misconfiguration (route always sends the ID), not a render outcome.
    throw new Error("GEO_PDF_JOB_ID missing from Lambda event");
  }
  const processGeoPdfJob = await getProcessor();
  await processGeoPdfJob(jobId);
}
