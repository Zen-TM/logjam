import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    topoJob: { updateMany: vi.fn(), findMany: vi.fn() },
    topoExportJob: { updateMany: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("../services/awsClients", () => ({
  ecs: { send: vi.fn() },
}));

import prisma from "../services/prisma";
import { ecs } from "../services/awsClients";
import {
  reapStuckTopoJobs,
  processingDeadline,
  ESTIMATE_SAFETY_FACTOR,
} from "./topoJobReaper";
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
const ecsSend = (ecs as unknown as { send: Mock }).send;

const NOW = new Date("2026-06-05T12:00:00.000Z");
const env = getEnv();

beforeEach(() => {
  jobUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  jobFindMany.mockReset().mockResolvedValue([]);
  exportUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  exportFindMany.mockReset().mockResolvedValue([]);
  ecsSend.mockReset().mockResolvedValue({});
});

// ── processingDeadline (pure per-job deadline, ARCH-001) ────────────────────

describe("processingDeadline", () => {
  const timeoutMs = env.TOPO_REAPER_PROCESSING_TIMEOUT_MS; // 3 h default
  const startedAt = new Date("2026-06-05T00:00:00.000Z");
  const updatedAt = new Date("2026-06-05T01:00:00.000Z");

  it("uses the flat timeout when estimatedSeconds is null", () => {
    const deadline = processingDeadline(
      { startedAt, updatedAt, estimatedSeconds: null },
      timeoutMs,
    );
    expect(deadline).toEqual(new Date(startedAt.getTime() + timeoutMs));
  });

  it("uses the flat timeout as a floor for small jobs", () => {
    // 10-tile job: ~85 min estimate → 2× = 170 min < 3 h floor.
    const estimatedSeconds = Math.round(10 * 8.5) * 60;
    const deadline = processingDeadline(
      { startedAt, updatedAt, estimatedSeconds },
      timeoutMs,
    );
    expect(deadline).toEqual(new Date(startedAt.getTime() + timeoutMs));
  });

  it("extends the deadline past the flat timeout for large jobs", () => {
    // 100-tile job: 51 000 s estimate (~14.2 h) → 2× ≈ 28.3 h budget.
    const estimatedSeconds = Math.round(100 * 8.5) * 60;
    const deadline = processingDeadline(
      { startedAt, updatedAt, estimatedSeconds },
      timeoutMs,
    );
    expect(deadline).toEqual(
      new Date(startedAt.getTime() + ESTIMATE_SAFETY_FACTOR * estimatedSeconds * 1000),
    );
    expect(deadline.getTime()).toBeGreaterThan(startedAt.getTime() + timeoutMs);
  });

  it("a 21-tile job already exceeds the flat 3h cutoff (the ARCH-001 case)", () => {
    const estimatedSeconds = Math.round(21 * 8.5) * 60; // 10 740 s ≈ 2.98 h
    const deadline = processingDeadline(
      { startedAt, updatedAt, estimatedSeconds },
      timeoutMs,
    );
    // 2× estimate ≈ 5.97 h > 3 h floor.
    expect(deadline.getTime()).toBeGreaterThan(startedAt.getTime() + timeoutMs);
  });

  it("falls back to updatedAt when startedAt is null", () => {
    const deadline = processingDeadline(
      { startedAt: null, updatedAt, estimatedSeconds: null },
      timeoutMs,
    );
    expect(deadline).toEqual(new Date(updatedAt.getTime() + timeoutMs));
  });
});

// ── reapStuckTopoJobs sweeps ─────────────────────────────────────────────────

describe("reapStuckTopoJobs — topo_jobs", () => {
  it("anchors the pending cutoff on the pending timeout", async () => {
    await reapStuckTopoJobs(NOW);
    const pendingUpdate = jobUpdateMany.mock.calls[0][0];
    expect(pendingUpdate.where.status).toBe("pending");
    expect(pendingUpdate.where.updatedAt.lt).toEqual(
      new Date(NOW.getTime() - env.TOPO_REAPER_PENDING_TIMEOUT_MS),
    );
    expect(pendingUpdate.data.status).toBe("failed");
  });

  it("pins the reaper messages to honest retry semantics (ARCH-008)", async () => {
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

  it("reaps only processing jobs past their per-job deadline, status-guarded", async () => {
    const flatMs = env.TOPO_REAPER_PROCESSING_TIMEOUT_MS;
    const overdue = {
      id: "job-overdue",
      startedAt: new Date(NOW.getTime() - flatMs - 60_000),
      updatedAt: new Date(NOW.getTime() - flatMs - 60_000),
      estimatedSeconds: null,
      ecsTaskArn: null,
    };
    // Past the flat timeout but inside 2× its 100-tile estimate → must survive.
    const longButAlive = {
      id: "job-large",
      startedAt: new Date(NOW.getTime() - flatMs - 60_000),
      updatedAt: new Date(NOW.getTime() - flatMs - 60_000),
      estimatedSeconds: Math.round(100 * 8.5) * 60,
      ecsTaskArn: "arn:task/large",
    };
    jobFindMany.mockResolvedValue([overdue, longButAlive]);
    jobUpdateMany.mockResolvedValue({ count: 1 });

    await reapStuckTopoJobs(NOW);

    const processingUpdate = jobUpdateMany.mock.calls[1][0];
    expect(processingUpdate.where.id.in).toEqual(["job-overdue"]);
    expect(processingUpdate.where.status).toBe("processing");
    expect(processingUpdate.data.status).toBe("failed");
  });

  it("issues StopTask only for reaped jobs that have a task ARN", async () => {
    const old = new Date(
      NOW.getTime() - env.TOPO_REAPER_PROCESSING_TIMEOUT_MS - 60_000,
    );
    jobFindMany.mockResolvedValue([
      { id: "j1", startedAt: old, updatedAt: old, estimatedSeconds: null, ecsTaskArn: "arn:task/j1" },
      { id: "j2", startedAt: old, updatedAt: old, estimatedSeconds: null, ecsTaskArn: null },
    ]);
    jobUpdateMany.mockResolvedValue({ count: 2 });

    await reapStuckTopoJobs(NOW);

    expect(ecsSend).toHaveBeenCalledTimes(1);
    expect(ecsSend.mock.calls[0][0].input).toMatchObject({ task: "arn:task/j1" });
  });

  it("a StopTask failure does not abort the sweep", async () => {
    const old = new Date(
      NOW.getTime() - env.TOPO_REAPER_PROCESSING_TIMEOUT_MS - 60_000,
    );
    jobFindMany.mockResolvedValue([
      { id: "j1", startedAt: old, updatedAt: old, estimatedSeconds: null, ecsTaskArn: "arn:task/j1" },
    ]);
    jobUpdateMany.mockResolvedValue({ count: 1 });
    ecsSend.mockRejectedValue(new Error("task already stopped"));

    await expect(reapStuckTopoJobs(NOW)).resolves.toBeGreaterThanOrEqual(1);
  });
});

describe("reapStuckTopoJobs — topo_export_jobs (ARCH-002)", () => {
  it("fails queued exports older than the queued timeout, anchored on createdAt", async () => {
    await reapStuckTopoJobs(NOW);
    const queuedUpdate = exportUpdateMany.mock.calls[0][0];
    expect(queuedUpdate.where.status).toBe("queued");
    expect(queuedUpdate.where.createdAt.lt).toEqual(
      new Date(NOW.getTime() - env.TOPO_REAPER_EXPORT_QUEUED_TIMEOUT_MS),
    );
    expect(queuedUpdate.data.status).toBe("failed");
  });

  it("selects running exports on startedAt with a createdAt fallback", async () => {
    await reapStuckTopoJobs(NOW);
    const runningWhere = exportFindMany.mock.calls[0][0].where;
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
    exportFindMany.mockResolvedValue([
      { id: "e1", ecsTaskArn: "arn:task/e1" },
      { id: "e2", ecsTaskArn: null },
    ]);
    // First exportUpdateMany call is the queued sweep (nothing), second is
    // the running sweep (both rows).
    exportUpdateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 2 });

    const count = await reapStuckTopoJobs(NOW);

    const runningUpdate = exportUpdateMany.mock.calls[1][0];
    expect(runningUpdate.where.id.in).toEqual(["e1", "e2"]);
    expect(runningUpdate.where.status).toBe("running");
    expect(ecsSend).toHaveBeenCalledTimes(1);
    expect(ecsSend.mock.calls[0][0].input).toMatchObject({ task: "arn:task/e1" });
    expect(count).toBe(2);
  });

  it("sums reap counts across all four sweeps", async () => {
    jobUpdateMany.mockResolvedValue({ count: 2 });
    exportUpdateMany.mockResolvedValue({ count: 3 });
    // No processing/running rows → only pending (2) + queued (3).
    const count = await reapStuckTopoJobs(NOW);
    expect(count).toBe(5);
  });
});
