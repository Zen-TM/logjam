import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import prisma from "../services/prisma";
import { API_URL, as, ALICE_SUB, BOB_SUB, BOB_ID, CAROL_SUB } from "./_actors";

// Requires `make dev` (AUTH_MODE=fake). The estimator is read-only, so these
// drive it as bob (whose quota the boundary test edits) and restore it after.
const BOB = as(BOB_SUB);

function estimate(body: unknown, headers = BOB) {
  return request(API_URL)
    .post("/compute-estimate")
    .set(headers)
    .send(body as object);
}

describe("POST /compute-estimate — validation", () => {
  it("400s a malformed body for each kind", async () => {
    expect((await estimate({})).status).toBe(400);
    expect((await estimate({ kind: "nope" })).status).toBe(400);
    expect((await estimate({ kind: "topo", tileCount: "many" })).status).toBe(
      400,
    );
    expect((await estimate({ kind: "topo", tileCount: -1 })).status).toBe(400);
    expect((await estimate({ kind: "topoExport" })).status).toBe(400);
    expect(
      (
        await estimate({
          kind: "topoExport",
          sourceJobId: randomUUID(),
          format: "not-a-format",
          bundling: "composite",
        })
      ).status,
    ).toBe(400);
    expect((await estimate({ kind: "geoPdf", config: {} })).status).toBe(400);
    expect((await estimate({ kind: "geoPdf" })).status).toBe(400);
  });
});

describe("POST /compute-estimate — topoExport source job", () => {
  const created: string[] = [];
  afterAll(async () => {
    await prisma.topoJob.deleteMany({ where: { id: { in: created } } });
  });

  it("404s (never 403) a job the caller neither owns nor is shared", async () => {
    const res = await request(API_URL)
      .post("/topo-jobs")
      .set(as(ALICE_SUB))
      .send({ jobName: "estimate-source" });
    expect(res.status).toBe(201);
    const jobId: string = res.body.jobId;
    created.push(jobId);

    const body = {
      kind: "topoExport",
      sourceJobId: jobId,
      format: "mbtiles",
      bundling: "composite",
    };
    // carol owns nothing here and has no share; an unknown id answers the same.
    expect((await estimate(body, as(CAROL_SUB))).status).toBe(404);
    expect(
      (await estimate({ ...body, sourceJobId: randomUUID() }, as(CAROL_SUB)))
        .status,
    ).toBe(404);
  });
});

describe("POST /compute-estimate — credits and wouldExceed", () => {
  let originalQuota: number | undefined;
  afterAll(async () => {
    if (originalQuota !== undefined) {
      await prisma.user.update({
        where: { id: BOB_ID },
        data: { monthlyComputeCredits: originalQuota },
      });
    }
  });

  it("keeps credits null (never 0) when there is no estimate", async () => {
    const res = await estimate({ kind: "topo", tileCount: null });
    expect(res.status).toBe(200);
    expect(res.body.estimatedSeconds).toBeNull();
    expect(res.body.credits).toBeNull();
    expect(res.body.wouldExceed).toBe(res.body.used >= res.body.quota);
  });

  it("flips wouldExceed exactly when used + credits passes the quota", async () => {
    const probe = await estimate({ kind: "topo", tileCount: 1 });
    expect(probe.status).toBe(200);
    const { credits, used } = probe.body as { credits: number; used: number };
    expect(credits).toBeGreaterThan(0);

    originalQuota = (
      await prisma.user.findUniqueOrThrow({ where: { id: BOB_ID } })
    ).monthlyComputeCredits;
    const setQuota = (q: number) =>
      prisma.user.update({
        where: { id: BOB_ID },
        data: { monthlyComputeCredits: q },
      });

    await setQuota(used + credits);
    expect(
      (await estimate({ kind: "topo", tileCount: 1 })).body.wouldExceed,
    ).toBe(false);
    await setQuota(used + credits - 1);
    expect(
      (await estimate({ kind: "topo", tileCount: 1 })).body.wouldExceed,
    ).toBe(true);
  });
});
