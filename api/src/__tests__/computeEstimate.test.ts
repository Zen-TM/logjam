import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import prisma from "../services/prisma";
import { API_URL, as, BOB_SUB, BOB_ID } from "./_actors";

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
    // An export of a topo is no longer made, so no longer estimated.
    expect(
      (
        await estimate({
          kind: "topoExport",
          sourceJobId: randomUUID(),
          format: "mbtiles",
          bundling: "composite",
        })
      ).status,
    ).toBe(400);
    // A GeoPDF is rendered in the browser, so no longer estimated.
    expect((await estimate({ kind: "geoPdf", config: {} })).status).toBe(400);
    expect((await estimate({ kind: "geoPdf" })).status).toBe(400);
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
