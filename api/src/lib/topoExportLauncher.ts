import { say } from "@logjam/shared";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getEnv } from "./env";
import { launchFargateTask } from "./ecsRunTask";
import { logger } from "./logger";
import { estimateExportSeconds } from "./runtimeEstimates";
import { assertHasCredits } from "./computeCredits";
import { assertGlobalCapacity } from "./fargateCapacity";
import type {
  AreaBbox,
  ExportFormat,
  ExportBundling,
  TopoLayerKey,
} from "@logjam/shared";

// Cap to prevent users from flooding ECS with queued exports.
export const MAX_QUEUED_PER_USER = 5;

// Exports are not charged to storage, so this is what bounds the files one
// user holds at a time (they expire in 7 days).
export const MAX_LIVE_PER_USER = 20;

export interface CreateAndLaunchExportInput {
  userId: string;
  sourceJobIds: string[];
  layers: readonly TopoLayerKey[] | readonly string[];
  format: ExportFormat;
  bundling: ExportBundling;
  vectorStyleSnapshot: object;
  sourceTileCount: number | null;
  /** The submitting user's monthly credit allowance, passed in because the
   * route has already loaded the user row. */
  monthlyComputeCredits: number;
  /** An export of an area: the box, with no source job. */
  bbox?: AreaBbox;
}

/**
 * Create a TopoExportJob and launch its Fargate task. The single owner of the
 * concurrency cap + ECS launch + ARN-persist + fail-on-launch sequence.
 *
 * - The cap check + create run in one user-row-locked transaction so concurrent
 *   submissions can't both pass the cap. Throws AppError(429) when at
 *   the cap.
 * - launchFargateTask throws on placement failure as well as SDK errors, so a
 *   launch problem can never strand the export in `queued`. On
 *   failure the row is force-failed and AppError(500) is thrown.
 * - Launch runs whenever ECS_SUBNETS is set — including local dev, where
 *   MiniStack's RunTask spawns the worker container (dummy subnets in
 *   .env.local flip this on). An empty subnet list disables the launch.
 *
 * Returns the created export job id.
 */
export async function createAndLaunchTopoExport(
  input: CreateAndLaunchExportInput,
): Promise<string> {
  const env = getEnv();

  // Computed before the transaction — it's a read-only history query and must
  // not hold the user-row lock below.
  const estimatedSeconds = await estimateExportSeconds(
    input.format,
    input.bundling,
    input.sourceTileCount,
  );

  // Account-wide capacity before anything is persisted, so a refusal leaves no
  // row behind for the reaper to clean up.
  await assertGlobalCapacity("topoExport");

  const exportJob = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
    // Monthly allowance, inside the same user-row lock as the concurrency cap
    // so concurrent submissions serialise against one another.
    await assertHasCredits(
      { id: input.userId, monthlyComputeCredits: input.monthlyComputeCredits },
      "topoExport",
      estimatedSeconds,
      tx,
    );
    const queued = await tx.topoExportJob.count({
      where: { userId: input.userId, status: { in: ["queued", "running"] } },
    });
    if (queued >= MAX_QUEUED_PER_USER) {
      throw new AppError(
        429,
        say`You can run ${MAX_QUEUED_PER_USER} exports at a time. Wait for one to finish.`,
      );
    }
    const live = await tx.topoExportJob.count({
      where: { userId: input.userId, status: { not: "failed" } },
    });
    if (live >= MAX_LIVE_PER_USER) {
      throw new AppError(
        429,
        say`You have ${MAX_LIVE_PER_USER} exports already. They are deleted after 7 days, so try again once one expires.`,
      );
    }
    return tx.topoExportJob.create({
      data: {
        userId: input.userId,
        sourceJobIds: input.sourceJobIds,
        layers: [...input.layers],
        format: input.format,
        bundling: input.bundling,
        vectorStyleSnapshot: input.vectorStyleSnapshot,
        sourceTileCount: input.sourceTileCount,
        bbox: input.bbox,
        estimatedSeconds,
        status: "queued",
      },
    });
  });

  if (env.ECS_SUBNETS_LIST.length) {
    try {
      const taskArn = await launchFargateTask({
        taskDefinition: env.ECS_TOPO_EXPORT_TASK_DEF,
        containerName: "topo-export-worker",
        environment: [{ name: "EXPORT_JOB_ID", value: exportJob.id }],
      });
      // Persist the ARN so the reaper can StopTask it.
      await prisma.topoExportJob.update({
        where: { id: exportJob.id },
        data: { ecsTaskArn: taskArn },
      });
    } catch (launchErr) {
      logger.error(
        { exportJobId: exportJob.id, reason: String(launchErr) },
        "topo_export_runtask_failed",
      );
      await prisma.topoExportJob.update({
        where: { id: exportJob.id },
        data: {
          status: "failed",
          errorMessage: say`Couldn't start this export. Try again.`,
        },
      });
      throw new AppError(500, say`Couldn't start that export. Try again.`);
    }
  }

  return exportJob.id;
}
