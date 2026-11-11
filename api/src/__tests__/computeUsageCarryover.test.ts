import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { WORKER_SPECS, currentMonthStart } from "@logjam/shared";
import { API_URL, as, BOB_SUB, BOB_ID } from "./_actors";
import prisma from "../services/prisma";
import { getSiteCreditUsage } from "../lib/computeCredits";
import { reapStuckTopoJobs } from "../lib/topoJobReaper";
import { IN_FLIGHT_STATUSES } from "../lib/fargateCapacity";

// Requires the API (AUTH_MODE=fake). Usage of rows that exist is derived from
// the job tables; what a delete would erase is carried over by a trigger
// (migration 20261110000000_compute_usage_carryover). The pool's cap is the
// API's SITE_MONTHLY_COMPUTE_CREDITS, which these tests leave at its default.
const BOB = as(BOB_SUB);
const MINUTES = 10;

/** Credits bob has used this month, as POST /compute-estimate reports them. */
async function bobUsed(): Promise<number> {
  const res = await request(API_URL)
    .post("/compute-estimate")
    .set(BOB)
    .send({ kind: "topo", tileCount: null });
  expect(res.status).toBe(200);
  return res.body.used as number;
}

/** A topo job whose worker measured 10 minutes: 8 vCPU x 10 = 80 credits. */
function topoJob(userId: string, startedAt: Date | null = new Date()) {
  return prisma.topoJob.create({
    data: {
      userId,
      status: startedAt ? "complete" : "pending",
      startedAt,
      pipelineMetrics: { wallSeconds: MINUTES * 60 },
    },
  });
}

/** An export that ran 10 minutes: 4 vCPU x 10 = 40 credits. */
function exportJob(userId: string) {
  const startedAt = new Date(Date.now() - MINUTES * 60_000);
  return prisma.topoExportJob.create({
    data: {
      userId,
      sourceJobIds: [],
      layers: [],
      format: "mbtiles",
      bundling: "composite",
      vectorStyleSnapshot: {},
      status: "completed",
      startedAt,
      completedAt: new Date(startedAt.getTime() + MINUTES * 60_000),
    },
  });
}

const TOPO_CREDITS = WORKER_SPECS.topo.vcpus * MINUTES;
const EXPORT_CREDITS = WORKER_SPECS.topoExport.vcpus * MINUTES;

describe("deleting a job does not erase its compute usage", () => {
  // Mutation that turns this red: drop the carry_over_compute trigger on
  // topo_jobs (or derive from live rows only).
  it("topo job: the user's and the site's usage are the same after the row is deleted, directly or by the route", async () => {
    const [before, siteBefore] = [await bobUsed(), await getSiteCreditUsage()];
    const job = await topoJob(BOB_ID);
    expect(await bobUsed()).toBe(before + TOPO_CREDITS);

    await prisma.topoJob.delete({ where: { id: job.id } });
    expect(await bobUsed()).toBe(before + TOPO_CREDITS);
    expect(await getSiteCreditUsage()).toBe(siteBefore + TOPO_CREDITS);

    const second = await topoJob(BOB_ID);
    const res = await request(API_URL)
      .delete(`/topo-jobs/${second.id}`)
      .set(BOB);
    expect(res.status).toBe(204);
    expect(await bobUsed()).toBe(before + 2 * TOPO_CREDITS);
    expect(await getSiteCreditUsage()).toBe(siteBefore + 2 * TOPO_CREDITS);
  });

  // Mutation that turns this red: drop the carry_over_compute trigger on
  // topo_export_jobs.
  it("export job: a sweep's delete keeps its credits", async () => {
    const [before, siteBefore] = [await bobUsed(), await getSiteCreditUsage()];
    const job = await exportJob(BOB_ID);
    expect(await bobUsed()).toBe(before + EXPORT_CREDITS);
    await prisma.topoExportJob.deleteMany({ where: { id: job.id } });
    expect(await bobUsed()).toBe(before + EXPORT_CREDITS);
    expect(await getSiteCreditUsage()).toBe(siteBefore + EXPORT_CREDITS);
  });

  // Mutation that turns this red: in carry_over_topo_job, drop the started_at
  // check and price the row from COALESCE(started_at, created_at).
  it("a job that never started adds nothing when it is deleted", async () => {
    const [before, siteBefore] = [await bobUsed(), await getSiteCreditUsage()];
    const job = await topoJob(BOB_ID, null);
    await prisma.topoJob.delete({ where: { id: job.id } });
    expect(await bobUsed()).toBe(before);
    expect(await getSiteCreditUsage()).toBe(siteBefore);
  });

  it("a job still in the sweep's hands is carried over, and the sweep removes that too", async () => {
    // Left undeleted on purpose: _cleanup's sweep deletes it after the carry-over
    // tables, and must go round again to remove what its delete just wrote.
    // Mutation: make sweepToBaseline a single sweep (_seedBaseline.ts).
    await topoJob(BOB_ID);
  });
});

