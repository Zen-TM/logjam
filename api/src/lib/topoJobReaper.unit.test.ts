import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    topoJob: { updateMany: vi.fn(), findMany: vi.fn() },
    topoExportJob: { updateMany: vi.fn(), findMany: vi.fn() },
    geoPdfJob: { updateMany: vi.fn(), findMany: vi.fn() },
    notification: { create: vi.fn(), createMany: vi.fn() },
    deviceToken: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../services/awsClients", () => ({
  ecs: { send: vi.fn() },
  s3: { send: vi.fn() },
}));

vi.mock("./topoExportLauncher", () => ({
  createAndLaunchTopoExport: vi.fn(),
}));

vi.mock("../services/email", () => ({ sendEmail: vi.fn() }));

import prisma from "../services/prisma";
import { ecs, s3 } from "../services/awsClients";
import {
  reapStuckTopoJobs,
  expireCompletedExports,
  expireCompletedGeoPdfJobs,
  progressStallDeadline,
  absoluteProcessingDeadline,
  isProcessingDead,
  queueAutoExports,
  exportableLayers,
  ESTIMATE_SAFETY_FACTOR,
} from "./topoJobReaper";
import { createAndLaunchTopoExport } from "./topoExportLauncher";
import { sendEmail } from "../services/email";
import { AppError } from "../middleware/errorHandler";
import { AUTO_EXPORT_DEFAULTS } from "@logjam/shared";
import { getEnv } from "./env";

const jobUpdateMany = (prisma as unknown as { topoJob: { updateMany: Mock } })
  .topoJob.updateMany;
const jobFindMany = (prisma as unknown as { topoJob: { findMany: Mock } })
  .topoJob.findMany;
const exportUpdateMany = (
  prisma as unknown as { topoExportJob: { updateMany: Mock } }
).topoExportJob.updateMany;
const exportFindMany = (
  prisma as unknown as { topoExportJob: { findMany: Mock } }
).topoExportJob.findMany;
const geoPdfUpdateMany = (
  prisma as unknown as { geoPdfJob: { updateMany: Mock } }
).geoPdfJob.updateMany;
const geoPdfFindMany = (
  prisma as unknown as { geoPdfJob: { findMany: Mock } }
).geoPdfJob.findMany;
const ecsSend = (ecs as unknown as { send: Mock }).send;
const s3Send = (s3 as unknown as { send: Mock }).send;
const transaction = (prisma as unknown as { $transaction: Mock }).$transaction;
const notificationCreate = (
  prisma as unknown as { notification: { create: Mock } }
).notification.create;
const notificationCreateMany = (
  prisma as unknown as { notification: { createMany: Mock } }
).notification.createMany;
const deviceTokenFindMany = (
  prisma as unknown as { deviceToken: { findMany: Mock } }
).deviceToken.findMany;
const userFindMany = (prisma as unknown as { user: { findMany: Mock } }).user
  .findMany;
const emailSend = sendEmail as unknown as Mock;

/**
 * reapStuckTopoJobs reads the overdue rows first (an updateMany reports a
 * count, not rows, so there would otherwise be nobody to notify), then claims
 * each row with its own status-guarded updateMany — `count === 1` means THIS
 * pass won the flip and owes the owner a notification (APIC-005). Stage rows by
 * the status each read asks for instead of by call order.
 */
function stageByStatus(mock: Mock, rowsByStatus: Record<string, unknown[]>) {
  mock.mockImplementation(async (args: { where?: { status?: string } }) => {
    const status = args?.where?.status ?? "";
    return rowsByStatus[status] ?? [];
  });
}
const launchExport = createAndLaunchTopoExport as unknown as Mock;

// Transaction client handed to the expiry sweep's interactive callback.
const txExportDelete = vi.fn();
const txGeoPdfDelete = vi.fn();
const txExecuteRaw = vi.fn();
const txShareDeleteMany = vi.fn();
const txClient = {
  $executeRaw: txExecuteRaw,
  topoExportJob: { delete: txExportDelete },
  geoPdfJob: { delete: txGeoPdfDelete },
  share: { deleteMany: txShareDeleteMany },
};

const NOW = new Date("2026-06-05T12:00:00.000Z");
const env = getEnv();

beforeEach(() => {
  jobUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  jobFindMany.mockReset().mockResolvedValue([]);
  exportUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  exportFindMany.mockReset().mockResolvedValue([]);
  geoPdfUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  geoPdfFindMany.mockReset().mockResolvedValue([]);
  ecsSend.mockReset().mockResolvedValue({});
  s3Send.mockReset().mockResolvedValue({});
  txExportDelete.mockReset().mockResolvedValue({});
  txGeoPdfDelete.mockReset().mockResolvedValue({});
  txExecuteRaw.mockReset().mockResolvedValue(1);
  txShareDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  notificationCreate.mockReset().mockResolvedValue({});
  notificationCreateMany.mockReset().mockResolvedValue({ count: 0 });
  deviceTokenFindMany.mockReset().mockResolvedValue([]);
  userFindMany.mockReset().mockResolvedValue([]);
  emailSend.mockReset().mockResolvedValue(undefined);
  launchExport.mockReset().mockResolvedValue("export-id");
  transaction
    .mockReset()
    .mockImplementation(async (fn: (tx: typeof txClient) => Promise<unknown>) =>
      fn(txClient),
    );
});

// ── stall + ceiling deadlines (pure, ARCH-001) ──────────────────────────────

