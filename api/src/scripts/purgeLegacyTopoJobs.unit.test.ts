import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// Made-up rows: the unmarked jobs the query returns, and the running exports.
const db = vi.hoisted(() => ({
  jobs: [] as {
    id: string;
    userId: string;
    status: string;
    outputBytes: bigint | null;
  }[],
  running: [] as { sourceJobIds: string[] }[],
  jobWhere: undefined as unknown,
}));
vi.mock("../services/prisma", () => ({
  default: {
    topoJob: {
      findMany: async ({ where }: { where: unknown }) => {
        db.jobWhere = where;
        return db.jobs;
      },
    },
    topoExportJob: { findMany: async () => db.running },
  },
}));
const deleteTopoJob = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../lib/deleteTopoJob", () => ({ deleteTopoJob }));
const logged = vi.hoisted(
  () => [] as { level: string; msg: string; data: unknown }[],
);
vi.mock("../lib/logger", () => ({
  logger: {
    info: (data: unknown, msg: string) =>
      logged.push({ level: "info", msg, data }),
    error: (data: unknown, msg: string) =>
      logged.push({ level: "error", msg, data }),
  },
  safeErrorForLog: (err: unknown) => String(err),
}));

import { purge } from "./purgeLegacyTopoJobs";

const job = (id: string, status: string, outputBytes = 100n) => ({
  id,
  userId: `owner-of-${id}`,
  status,
  outputBytes,
});

beforeEach(() => {
  db.jobs = [
    job("done", "complete"),
    job("broke", "failed", null),
    job("busy", "complete"),
    job("new", "uploading"),
    job("queued", "pending"),
    job("running", "processing"),
  ];
  db.running = [{ sourceJobIds: ["busy", "elsewhere"] }];
  deleteTopoJob.mockReset().mockResolvedValue(true);
  logged.length = 0;
});

describe("purge", () => {
  // Red if the query reads marked (sharpened) jobs too.
  it("reads only jobs from before new jobs sharpened", async () => {
    await purge(false);
    expect(db.jobWhere).toEqual({ sharpen: { equals: Prisma.DbNull } });
  });

  // Red if the dry run deletes anything, or its counts leave a skip out.
  it("counts without deleting unless confirmed", async () => {
    expect(await purge(false)).toBe(0);
    expect(deleteTopoJob).not.toHaveBeenCalled();
    expect(logged).toEqual([
      {
        level: "info",
        msg: "legacy_topo_jobs_checked",
        data: {
          jobs: 2,
          owners: 2,
          outputBytes: "100",
          skippedUnfinished: 3,
          skippedExporting: 1,
        },
      },
    ]);
  });

  // Red if an uploading, pending or processing row is deleted (a new job not
  // yet started, or one a worker still runs), or one a running export reads.
  it("deletes only finished jobs no export is reading", async () => {
    expect(await purge(true)).toBe(0);
    expect(deleteTopoJob.mock.calls).toEqual([
      ["done", "owner-of-done"],
      ["broke", "owner-of-broke"],
    ]);
  });

  // Red if one failed delete stops the rest, or the run still exits 0.
  it("carries on past a failed delete, and exits 1", async () => {
    deleteTopoJob.mockRejectedValueOnce(new Error("AccessDenied"));
    expect(await purge(true)).toBe(1);
    expect(deleteTopoJob).toHaveBeenCalledTimes(2);
    expect(logged.at(-1)).toEqual({
      level: "info",
      msg: "legacy_topo_jobs_purged",
      data: { deleted: 1, failed: 1 },
    });
  });
});
