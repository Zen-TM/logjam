import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { WORKER_SPECS, currentMonthStart } from "@logjam/shared";
import { API_URL, as, BOB_SUB, BOB_ID } from "./_actors";
import prisma from "../services/prisma";
import { getSiteCreditUsage } from "../lib/computeCredits";

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

  const estimate = () =>
    request(API_URL)
      .post("/compute-estimate")
      .set(BOB)
      .send({ kind: "topo", tileCount: null });

  // Mutation that turns this red: drop poolHasNoRoomFor from the route's
  // wouldExceed.
  it("tells the estimate that a spent pool would refuse, with the API's sentence", async () => {
    const open = await estimate();
    expect(open.body.wouldExceed).toBe(false);
    expect(open.body).not.toHaveProperty("refusal");

    await spent();
    const res = await estimate();
    expect(res.status).toBe(200);
    expect(res.body.wouldExceed).toBe(true);
    expect(res.body.refusal).toMatch(/everyone on Logjam/);
    // used and quota stay the user's own.
    expect(res.body.quota).toBe(open.body.quota);
    expect(res.body.used).toBe(open.body.used);
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

describe("a carry-over that fails never blocks a delete", () => {
  // A wallSeconds that is not a number makes topo_job_credits raise inside the
  // trigger. Mutation that turns this red: remove the EXCEPTION handler from
  // carry_over_topo_job in the migration.
  const badJob = (userId: string) =>
    prisma.topoJob.create({
      data: {
        userId,
        status: "complete",
        startedAt: new Date(),
        pipelineMetrics: { wallSeconds: "not a number" },
      },
    });

  it("deletes the row, and the account that owns one", async () => {
    const tag = randomUUID();
    const user = await prisma.user.create({
      data: {
        subject: `carryover-bad-${tag}`,
        username: `cb-${tag.slice(0, 8)}`,
        email: `cb-${tag}@example.invalid`,
      },
    });
    const siteBefore = await prisma.siteComputeCarryover.count();

    const job = await badJob(user.id);
    await prisma.topoJob.delete({ where: { id: job.id } });
    expect(
      await prisma.topoJob.findUnique({ where: { id: job.id } }),
    ).toBeNull();

    const other = await badJob(user.id);
    const res = await request(API_URL)
      .delete("/users/me")
      .set(as(user.subject));
    expect(res.status).toBe(204);
    expect(
      await prisma.topoJob.findUnique({ where: { id: other.id } }),
    ).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    // Nothing was carried over for either.
    expect(await prisma.siteComputeCarryover.count()).toBe(siteBefore);
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
        topo_export_job_credits(NOW()::timestamp, (NOW() - interval '60 seconds')::timestamp)::bigint AS "topoExport"`;
    expect(Number(topo)).toBe(WORKER_SPECS.topo.vcpus);
    expect(Number(topoExport)).toBe(WORKER_SPECS.topoExport.vcpus);
  });

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