describe("progressStallDeadline", () => {
  const stallMs = env.TOPO_REAPER_PROGRESS_STALL_MS;
  const startedAt = new Date("2026-06-05T00:00:00.000Z");
  const updatedAt = new Date("2026-06-05T01:00:00.000Z");
  const lastProgressAt = new Date("2026-06-05T11:55:00.000Z");

  it("anchors on lastProgressAt when present", () => {
    expect(
      progressStallDeadline({ startedAt, updatedAt, lastProgressAt }, stallMs),
    ).toEqual(new Date(lastProgressAt.getTime() + stallMs));
  });

  it("falls back to startedAt before the first heartbeat", () => {
    expect(
      progressStallDeadline({ startedAt, updatedAt, lastProgressAt: null }, stallMs),
    ).toEqual(new Date(startedAt.getTime() + stallMs));
  });

  it("falls back to updatedAt when startedAt is also null", () => {
    expect(
      progressStallDeadline(
        { startedAt: null, updatedAt, lastProgressAt: null },
        stallMs,
      ),
    ).toEqual(new Date(updatedAt.getTime() + stallMs));
  });
});

describe("absoluteProcessingDeadline", () => {
  const ceilingMs = env.TOPO_REAPER_PROCESSING_TIMEOUT_MS; // 6 h default
  const startedAt = new Date("2026-06-05T00:00:00.000Z");
  const updatedAt = new Date("2026-06-05T01:00:00.000Z");

  it("uses the ceiling when estimatedSeconds is null", () => {
    expect(
      absoluteProcessingDeadline(
        { startedAt, updatedAt, estimatedSeconds: null },
        ceilingMs,
      ),
    ).toEqual(new Date(startedAt.getTime() + ceilingMs));
  });

  it("extends past the ceiling when 2× estimate is larger", () => {
    const estimatedSeconds = Math.round(2000 * 8.5) * 60; // huge → 2× ≫ 6 h
    const deadline = absoluteProcessingDeadline(
      { startedAt, updatedAt, estimatedSeconds },
      ceilingMs,
    );
    expect(deadline).toEqual(
      new Date(startedAt.getTime() + ESTIMATE_SAFETY_FACTOR * estimatedSeconds * 1000),
    );
    expect(deadline.getTime()).toBeGreaterThan(startedAt.getTime() + ceilingMs);
  });
});

describe("isProcessingDead", () => {
  const stallMs = env.TOPO_REAPER_PROGRESS_STALL_MS;
  const ceilingMs = env.TOPO_REAPER_PROCESSING_TIMEOUT_MS;
  const now = new Date("2026-06-05T12:00:00.000Z");

  it("Sunnyside: a 4 h render with fresh progress survives", () => {
    const startedAt = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const job = {
      startedAt,
      updatedAt: startedAt,
      lastProgressAt: new Date(now.getTime() - 60_000), // 1 min ago
      estimatedSeconds: Math.round(12 * 8.5) * 60,
    };
    expect(isProcessingDead(job, now, stallMs, ceilingMs)).toBe(false);
  });

  it("a hung job (no progress for 25 min) is dead", () => {
    const startedAt = new Date(now.getTime() - 60 * 60 * 1000);
    const job = {
      startedAt,
      updatedAt: startedAt,
      lastProgressAt: new Date(now.getTime() - 25 * 60 * 1000),
      estimatedSeconds: null,
    };
    expect(isProcessingDead(job, now, stallMs, ceilingMs)).toBe(true);
  });

  it("a job stuck pre-render past the stall window (no heartbeat yet) is dead", () => {
    const startedAt = new Date(now.getTime() - 30 * 60 * 1000); // 30 min, no progress
    const job = {
      startedAt,
      updatedAt: startedAt,
      lastProgressAt: null,
      estimatedSeconds: null,
    };
    expect(isProcessingDead(job, now, stallMs, ceilingMs)).toBe(true);
  });

  it("eternal progress past the absolute ceiling is dead", () => {
    const startedAt = new Date(now.getTime() - 7 * 60 * 60 * 1000); // 7 h > 6 h ceiling
    const job = {
      startedAt,
      updatedAt: startedAt,
      lastProgressAt: new Date(now.getTime() - 60_000), // fresh, but ceiling wins
      estimatedSeconds: null,
    };
    expect(isProcessingDead(job, now, stallMs, ceilingMs)).toBe(true);
  });
});

// ── reapStuckTopoJobs sweeps ─────────────────────────────────────────────────