describe("the site-wide pool", () => {
  const spent = async () => {
    // Far over any cap the API is run with.
    await prisma.siteComputeCarryover.upsert({
      where: { monthStart: currentMonthStart() },
      update: { credits: 10n ** 9n },
      create: { monthStart: currentMonthStart(), credits: 10n ** 9n },
    });
  };
  afterEach(async () => {
    await prisma.siteComputeCarryover.deleteMany({
      where: { monthStart: currentMonthStart() },
    });
  });

  const submit = () =>
    request(API_URL).post("/topo-jobs").set(BOB).send({ jobName: "pool" });

  it("admits a default user to a typical topo job while the pool has room", async () => {
    const res = await submit();
    expect(res.status).toBe(201);
    await request(API_URL).delete(`/topo-jobs/${res.body.jobId}`).set(BOB);
  });

  // Mutation that turns this red: skip the pool block in assertHasCredits.
  it("refuses a new job with the pool's sentence once it is spent, and creates nothing", async () => {
    await spent();
    const jobs = await prisma.topoJob.count({ where: { userId: BOB_ID } });
    const res = await submit();
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/everyone on Logjam/);
    // Carries the reset date; the pool's size and use are not the user's to see.
    expect(res.body.resetAt).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty("used");
    expect(res.body).not.toHaveProperty("quota");
    expect(await prisma.topoJob.count({ where: { userId: BOB_ID } })).toBe(
      jobs,
    );
  });
});

describe("only a job in flight accrues against the clock", () => {
  // Mutation that turns this red: count any export with no completed_at
  // against NOW(), as topo_export_job_credits did (the status argument).
  it("a failed export with no completed_at costs nothing more", async () => {
    const before = await bobUsed();
    const job = await prisma.topoExportJob.create({
      data: {
        userId: BOB_ID,
        sourceJobIds: [],
        layers: [],
        format: "mbtiles",
        bundling: "composite",
        vectorStyleSnapshot: {},
        status: "failed",
        startedAt: new Date(Date.now() - 60 * 60_000),
      },
    });
    expect(await bobUsed()).toBe(before);
    await prisma.topoExportJob.delete({ where: { id: job.id } });
    expect(await bobUsed()).toBe(before);
  });

  // Mutation that turns this red: drop completedAt from the reaper's failure
  // write for an overdue running export (topoJobReaper.ts).
  it("the reaper stamps completed_at on an export it fails", async () => {
    const job = await prisma.topoExportJob.create({
      data: {
        userId: BOB_ID,
        sourceJobIds: [],
        layers: [],
        format: "mbtiles",
        bundling: "composite",
        vectorStyleSnapshot: {},
        status: "running",
        startedAt: new Date(Date.now() - 24 * 60 * 60_000),
      },
    });
    await reapStuckTopoJobs();
    const row = await prisma.topoExportJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.status).toBe("failed");
    expect(row.completedAt).not.toBeNull();
  });
});

