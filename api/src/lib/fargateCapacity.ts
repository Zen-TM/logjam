import prisma from "../services/prisma";
import { WORKER_SPECS, type WorkerKind } from "@logjam/shared";
import { AppError } from "../middleware/errorHandler";
import { getEnv } from "./env";
import { logger } from "./logger";
import type { DbClient } from "./storageQuota";

/**
 * Account-wide ceiling on concurrently running worker vCPUs.
 *
 * The per-user credit allowance limits what any ONE account can spend over a
 * month; it does nothing about many accounts (or many jobs from one account
 * inside a single minute) all launching at once. Cognito self-signup is open,
 * so "many accounts" is not hypothetical.
 *
 * Measured in vCPUs rather than tasks because the workers are not
 * interchangeable — three topo tasks (8 vCPU each) cost as much as
 * twenty-four GeoPDF tasks, and a task-count cap would treat them the same.
 *
 * The AWS Fargate On-Demand vCPU service quota (30 in ap-southeast-2) is the
 * real backstop, but it is the WRONG tool to tune: exceeding it makes RunTask
 * return a placement failure, which this codebase correctly treats as a job
 * failure (ARCH-002) — so the account quota converts excess load into failed
 * user jobs. Lowering it also needs an AWS support request. This cap sits
 * below it and converts excess load into a retryable 429 instead.
 */

/** Counted from the DB, not from ECS: the job rows are the source of truth the
 * reaper already keeps honest, and ListTasks would need a DescribeTasks per
 * task to recover each one's size. */
const IN_FLIGHT_STATUSES = {
  topo: ["pending", "processing"],
  topoExport: ["queued", "running"],
  geoPdf: ["queued", "running"],
} as const;

export async function getInFlightVcpus(db: DbClient = prisma): Promise<number> {
  const [topo, topoExport, geoPdf] = await Promise.all([
    db.topoJob.count({ where: { status: { in: [...IN_FLIGHT_STATUSES.topo] } } }),
    db.topoExportJob.count({
      where: { status: { in: [...IN_FLIGHT_STATUSES.topoExport] } },
    }),
    db.geoPdfJob.count({ where: { status: { in: [...IN_FLIGHT_STATUSES.geoPdf] } } }),
  ]);

  return (
    topo * WORKER_SPECS.topo.vcpus +
    topoExport * WORKER_SPECS.topoExport.vcpus +
    geoPdf * WORKER_SPECS.geoPdf.vcpus
  );
}

/**
 * Throws 429 when launching a `kind` worker would push the account past the
 * concurrent-vCPU ceiling.
 *
 * 503 would arguably fit better, but 429 is what every other capacity refusal
 * in this API returns and the clients already treat it as "retryable, show the
 * message" — a second status for the same user-visible situation would just be
 * a second code path to get wrong.
 */
export async function assertGlobalCapacity(
  kind: WorkerKind,
  db: DbClient = prisma,
): Promise<void> {
  const ceiling = getEnv().MAX_CONCURRENT_WORKER_VCPUS;
  // 0 = disabled. Checked before the query so a disabled cap costs nothing.
  if (ceiling === 0) return;

  const inFlight = await getInFlightVcpus(db);
  const requested = WORKER_SPECS[kind].vcpus;

  if (inFlight + requested > ceiling) {
    // Worth a log line: unlike a per-user refusal this one says something about
    // the whole system, and if it fires regularly the ceiling (or the account
    // quota behind it) is the thing to revisit. No user id — this is a
    // system-capacity event, and the caller already logs its own context.
    logger.warn({ kind, inFlight, requested, ceiling }, "fargate_capacity_reached");
    throw new AppError(
      429,
      "The system is at capacity right now. Please try again in a few minutes.",
    );
  }
}