describe("reapStuckTopoJobs — topo_jobs", () => {
  it("anchors the pending cutoff on the pending timeout", async () => {
    stageByStatus(jobFindMany, { pending: [{ id: "p1", userId: "u1", name: null }] });
    jobUpdateMany.mockResolvedValue({ count: 1 });

    await reapStuckTopoJobs(NOW);

    const pendingRead = jobFindMany.mock.calls[0][0];
    expect(pendingRead.where.status).toBe("pending");
    expect(pendingRead.where.updatedAt.lt).toEqual(
      new Date(NOW.getTime() - env.TOPO_REAPER_PENDING_TIMEOUT_MS),
    );
    // The claim stays status-guarded: a job that left `pending` between the
    // read and the write must not be dragged back to failed.
    const pendingUpdate = jobUpdateMany.mock.calls[0][0];
    expect(pendingUpdate.where.status).toBe("pending");
    expect(pendingUpdate.where.id).toBe("p1");
    expect(pendingUpdate.data.status).toBe("failed");
  });

  it("pins the reaper messages to honest retry semantics (ARCH-008)", async () => {
    stageByStatus(jobFindMany, { pending: [{ id: "p1", userId: "u1", name: null }] });
    stageByStatus(exportFindMany, {
      queued: [{ id: "q1", userId: "u1", format: "geotiff" }],
    });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    exportUpdateMany.mockResolvedValue({ count: 1 });
    await reapStuckTopoJobs(NOW);
    expect(jobUpdateMany.mock.calls[0][0].data.errorMessage).toBe(
      "Processing timed out — the job did not complete in the expected time and was marked failed. Submit a new job to retry.",
    );
    expect(exportUpdateMany.mock.calls[0][0].data.errorMessage).toBe(
      "The export did not complete in the expected time and was marked failed. Submit a new export to retry.",
    );
  });

  it("reaps stalled processing jobs but spares ones still advancing, status-guarded", async () => {
    const stallMs = env.TOPO_REAPER_PROGRESS_STALL_MS;
    // No heartbeat for well past the stall window → stalled → reaped.
    const overdue = {
      id: "job-overdue",
      startedAt: new Date(NOW.getTime() - stallMs - 60_000),
      updatedAt: new Date(NOW.getTime() - stallMs - 60_000),
      lastProgressAt: new Date(NOW.getTime() - stallMs - 60_000),
      estimatedSeconds: null,
      ecsTaskArn: null,
    };
    // Running for hours but progress one minute ago → alive → must survive.
    const longButAlive = {
      id: "job-large",
      startedAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
      updatedAt: new Date(NOW.getTime() - 60_000),
      lastProgressAt: new Date(NOW.getTime() - 60_000),
      estimatedSeconds: Math.round(100 * 8.5) * 60,
      ecsTaskArn: "arn:task/large",
    };
    stageByStatus(jobFindMany, { processing: [overdue, longButAlive] });
    jobUpdateMany.mockResolvedValue({ count: 1 });

    await reapStuckTopoJobs(NOW);

    const processingUpdate = jobUpdateMany.mock.calls[0][0];
    // One claim, for the dead job only — the advancing one is never touched.
    expect(jobUpdateMany).toHaveBeenCalledTimes(1);
    expect(processingUpdate.where.id).toBe("job-overdue");
    expect(processingUpdate.where.status).toBe("processing");
    expect(processingUpdate.data.status).toBe("failed");
  });

  it("issues StopTask only for reaped jobs that have a task ARN", async () => {
    const old = new Date(
      NOW.getTime() - env.TOPO_REAPER_PROCESSING_TIMEOUT_MS - 60_000,
    );
    stageByStatus(jobFindMany, {
      processing: [
        { id: "j1", startedAt: old, updatedAt: old, estimatedSeconds: null, ecsTaskArn: "arn:task/j1" },
        { id: "j2", startedAt: old, updatedAt: old, estimatedSeconds: null, ecsTaskArn: null },
      ],
    });
    jobUpdateMany.mockResolvedValue({ count: 2 });

    await reapStuckTopoJobs(NOW);

    expect(ecsSend).toHaveBeenCalledTimes(1);
    expect(ecsSend.mock.calls[0][0].input).toMatchObject({ task: "arn:task/j1" });
  });

  it("a StopTask failure does not abort the sweep", async () => {
    const old = new Date(
      NOW.getTime() - env.TOPO_REAPER_PROCESSING_TIMEOUT_MS - 60_000,
    );
    stageByStatus(jobFindMany, {
      processing: [
        { id: "j1", startedAt: old, updatedAt: old, estimatedSeconds: null, ecsTaskArn: "arn:task/j1" },
      ],
    });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    ecsSend.mockRejectedValue(new Error("task already stopped"));

    await expect(reapStuckTopoJobs(NOW)).resolves.toBeGreaterThanOrEqual(1);
  });
});

describe("reapStuckTopoJobs — topo_export_jobs (ARCH-002)", () => {
  it("fails queued exports older than the queued timeout, anchored on createdAt", async () => {
    stageByStatus(exportFindMany, {
      queued: [{ id: "q1", userId: "u1", format: "geotiff" }],
    });
    exportUpdateMany.mockResolvedValue({ count: 1 });

    await reapStuckTopoJobs(NOW);

    const queuedRead = exportFindMany.mock.calls[0][0];
    expect(queuedRead.where.status).toBe("queued");
    expect(queuedRead.where.createdAt.lt).toEqual(
      new Date(NOW.getTime() - env.TOPO_REAPER_EXPORT_QUEUED_TIMEOUT_MS),
    );
    const queuedUpdate = exportUpdateMany.mock.calls[0][0];
    expect(queuedUpdate.where.status).toBe("queued");
    expect(queuedUpdate.where.id).toBe("q1");
    expect(queuedUpdate.data.status).toBe("failed");
  });

  it("selects running exports on startedAt with a createdAt fallback", async () => {
    await reapStuckTopoJobs(NOW);
    // calls[0] is the queued-id read; calls[1] is the running select.
    const runningWhere = exportFindMany.mock.calls[1][0].where;
    const cutoff = new Date(
      NOW.getTime() - env.TOPO_REAPER_EXPORT_RUNNING_TIMEOUT_MS,
    );
    expect(runningWhere.status).toBe("running");
    expect(runningWhere.OR).toEqual([
      { startedAt: { lt: cutoff } },
      { startedAt: null, createdAt: { lt: cutoff } },
    ]);
  });

  it("force-fails overdue running exports status-guarded and stops their tasks", async () => {
    stageByStatus(exportFindMany, {
      running: [
        { id: "e1", userId: "u1", format: "geotiff", ecsTaskArn: "arn:task/e1" },
        { id: "e2", userId: "u1", format: "geotiff", ecsTaskArn: null },
      ],
    });
    exportUpdateMany.mockResolvedValue({ count: 1 });

    const count = await reapStuckTopoJobs(NOW);

    expect(exportUpdateMany.mock.calls.map((call) => call[0].where.id)).toEqual([
      "e1",
      "e2",
    ]);
    const runningUpdate = exportUpdateMany.mock.calls[0][0];
    expect(runningUpdate.where.status).toBe("running");
    expect(ecsSend).toHaveBeenCalledTimes(1);
    expect(ecsSend.mock.calls[0][0].input).toMatchObject({ task: "arn:task/e1" });
    expect(count).toBe(2);
  });

  it("sums reap counts across all four sweeps", async () => {
    stageByStatus(jobFindMany, {
      pending: [
        { id: "p1", userId: "u1", name: null },
        { id: "p2", userId: "u1", name: null },
      ],
    });
    stageByStatus(exportFindMany, {
      queued: ["q1", "q2", "q3"].map((id) => ({ id, userId: "u1", format: "gpkg" })),
    });
    // Every claim wins → the count is the number of rows this pass claimed.
    jobUpdateMany.mockResolvedValue({ count: 1 });
    exportUpdateMany.mockResolvedValue({ count: 1 });
    // No processing/running rows → only pending (2) + queued (3).
    const count = await reapStuckTopoJobs(NOW);
    expect(count).toBe(5);
  });
});