describe("a finished job's charge stops growing", () => {
  const HOUR = 60 * 60_000;
  const metricsOf = async (id: string) =>
    (await prisma.topoJob.findUniqueOrThrow({ where: { id } }))
      .pipelineMetrics as Record<string, unknown> | null;

  /** A job that started an hour ago and is finished by `to`, with the metrics
   * the worker had written while it ran (undefined = SQL NULL). */
  async function finish(
    pipelineMetrics: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined,
    opts: {
      startedAt?: Date | null;
      to?: { status: string; pipelineMetrics?: Prisma.InputJsonValue };
    } = {},
  ) {
    const startedAt =
      opts.startedAt === undefined
        ? new Date(Date.now() - HOUR)
        : opts.startedAt;
    const job = await prisma.topoJob.create({
      data: {
        userId: BOB_ID,
        status: startedAt ? "processing" : "pending",
        startedAt,
        pipelineMetrics,
      },
    });
    await prisma.topoJob.update({
      where: { id: job.id },
      data: opts.to ?? { status: "failed" },
    });
    return job.id;
  }

  // Mutations that turn this red: drop the stamp_topo_job_wall_seconds trigger,
  // or stamp only when the new status is `failed`.
  it("is the same after a later write moves updated_at, whoever ended the job", async () => {
    for (const status of ["failed", "complete"]) {
      const before = await bobUsed();
      const id = await finish(undefined, { to: { status } });
      const charged = await bobUsed();
      // An hour of 8 vCPUs, rounded up (the job is a few ms past the hour).
      expect(charged - before, status).toBeGreaterThanOrEqual(
        WORKER_SPECS.topo.vcpus * 60,
      );
      expect(charged - before, status).toBeLessThanOrEqual(
        WORKER_SPECS.topo.vcpus * 60 + 2,
      );

      // A rename a week later.
      await prisma.$executeRaw`UPDATE topo_jobs SET updated_at = updated_at + interval '7 days' WHERE id = ${id}`;
      expect(await bobUsed(), status).toBe(charged);
      await prisma.topoJob.delete({ where: { id } });
    }
  });

  // Mutation that turns this red: build the elapsed time from NOW()::timestamp
  // (the session's zone) instead of NOW() AT TIME ZONE 'UTC'.
  it("measures from started_at in UTC whatever the session's time zone", async () => {
    const job = await prisma.topoJob.create({
      data: {
        userId: BOB_ID,
        status: "processing",
        startedAt: new Date(Date.now() - HOUR),
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Australia/Sydney'`;
      await tx.topoJob.update({
        where: { id: job.id },
        data: { status: "failed" },
      });
    });
    expect((await metricsOf(job.id))?.wallSeconds).toBeCloseTo(3600, -1);
    await prisma.topoJob.delete({ where: { id: job.id } });
  });

  // Mutation that turns this red: build the result with jsonb_set on
  // pipeline_metrics (it raises on a scalar, and the guard swallows the stamp).
  it.each([
    ["SQL NULL", undefined],
    ["JSON null", Prisma.JsonNull],
    ["an object without wallSeconds", { schemaVersion: 1, phases: { a: 2 } }],
  ])("stamps the elapsed time when the metrics are %s", async (_, metrics) => {
    const id = await finish(metrics);
    const got = await metricsOf(id);
    expect(got?.wallSeconds).toBeCloseTo(3600, -1);
    if (metrics && typeof metrics === "object") {
      expect(got).toMatchObject(metrics);
    }
    await prisma.topoJob.delete({ where: { id } });
  });

  // Mutation that turns this red: drop the numeric-wallSeconds guard from the
  // trigger, so it overwrites the worker's own measurement.
  it("leaves the worker's own wallSeconds alone, early or in the same update", async () => {
    const early = await finish({ wallSeconds: 123 });
    expect((await metricsOf(early))?.wallSeconds).toBe(123);
    const same = await finish(undefined, {
      to: { status: "complete", pipelineMetrics: { wallSeconds: 42 } },
    });
    expect((await metricsOf(same))?.wallSeconds).toBe(42);
    await prisma.topoJob.deleteMany({ where: { id: { in: [early, same] } } });
  });

  // Mutation that turns this red: drop the started_at check from the trigger.
  it("stamps nothing on a job that never started, or while it is still in flight", async () => {
    const never = await finish(undefined, { startedAt: null });
    expect(await metricsOf(never)).toBeNull();

    const running = await prisma.topoJob.create({
      data: {
        userId: BOB_ID,
        status: "pending",
        startedAt: new Date(Date.now() - HOUR),
      },
    });
    await prisma.topoJob.update({
      where: { id: running.id },
      data: { status: "processing", errorMessage: "heartbeat" },
    });
    expect(await metricsOf(running.id)).toBeNull();
    await prisma.topoJob.deleteMany({
      where: { id: { in: [never, running.id] } },
    });
  });

  // Mutation that turns this red: remove the EXCEPTION handler from
  // stamp_topo_job_wall_seconds. An infinite started_at makes the stamp's
  // subtraction raise; it is set while the job is still in flight, so that write
  // makes no stamp attempt. Raw SQL throughout: pricing or reading the row
  // through Prisma may itself fail on an infinite started_at.
  it("a stamp that fails never blocks a status write", async () => {
    const job = await prisma.topoJob.create({
      data: {
        userId: BOB_ID,
        status: "processing",
        startedAt: new Date(Date.now() - HOUR),
      },
    });
    try {
      await prisma.$executeRaw`UPDATE topo_jobs SET started_at = 'infinity' WHERE id = ${job.id}`;
      await prisma.$executeRaw`UPDATE topo_jobs SET status = 'failed' WHERE id = ${job.id}`;
      const [row] = await prisma.$queryRaw<
        { status: string; pipeline_metrics: unknown }[]
      >`SELECT status, pipeline_metrics FROM topo_jobs WHERE id = ${job.id}`;
      expect(row).toEqual({ status: "failed", pipeline_metrics: null });
    } finally {
      await prisma.$executeRaw`DELETE FROM topo_jobs WHERE id = ${job.id}`;
    }
  });

  // Mutations that turn this red: add a status to IN_FLIGHT_STATUSES.topo
  // (fargateCapacity.ts) without the SQL lists, or remove one from the trigger's
  // list (or from topo_job_credits's). A job is "in flight" for the vCPU cap, the
  // stamp and the charge's NOW() alike.
  it("the SQL's in-flight statuses are IN_FLIGHT_STATUSES.topo", async () => {
    const startedAt = new Date(Date.now() - HOUR);
    const stampedOnLeaving = async (from: string) => {
      const job = await prisma.topoJob.create({
        data: { userId: BOB_ID, status: from, startedAt },
      });
      await prisma.topoJob.update({
        where: { id: job.id },
        data: { status: "failed" },
      });
      const wallSeconds = (await metricsOf(job.id))?.wallSeconds;
      await prisma.topoJob.delete({ where: { id: job.id } });
      return typeof wallSeconds === "number";
    };
    // Credits of a job whose updated_at is its started_at: 0 unless priced
    // against NOW().
    const pricedAgainstNow = async (status: string) => {
      const [{ credits }] = await prisma.$queryRaw<{ credits: bigint }[]>`
        SELECT topo_job_credits(${status}, NULL, ${startedAt}::timestamp, ${startedAt}::timestamp)::bigint AS credits`;
      return Number(credits) > 0;
    };

    for (const status of IN_FLIGHT_STATUSES.topo) {
      expect(await stampedOnLeaving(status), status).toBe(true);
      expect(await pricedAgainstNow(status), status).toBe(true);
    }
    expect(await stampedOnLeaving("complete")).toBe(false);
    expect(await pricedAgainstNow("complete")).toBe(false);
  });
});

describe("a job row with a bad wallSeconds does not break usage", () => {
  // Mutations that turn this red: drop the jsonb_typeof guard from
  // topo_job_credits (the string), or drop its LEAST cap (the huge number).
  // Either makes every usage query, the pool's included, fail for everyone.
  it("falls back to the timestamps for a string and for an absurd number", async () => {
    const before = await bobUsed();
    for (const wallSeconds of ["not a number", 1e30]) {
      const job = await prisma.topoJob.create({
        data: {
          userId: BOB_ID,
          status: "failed",
          startedAt: new Date(),
          pipelineMetrics: { wallSeconds },
        },
      });
      expect(await bobUsed()).toBeGreaterThanOrEqual(before);
      expect(await getSiteCreditUsage()).toBeGreaterThanOrEqual(0);
      await prisma.topoJob.delete({ where: { id: job.id } });
    }
  });
});

describe("a carry-over that fails never blocks a delete", () => {
  // The carry-over fails here because its insert is refused by a constraint
  // this test adds for its duration. Mutation that turns this red: remove the
  // EXCEPTION handler from carry_over_topo_job in the migration.
  it("deletes the row, and the account that owns one, and carries nothing over", async () => {
    const tag = randomUUID();
    const user = await prisma.user.create({
      data: {
        subject: `carryover-bad-${tag}`,
        username: `cb-${tag.slice(0, 8)}`,
        email: `cb-${tag}@example.invalid`,
      },
    });
    const siteBefore = await getSiteCreditUsage();
    await prisma.$executeRawUnsafe(
      "ALTER TABLE compute_usage_carryover ADD CONSTRAINT refuse_carryover CHECK (false) NOT VALID",
    );
    try {
      const job = await topoJob(user.id);
      await prisma.topoJob.delete({ where: { id: job.id } });
      expect(
        await prisma.topoJob.findUnique({ where: { id: job.id } }),
      ).toBeNull();

      const other = await topoJob(user.id);
      const res = await request(API_URL)
        .delete("/users/me")
        .set(as(user.subject));
      expect(res.status).toBe(204);
      expect(
        await prisma.topoJob.findUnique({ where: { id: other.id } }),
      ).toBeNull();
      expect(
        await prisma.user.findUnique({ where: { id: user.id } }),
      ).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(
        "ALTER TABLE compute_usage_carryover DROP CONSTRAINT refuse_carryover",
      );
    }
    // The site row the handler rolled back is not half-written.
    expect(await getSiteCreditUsage()).toBe(siteBefore);
  });
});

describe("account deletion", () => {
  // Mutation that turns this red: have add_compute_carryover write the owner's
  // row only, so the site total loses the deleted account's month. That the
  // purge names the table is guarded by accountPurge.unit.test.ts.
  it("keeps the account's credits in the site total and removes its own carry-over", async () => {
    const tag = randomUUID();
    const user = await prisma.user.create({
      data: {
        subject: `carryover-${tag}`,
        username: `co-${tag.slice(0, 8)}`,
        email: `co-${tag}@example.invalid`,
      },
    });
    await topoJob(user.id);
    await exportJob(user.id);
    const siteBefore = await getSiteCreditUsage();
    const owned = () =>
      prisma.computeUsageCarryover.count({ where: { userId: user.id } });

    const res = await request(API_URL)
      .delete("/users/me")
      .set(as(user.subject));
    expect(res.status).toBe(204);

    expect(await owned()).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await getSiteCreditUsage()).toBe(siteBefore);
  });
});

