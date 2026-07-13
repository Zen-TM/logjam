import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getEnv } from "./env";
import { launchFargateTask } from "./ecsRunTask";
import { logger } from "./logger";
import { estimateExportSeconds } from "./runtimeEstimates";
import type { ExportFormat, ExportBundling, TopoLayerKey } from "@logjam/shared";

// Cap to prevent users from flooding ECS with queued exports. Shared by the
// manual export route (POST /topo-exports) and the reaper's auto-export pass so
// both enforce one limit.
export const MAX_QUEUED_PER_USER = 5;

export interface CreateAndLaunchExportInput {
  userId: string;
  sourceJobIds: string[];
  layers: TopoLayerKey[];
  format: ExportFormat;
  bundling: ExportBundling;
  vectorStyleSnapshot: object;
  sourceTileCount: number | null;
}

/**
 * Create a TopoExportJob and launch its Fargate task. The single owner of the
 * concurrency cap + ECS launch + ARN-persist + fail-on-launch sequence, so the
 * manual route and the reaper's auto-export pass behave identically.
 *
 * - The cap check + create run in one user-row-locked transaction so concurrent
 *   submissions can't both pass the cap (ARCH-009). Throws AppError(429) when at
 *   the cap.
 * - launchFargateTask throws on placement failure as well as SDK errors, so a
 *   launch problem can never strand the export in `queued` (ARCH-002). On
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

  const exportJob = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
    const queued = await tx.topoExportJob.count({
      where: { userId: input.userId, status: { in: ["queued", "running"] } },
    });
    if (queued >= MAX_QUEUED_PER_USER) {
      throw new AppError(429, `Too many concurrent exports (limit ${MAX_QUEUED_PER_USER})`);
    }
    return tx.topoExportJob.create({
      data: {
        userId: input.userId,
        sourceJobIds: input.sourceJobIds,
        layers: input.layers as string[],
        format: input.format,
        bundling: input.bundling,
        vectorStyleSnapshot: input.vectorStyleSnapshot,
        sourceTileCount: input.sourceTileCount,
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
      // Persist the ARN (Design L2) so the reaper can StopTask it.
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
        data: { status: "failed", errorMessage: "Failed to launch export task." },
      });
      throw new AppError(500, "Failed to launch export job");
    }
  }

  return exportJob.id;
}
