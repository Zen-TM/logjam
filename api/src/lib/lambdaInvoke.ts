import { InvokeCommand, InvocationType } from "@aws-sdk/client-lambda";
import { lambda } from "../services/awsClients";
import { getEnv } from "./env";

// GeoPDF Lambda launch helper — the Lambda counterpart to ecsRunTask.ts.
// POST /geo-pdf async-invokes the render Lambda (api/src/worker/geoPdfLambda.ts)
// instead of launching a Fargate task. The job's lifecycle/retry semantics
// still live in the GeoPdfJob status column (no SQS), exactly as with the
// Fargate worker — this helper only kicks off the render.

/**
 * Async-invoke the GeoPDF render Lambda for a job.
 *
 * Uses InvocationType "Event" (fire-and-forget): the SDK call returns once the
 * request is *accepted* (HTTP 202), before the render runs. Async-side render
 * failures surface via the GeoPdfJob status column (the Lambda's terminal write
 * mirrors the Fargate worker), not this call. The SDK call still throws on
 * synchronous failures — throttling, function-not-found, permission denied — so
 * the caller can force-fail the job row the same way it does for a Fargate
 * placement failure (ARCH-002), never stranding it in `queued`.
 *
 * A non-2xx StatusCode is treated as a failure even though the SDK does not
 * throw on it (mirrors ecsRunTask's failures[] check).
 */
export async function invokeGeoPdfLambda(jobId: string): Promise<void> {
  const env = getEnv();
  if (!env.LAMBDA_GEO_PDF_FUNCTION) {
    throw new Error("LAMBDA_GEO_PDF_FUNCTION is not configured");
  }

  const result = await lambda.send(
    new InvokeCommand({
      FunctionName: env.LAMBDA_GEO_PDF_FUNCTION,
      InvocationType: InvocationType.Event,
      Payload: Buffer.from(JSON.stringify({ GEO_PDF_JOB_ID: jobId })),
    }),
  );

  // Event invokes return 202 on accept. Anything else (or a FunctionError on
  // the rare synchronous validation path) means the invoke was not accepted.
  if (result.StatusCode !== 202 || result.FunctionError) {
    throw new Error(
      `GeoPDF Lambda invoke not accepted: status=${result.StatusCode ?? "none"}${
        result.FunctionError ? ` functionError=${result.FunctionError}` : ""
      }`,
    );
  }
}