// ── Legacy prod row shapes (gap 6) ──────────────────────────────────────────
// Rows created before the ecsTaskArn / startedAt columns existed carry NULLs
// there (migration 20260610135419 backfills nothing). The reaper unit tests
// above use fresh fixtures; these assert the NULL-bearing legacy shapes are
// swept sanely — reaped via the updatedAt/createdAt fallbacks, never crashing on
// the NULL, and never issuing a StopTask with a null task ARN.
describe("reapStuckTopoJobs — legacy prod row shapes (gap 6)", () => {
  it("reaps a processing job with NULL startedAt and NULL ecsTaskArn via the updatedAt fallback", async () => {
    const old = new Date(
      NOW.getTime() - env.TOPO_REAPER_PROCESSING_TIMEOUT_MS - 60_000,
    );
    stageByStatus(jobFindMany, {
      processing: [
        {
          id: "legacy-job",
          userId: "u1",
          name: null,
          startedAt: null, // pre-startedAt column
          updatedAt: old,
          estimatedSeconds: null,
          ecsTaskArn: null, // pre-task_arn column
        },
      ],
    });
    jobUpdateMany.mockResolvedValue({ count: 1 });

    const count = await reapStuckTopoJobs(NOW);

    const processingUpdate = jobUpdateMany.mock.calls[0][0];
    expect(processingUpdate.where.id).toBe("legacy-job");
    expect(processingUpdate.where.status).toBe("processing");
    expect(processingUpdate.data.status).toBe("failed");
    // No task ARN → no StopTask attempted with a null task.
    expect(ecsSend).not.toHaveBeenCalled();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("reaps a running export with NULL startedAt and NULL ecsTaskArn without a StopTask", async () => {
    stageByStatus(exportFindMany, {
      running: [
        { id: "legacy-export", userId: "u1", format: "gpkg", ecsTaskArn: null },
      ],
    });
    exportUpdateMany.mockResolvedValue({ count: 1 });

    const count = await reapStuckTopoJobs(NOW);

    expect(exportUpdateMany.mock.calls[0][0].where.id).toBe("legacy-export");
    expect(ecsSend).not.toHaveBeenCalled();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("a mixed sweep of legacy NULL-ARN rows never calls StopTask", async () => {
    const old = new Date(
      NOW.getTime() - env.TOPO_REAPER_PROCESSING_TIMEOUT_MS - 60_000,
    );
    stageByStatus(jobFindMany, {
      processing: [
        {
          id: "j",
          userId: "u1",
          name: null,
          startedAt: null,
          updatedAt: old,
          estimatedSeconds: null,
          ecsTaskArn: null,
        },
      ],
    });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    stageByStatus(exportFindMany, {
      running: [{ id: "e", userId: "u1", format: "gpkg", ecsTaskArn: null }],
    });
    exportUpdateMany.mockResolvedValue({ count: 1 });
    stageByStatus(geoPdfFindMany, {
      running: [{ id: "g", userId: "u1", ecsTaskArn: null }],
    });
    geoPdfUpdateMany.mockResolvedValue({ count: 1 });

    await expect(reapStuckTopoJobs(NOW)).resolves.toBeGreaterThanOrEqual(3);
    expect(ecsSend).not.toHaveBeenCalled();
  });
});

// ── Reaped jobs are user-visible (APIC-005) ────────────────────────────────
//
// The workers' own except paths write a Notification + push on failure; the
// reaper used to write status="failed" and nothing else, so a user whose task
// was never placed or was SIGKILLed learned about it only by polling the list.
// Same terminal state, two behaviours.

describe("reapStuckTopoJobs — notifies the owners of reaped jobs", () => {
  it("writes a topo_failed notification + push for a reaped topo job", async () => {
    stageByStatus(jobFindMany, {
      pending: [{ id: "p1", userId: "u1", name: "Claustral run" }],
    });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    deviceTokenFindMany.mockResolvedValue([{ token: "ExponentPushToken[x]" }]);

    await reapStuckTopoJobs(NOW);

    expect(notificationCreateMany).toHaveBeenCalledTimes(1);
    const rows = notificationCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("u1");
    expect(rows[0].type).toBe("topo_failed");
    expect(rows[0].payload).toMatchObject({ jobId: "p1" });
  });

  // The dedup rule (root CLAUDE.md): the status-guarded claim is per row, and
  // only `count === 1` means THIS pass won it. Prod runs the API on Elastic
  // Beanstalk, so two instances can sweep the same overdue ids at once — the
  // loser's updateMany reports 0 and it must stay silent, or the user gets two
  // notifications and two pushes for one dead job.
  it("stays silent for a row another instance claimed first", async () => {
    stageByStatus(jobFindMany, {
      pending: [{ id: "p1", userId: "u1", name: null }],
    });
    jobUpdateMany.mockResolvedValue({ count: 0 }); // lost the race
    deviceTokenFindMany.mockResolvedValue([{ token: "ExponentPushToken[x]" }]);

    const count = await reapStuckTopoJobs(NOW);

    expect(jobUpdateMany).toHaveBeenCalledTimes(1);
    expect(notificationCreateMany).not.toHaveBeenCalled();
    // No push either — nothing was looked up to push to.
    expect(deviceTokenFindMany).not.toHaveBeenCalled();
    // And the returned count only ever counts rows this pass claimed.
    expect(count).toBe(0);
  });

  it("notifies only the rows it won when a pass claims some and loses others", async () => {
    stageByStatus(jobFindMany, {
      pending: [
        { id: "won", userId: "u1", name: null },
        { id: "lost", userId: "u2", name: null },
      ],
    });
    jobUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const count = await reapStuckTopoJobs(NOW);

    const rows = notificationCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ jobId: "won" });
    expect(count).toBe(1);
  });

  it("uses each pipeline's own notification type for exports and GeoPDFs", async () => {
    stageByStatus(exportFindMany, {
      queued: [{ id: "e1", userId: "u2", format: "geotiff" }],
    });
    exportUpdateMany.mockResolvedValue({ count: 1 });
    stageByStatus(geoPdfFindMany, { queued: [{ id: "g1", userId: "u3" }] });
    geoPdfUpdateMany.mockResolvedValue({ count: 1 });

    await reapStuckTopoJobs(NOW);

    const written = notificationCreateMany.mock.calls.flatMap((call) => call[0].data);
    const exportRow = written.find((r: { userId: string }) => r.userId === "u2");
    const geoPdfRow = written.find((r: { userId: string }) => r.userId === "u3");
    // Types both clients already render, with the failure carried in the
    // payload exactly as the Python/TS workers write it.
    expect(exportRow.type).toBe("topo_export_complete");
    expect(exportRow.payload).toMatchObject({ status: "failed", format: "geotiff" });
    expect(geoPdfRow.type).toBe("geo_pdf_complete");
    expect(geoPdfRow.payload).toMatchObject({ status: "failed" });
  });

  it("does not abort the sweep when the notification write fails", async () => {
    stageByStatus(jobFindMany, {
      pending: [{ id: "p1", userId: "u1", name: null }],
    });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    notificationCreateMany.mockRejectedValue(new Error("db down"));

    await expect(reapStuckTopoJobs(NOW)).resolves.toBe(1);
  });
});

// ── failure email for reaped rows (APIC-005) ────────────────────────────────

// A reaped job is a failed job, so the three EXISTING toggles now mean
// "finishes or fails" and the reaper mails on them. Same claim gate as the
// notification: only rows this pass won get mail.
describe("reapStuckTopoJobs — emails the owners of reaped jobs", () => {
  const RECIPIENT = { id: "u1", email: "alice@example.com", uiPreferences: null };

  it("emails a reaped topo job's owner, matching the worker's mail shape", async () => {
    stageByStatus(jobFindMany, {
      pending: [{ id: "p1", userId: "u1", name: "Claustral run" }],
    });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    userFindMany.mockResolvedValue([RECIPIENT]);

    await reapStuckTopoJobs(NOW);

    expect(emailSend).toHaveBeenCalledTimes(1);
    const mail = emailSend.mock.calls[0][0];
    expect(mail.to).toBe("alice@example.com");
    expect(mail.subject).toBe("Topo map failed — Logjam");
    // The generic reaper message is the body's reason (intended: the reaper
    // knows nothing more than "it timed out").
    expect(mail.text).toContain("did not complete in the expected time");
    expect(mail.html).toContain("<strong>");
    // Deep link + logo header only when FRONTEND_URL is configured.
    if (getEnv().FRONTEND_URL) {
      expect(mail.text).toContain("topoJob=p1");
      expect(mail.html).toContain("email-logo-lockup.png");
    }
  });

  it("uses each pipeline's own subject and pref", async () => {
    stageByStatus(exportFindMany, {
      queued: [{ id: "e1", userId: "u1", format: "geotiff" }],
    });
    exportUpdateMany.mockResolvedValue({ count: 1 });
    stageByStatus(geoPdfFindMany, { queued: [{ id: "g1", userId: "u1" }] });
    geoPdfUpdateMany.mockResolvedValue({ count: 1 });
    userFindMany.mockResolvedValue([RECIPIENT]);

    await reapStuckTopoJobs(NOW);

    const subjects = emailSend.mock.calls.map((call) => call[0].subject);
    expect(subjects).toEqual([
      "Topo export failed — GEOTIFF",
      "GeoPDF failed — Logjam",
    ]);
  });

  // The house dedup rule: mailing the READ set would double-send from two
  // Elastic Beanstalk instances sweeping the same overdue ids.
  it("sends NO email for a row another instance claimed first", async () => {
    stageByStatus(jobFindMany, {
      pending: [{ id: "p1", userId: "u1", name: null }],
    });
    jobUpdateMany.mockResolvedValue({ count: 0 }); // lost the race
    userFindMany.mockResolvedValue([RECIPIENT]);

    await reapStuckTopoJobs(NOW);

    expect(emailSend).not.toHaveBeenCalled();
    // Nobody was even looked up — the claim gate short-circuits first.
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it("mails only the row it won when a pass claims some and loses others", async () => {
    stageByStatus(jobFindMany, {
      pending: [
        { id: "won", userId: "u1", name: null },
        { id: "lost", userId: "u2", name: null },
      ],
    });
    jobUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    userFindMany.mockResolvedValue([
      RECIPIENT,
      { id: "u2", email: "bob@example.com", uiPreferences: null },
    ]);

    await reapStuckTopoJobs(NOW);

    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(emailSend.mock.calls[0][0].to).toBe("alice@example.com");
    // Only the won row's owner is even looked up.
    expect(userFindMany.mock.calls[0][0].where.id.in).toEqual(["u1"]);
  });

  it("respects the pipeline's existing preference toggle", async () => {
    stageByStatus(jobFindMany, {
      pending: [{ id: "p1", userId: "u1", name: null }],
    });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    userFindMany.mockResolvedValue([
      {
        id: "u1",
        email: "alice@example.com",
        uiPreferences: { notifications: { topoEmail: false } },
      },
    ]);

    await reapStuckTopoJobs(NOW);

    expect(emailSend).not.toHaveBeenCalled();
    // The in-app notification is unconditional — only the email is gated.
    expect(notificationCreateMany).toHaveBeenCalledTimes(1);
  });

  it("skips a user with no email address", async () => {
    stageByStatus(jobFindMany, {
      pending: [{ id: "p1", userId: "u1", name: null }],
    });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    userFindMany.mockResolvedValue([{ id: "u1", email: null, uiPreferences: null }]);

    await reapStuckTopoJobs(NOW);

    expect(emailSend).not.toHaveBeenCalled();
  });

  it("does not abort the sweep when the recipient lookup fails", async () => {
    stageByStatus(jobFindMany, {
      pending: [{ id: "p1", userId: "u1", name: null }],
    });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    userFindMany.mockRejectedValue(new Error("db down"));

    await expect(reapStuckTopoJobs(NOW)).resolves.toBe(1);
  });
});

// ── expireCompletedExports (ARCH-006 export-expiry sweep) ───────────────────

describe("expireCompletedExports", () => {
  const expiredRow = {
    id: "exp-1",
    userId: "u1",
    resultKey: "exports/exp-1/result.zip",
    resultBytes: 1234n,
  };

  it("selects only completed rows past the TTL", async () => {
    await expireCompletedExports(NOW);
    expect(exportFindMany).toHaveBeenCalledTimes(1);
    const where = exportFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("completed");
    expect(where.completedAt.lt).toEqual(
      new Date(NOW.getTime() - env.TOPO_EXPORT_TTL_MS),
    );
  });

  it("deletes the S3 object, then decrements quota and deletes the row in one tx", async () => {
    exportFindMany.mockResolvedValue([expiredRow]);

    const count = await expireCompletedExports(NOW);

    expect(count).toBe(1);
    expect(s3Send).toHaveBeenCalledTimes(1);
    expect(s3Send.mock.calls[0][0].input).toMatchObject({
      Key: "exports/exp-1/result.zip",
    });
    // Decrement (raw UPDATE through the tx client) and row delete both went
    // through the transaction client — one commit (Design Q).
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(txExportDelete).toHaveBeenCalledWith({ where: { id: "exp-1" } });
    // S3 delete strictly before the DB transaction.
    expect(s3Send.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0],
    );
  });

  it("cleans up rows without a resultKey and skips the S3 call", async () => {
    exportFindMany.mockResolvedValue([{ ...expiredRow, resultKey: null }]);
    const count = await expireCompletedExports(NOW);
    expect(count).toBe(1);
    expect(s3Send).not.toHaveBeenCalled();
    expect(txExportDelete).toHaveBeenCalledTimes(1);
  });

  it("an S3 failure skips that row but does not abort the sweep", async () => {
    exportFindMany.mockResolvedValue([
      expiredRow,
      { ...expiredRow, id: "exp-2", resultKey: "exports/exp-2/result.zip" },
    ]);
    s3Send
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({});

    const count = await expireCompletedExports(NOW);

    // First row survives for the next sweep; second is cleaned.
    expect(count).toBe(1);
    expect(txExportDelete).toHaveBeenCalledTimes(1);
    expect(txExportDelete).toHaveBeenCalledWith({ where: { id: "exp-2" } });
  });

  it("TOPO_EXPORT_TTL_MS=0 disables the sweep entirely", async () => {
    const liveEnv = getEnv() as { TOPO_EXPORT_TTL_MS: number };
    const original = liveEnv.TOPO_EXPORT_TTL_MS;
    liveEnv.TOPO_EXPORT_TTL_MS = 0;
    try {
      const count = await expireCompletedExports(NOW);
      expect(count).toBe(0);
      expect(exportFindMany).not.toHaveBeenCalled();
    } finally {
      liveEnv.TOPO_EXPORT_TTL_MS = original;
    }
  });
});

// ── reapStuckTopoJobs — geo_pdf_jobs (mirrors topo_export_jobs) ─────────────

describe("reapStuckTopoJobs — geo_pdf_jobs", () => {
  it("fails queued GeoPDF jobs older than the queued timeout, anchored on createdAt", async () => {
    stageByStatus(geoPdfFindMany, { queued: [{ id: "q1", userId: "u1" }] });
    geoPdfUpdateMany.mockResolvedValue({ count: 1 });

    await reapStuckTopoJobs(NOW);

    const queuedRead = geoPdfFindMany.mock.calls[0][0];
    expect(queuedRead.where.status).toBe("queued");
    expect(queuedRead.where.createdAt.lt).toEqual(
      new Date(NOW.getTime() - env.GEO_PDF_QUEUED_TIMEOUT_MS),
    );
    const queuedUpdate = geoPdfUpdateMany.mock.calls[0][0];
    expect(queuedUpdate.where.status).toBe("queued");
    expect(queuedUpdate.where.id).toBe("q1");
    expect(queuedUpdate.data.status).toBe("failed");
  });

  it("selects running GeoPDF jobs on startedAt with a createdAt fallback", async () => {
    await reapStuckTopoJobs(NOW);
    // calls[0] is the queued-id read; calls[1] is the running select.
    const runningWhere = geoPdfFindMany.mock.calls[1][0].where;
    const cutoff = new Date(NOW.getTime() - env.GEO_PDF_RUNNING_TIMEOUT_MS);
    expect(runningWhere.status).toBe("running");
    expect(runningWhere.OR).toEqual([
      { startedAt: { lt: cutoff } },
      { startedAt: null, createdAt: { lt: cutoff } },
    ]);
  });

  it("force-fails overdue running GeoPDF jobs status-guarded and stops their tasks", async () => {
    stageByStatus(geoPdfFindMany, {
      running: [
        { id: "g1", userId: "u1", ecsTaskArn: "arn:task/g1" },
        { id: "g2", userId: "u1", ecsTaskArn: null },
      ],
    });
    geoPdfUpdateMany.mockResolvedValue({ count: 1 });

    const count = await reapStuckTopoJobs(NOW);

    expect(geoPdfUpdateMany.mock.calls.map((call) => call[0].where.id)).toEqual([
      "g1",
      "g2",
    ]);
    const runningUpdate = geoPdfUpdateMany.mock.calls[0][0];
    expect(runningUpdate.where.status).toBe("running");
    expect(ecsSend).toHaveBeenCalledTimes(1);
    expect(ecsSend.mock.calls[0][0].input).toMatchObject({ task: "arn:task/g1" });
    expect(count).toBe(2);
  });

  it("includes geo_pdf_jobs counts in the total reaped", async () => {
    stageByStatus(geoPdfFindMany, {
      queued: ["q1", "q2", "q3", "q4"].map((id) => ({ id, userId: "u1" })),
    });
    geoPdfUpdateMany.mockResolvedValue({ count: 1 });
    const count = await reapStuckTopoJobs(NOW);
    // queued (4 claimed); the running read returns [] so nothing else runs.
    expect(count).toBe(4);
  });
});

// ── expireCompletedGeoPdfJobs (mirrors expireCompletedExports) ──────────────

describe("expireCompletedGeoPdfJobs", () => {
  const expiredRow = {
    id: "geo-1",
    userId: "u1",
    resultKey: "exports/geo-pdf/geo-1/logjam-export.pdf",
    resultBytes: 5678n,
  };

  it("selects only completed rows past the TTL", async () => {
    await expireCompletedGeoPdfJobs(NOW);
    expect(geoPdfFindMany).toHaveBeenCalledTimes(1);
    const where = geoPdfFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("completed");
    expect(where.completedAt.lt).toEqual(
      new Date(NOW.getTime() - env.TOPO_EXPORT_TTL_MS),
    );
  });

  it("deletes the S3 object, then decrements quota and deletes the row in one tx", async () => {
    geoPdfFindMany.mockResolvedValue([expiredRow]);

    const count = await expireCompletedGeoPdfJobs(NOW);

    expect(count).toBe(1);
    expect(s3Send).toHaveBeenCalledTimes(1);
    expect(s3Send.mock.calls[0][0].input).toMatchObject({
      Key: "exports/geo-pdf/geo-1/logjam-export.pdf",
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(txGeoPdfDelete).toHaveBeenCalledWith({ where: { id: "geo-1" } });
    // Share rows are purged in the same transaction as the row delete (finding
    // 3): Share.entityId is polymorphic, so nothing cascades.
    expect(txShareDeleteMany).toHaveBeenCalledWith({
      where: { entityType: "geoPdfJob", entityId: { in: ["geo-1"] } },
    });
    expect(s3Send.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0],
    );
  });

  it("cleans up rows without a resultKey and skips the S3 call", async () => {
    geoPdfFindMany.mockResolvedValue([{ ...expiredRow, resultKey: null }]);
    const count = await expireCompletedGeoPdfJobs(NOW);
    expect(count).toBe(1);
    expect(s3Send).not.toHaveBeenCalled();
    expect(txGeoPdfDelete).toHaveBeenCalledTimes(1);
  });

  it("an S3 failure skips that row but does not abort the sweep", async () => {
    geoPdfFindMany.mockResolvedValue([
      expiredRow,
      { ...expiredRow, id: "geo-2", resultKey: "exports/geo-pdf/geo-2/logjam-export.pdf" },
    ]);
    s3Send
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({});

    const count = await expireCompletedGeoPdfJobs(NOW);

    expect(count).toBe(1);
    expect(txGeoPdfDelete).toHaveBeenCalledTimes(1);
    expect(txGeoPdfDelete).toHaveBeenCalledWith({ where: { id: "geo-2" } });
  });

  it("TOPO_EXPORT_TTL_MS=0 disables the sweep entirely (shared with exports)", async () => {
    const liveEnv = getEnv() as { TOPO_EXPORT_TTL_MS: number };
    const original = liveEnv.TOPO_EXPORT_TTL_MS;
    liveEnv.TOPO_EXPORT_TTL_MS = 0;
    try {
      const count = await expireCompletedGeoPdfJobs(NOW);
      expect(count).toBe(0);
      expect(geoPdfFindMany).not.toHaveBeenCalled();
    } finally {
      liveEnv.TOPO_EXPORT_TTL_MS = original;
    }
  });
});

// ── exportableLayers (pure: produced-output → exportable layer set) ──────────

describe("exportableLayers", () => {
  it("includes raster layers only when a COG exists", () => {
    const set = exportableLayers([
      { name: "hillshade", cogKey: "k/hillshade.tif", pmtilesKey: "k/hillshade.pmtiles" },
      { name: "slope", cogKey: null, pmtilesKey: "k/slope.pmtiles" },
    ]);
    expect(set.has("hillshade")).toBe(true);
    expect(set.has("slope")).toBe(false); // raster without COG can't export
  });

  it("includes vector layers regardless of cogKey", () => {
    const set = exportableLayers([
      { name: "contours", cogKey: null, pmtilesKey: "k/contours.pmtiles" },
      { name: "features", cogKey: null, pmtilesKey: "k/features.pmtiles" },
    ]);
    expect(set.has("contours")).toBe(true);
    expect(set.has("features")).toBe(true);
  });

  it("returns an empty set for malformed / unknown outputs", () => {
    expect(exportableLayers(null).size).toBe(0);
    expect(exportableLayers([{ name: "bogus", cogKey: "x", pmtilesKey: "y" }]).size).toBe(0);
  });
});

// ── queueAutoExports (auto-export trigger pass) ─────────────────────────────

describe("queueAutoExports", () => {
  const enabledAutoExport = {
    ...AUTO_EXPORT_DEFAULTS,
    enabled: true,
    format: "mbtiles" as const,
    bundling: "composite" as const,
    layers: ["hillshade", "contours"],
  };
  const completeJob = {
    id: "job-1",
    userId: "user-1",
    autoExport: enabledAutoExport,
    s3OutputKeys: [
      { name: "hillshade", cogKey: "k/hillshade.tif", pmtilesKey: "k/hillshade.pmtiles" },
      { name: "contours", cogKey: null, pmtilesKey: "k/contours.pmtiles" },
    ],
    vectorStyleSnapshot: { contours: {}, features: {} },
  };

  it("claims the job and launches an export for an enabled config", async () => {
    jobFindMany.mockResolvedValueOnce([completeJob]);
    jobUpdateMany.mockResolvedValueOnce({ count: 1 }); // claim wins

    const count = await queueAutoExports(NOW);

    expect(count).toBe(1);
    // Claim is status-guarded on autoExportedAt: null.
    expect(jobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1", autoExportedAt: null },
        data: { autoExportedAt: NOW },
      }),
    );
    expect(launchExport).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sourceJobIds: ["job-1"],
        format: "mbtiles",
        bundling: "composite",
        layers: ["hillshade", "contours"],
      }),
    );
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("does not launch when the claim is lost to a concurrent sweep", async () => {
    jobFindMany.mockResolvedValueOnce([completeJob]);
    jobUpdateMany.mockResolvedValueOnce({ count: 0 }); // someone else claimed it

    const count = await queueAutoExports(NOW);

    expect(count).toBe(0);
    expect(launchExport).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("notifies and skips when none of the chosen layers were produced", async () => {
    jobFindMany.mockResolvedValueOnce([
      {
        ...completeJob,
        // Only a raster layer without a COG → nothing exportable.
        s3OutputKeys: [{ name: "hillshade", cogKey: null, pmtilesKey: "k/h.pmtiles" }],
      },
    ]);
    jobUpdateMany.mockResolvedValueOnce({ count: 1 });

    const count = await queueAutoExports(NOW);

    expect(count).toBe(0);
    expect(launchExport).not.toHaveBeenCalled();
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          type: "topo_export_skipped",
        }),
      }),
    );
  });

  it("notifies on a cap-exceeded (429) launch failure, claim already set", async () => {
    jobFindMany.mockResolvedValueOnce([completeJob]);
    jobUpdateMany.mockResolvedValueOnce({ count: 1 });
    launchExport.mockRejectedValueOnce(new AppError(429, "Too many concurrent exports"));

    const count = await queueAutoExports(NOW);

    expect(count).toBe(0);
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "topo_export_skipped" }),
      }),
    );
  });

  it("claims but does nothing when the stored config is disabled", async () => {
    jobFindMany.mockResolvedValueOnce([
      { ...completeJob, autoExport: { ...enabledAutoExport, enabled: false } },
    ]);
    jobUpdateMany.mockResolvedValueOnce({ count: 1 });

    const count = await queueAutoExports(NOW);

    expect(count).toBe(0);
    expect(launchExport).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