describe("the SQL that prices a job agrees with WORKER_SPECS", () => {
  // Mutation that turns this red: change the 8 or the 4 in the SQL functions
  // (a new migration) without WORKER_SPECS, or the reverse.
  it("charges one vCPU-minute per vCPU per minute", async () => {
    const [{ topo, topoExport }] = await prisma.$queryRaw<
      { topo: bigint; topoExport: bigint }[]
    >`
      SELECT
        topo_job_credits('complete', '{"wallSeconds": 60}'::jsonb, NOW()::timestamp, NOW()::timestamp)::bigint AS "topo",
        topo_export_job_credits('completed', NOW()::timestamp, (NOW() - interval '60 seconds')::timestamp)::bigint AS "topoExport"`;
    expect(Number(topo)).toBe(WORKER_SPECS.topo.vcpus);
    expect(Number(topoExport)).toBe(WORKER_SPECS.topoExport.vcpus);
  });

  // Mutation that turns this red: drop the Australia/Sydney conversion from
  // compute_month_start.
  it("names the month a job started in as currentMonthStart does, across DST", async () => {
    // Sydney's day-light saving ends 2026-04-05 and starts 2026-10-04.
    const instants = [
      "2026-03-31T13:30:00Z", // 00:30 on 1 April, +11
      "2026-03-31T12:59:00Z", // 23:59 on 31 March, +11
      "2026-05-15T00:00:00Z",
      "2026-09-30T13:59:00Z", // 23:59 on 30 September, +10
      "2026-09-30T14:00:00Z", // 00:00 on 1 October, +10
      "2026-10-31T13:00:00Z", // 00:00 on 1 November, +11
    ].map((s) => new Date(s));
    for (const at of instants) {
      const [{ month }] = await prisma.$queryRaw<{ month: Date }[]>`
        SELECT compute_month_start(${at}::timestamp) AS month`;
      expect(month.toISOString(), at.toISOString()).toBe(
        currentMonthStart(at).toISOString(),
      );
    }
  });
});
