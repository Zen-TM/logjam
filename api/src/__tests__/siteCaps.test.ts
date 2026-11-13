import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { currentMonthStart } from "@logjam/shared";
import prisma from "../services/prisma";
import { getEnv } from "../lib/env";
import { assertHasStorageQuota } from "../lib/storageQuota";
import {
  assertHasEgressQuota,
  exhaustedEgressOwnerIds,
} from "../lib/egressQuota";
import { API_URL, as } from "./_actors";
import { AppError } from "../middleware/errorHandler";

// Requires the database, not the API: the checks run in this process against
// the real rows. The two caps are site-wide (SITE_STORAGE_BYTES,
// SITE_MONTHLY_EGRESS_BYTES), so each test sets its cap a few bytes above or
// below what every account holds right now; files run one at a time
// (vitest.config.ts), so nothing else moves the sums meanwhile.
//
// Mutations that turn this red, one per test: in lib/storageQuota.ts drop
// `+ pendingBytes` from the site check ("refuses an upload that would pass the
// cap"); remove the `siteCap === 0` line in either file ("0 turns the cap
// off"); remove `where: { egressPeriodStart … }` in lib/egressQuota.ts ("counts
// a stale period as zero"); remove the `siteEgressSpent` line in
// `exhaustedEgressOwnerIds` ("returns no items once everyone together has
// passed the cap" and "returns them with the cap at 0").

const env = getEnv();
const original = {
  storage: env.SITE_STORAGE_BYTES,
  egress: env.SITE_MONTHLY_EGRESS_BYTES,
};
afterEach(() => {
  env.SITE_STORAGE_BYTES = original.storage;
  env.SITE_MONTHLY_EGRESS_BYTES = original.egress;
});

const created: string[] = [];
async function newUser(data: {
  egressUsed?: bigint;
  egressPeriodStart?: Date;
}) {
  const tag = randomUUID();
  const user = await prisma.user.create({
    data: {
      subject: `site-caps-${tag}`,
      username: `sc-${tag.slice(0, 8)}`,
      email: `sc-${tag}@example.invalid`,
      monthlyEgressUsedBytes: data.egressUsed,
      egressPeriodStart: data.egressPeriodStart,
    },
  });
  created.push(user.id);
  return user;
}
// After each test, not at the end: a row left over would count in the next
// test's site sum.
afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created.splice(0) } } });
});

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (err: unknown) => err as AppError,
  );

describe("the site-wide storage cap", () => {
  async function allStored() {
    const { _sum } = await prisma.user.aggregate({
      _sum: { storageUsedBytes: true },
    });
    return Number(_sum.storageUsedBytes ?? 0n);
  }

  it("lets an upload under the cap through", async () => {
    const user = await newUser({});
    env.SITE_STORAGE_BYTES = (await allStored()) + 1000;
    await expect(assertHasStorageQuota(user.id, 500n)).resolves.toBeUndefined();
    // A file the write replaces is credited first, as for the user's own quota.
    await expect(
      assertHasStorageQuota(user.id, 1500n, prisma, 600n),
    ).resolves.toBeUndefined();
  });

  it("refuses an upload that would pass the cap", async () => {
    const user = await newUser({});
    env.SITE_STORAGE_BYTES = (await allStored()) + 1000;
    const err = await refusal(assertHasStorageQuota(user.id, 2000n));
    expect(err?.statusCode).toBe(429);
    // Not the user's to fix: no figure goes back, and the sentence does not
    // send them to delete their own files.
    expect(err?.details).toBeUndefined();
    expect(err?.message).not.toMatch(/delete|free|your/i);
  });

  it("refuses at the cap even for an upload of no declared size", async () => {
    const user = await newUser({});
    // Stored bytes of its own, so the cap below is not 0 (off) on a seed with none.
    await prisma.user.update({
      where: { id: user.id },
      data: { storageUsedBytes: 1000n },
    });
    env.SITE_STORAGE_BYTES = await allStored();
    expect((await refusal(assertHasStorageQuota(user.id)))?.statusCode).toBe(
      429,
    );
  });

  it("tells a user over their own quota about that quota first", async () => {
    const user = await newUser({});
    await prisma.user.update({
      where: { id: user.id },
      data: { storageUsedBytes: user.storageQuotaBytes },
    });
    env.SITE_STORAGE_BYTES = 1;
    expect((await refusal(assertHasStorageQuota(user.id)))?.statusCode).toBe(
      507,
    );
  });

  it("0 turns the cap off", async () => {
    const user = await newUser({});
    env.SITE_STORAGE_BYTES = 0;
    await expect(assertHasStorageQuota(user.id, 1n)).resolves.toBeUndefined();
  });
});

describe("the site-wide download cap", () => {
  async function allDownloaded() {
    const { _sum } = await prisma.user.aggregate({
      _sum: { monthlyEgressUsedBytes: true },
      where: { egressPeriodStart: { gte: currentMonthStart() } },
    });
    return Number(_sum.monthlyEgressUsedBytes ?? 0n);
  }

  it("lets a download under the cap through", async () => {
    const user = await newUser({});
    env.SITE_MONTHLY_EGRESS_BYTES = (await allDownloaded()) + 1000;
    await expect(assertHasEgressQuota(user.id)).resolves.toBeUndefined();
  });

  it("refuses a download once everyone together has passed the cap", async () => {
    const user = await newUser({ egressUsed: 2000n });
    env.SITE_MONTHLY_EGRESS_BYTES = (await allDownloaded()) - 1000;
    const err = await refusal(assertHasEgressQuota(user.id));
    expect(err?.statusCode).toBe(429);
    // The reset date only: the pool's size and use are not the user's to see.
    expect(err?.details?.resetAt).toBeDefined();
    expect(err?.details?.used).toBeUndefined();
    expect(err?.message).not.toMatch(/delete|your/i);
  });

  it("0 turns the cap off", async () => {
    const user = await newUser({ egressUsed: 2000n });
    env.SITE_MONTHLY_EGRESS_BYTES = 0;
    await expect(assertHasEgressQuota(user.id)).resolves.toBeUndefined();
  });

  it("counts a stale period as zero", async () => {
    const lastMonth = new Date(currentMonthStart().getTime() - 86_400_000);
    const stale = await newUser({
      egressUsed: 10n ** 12n,
      egressPeriodStart: lastMonth,
    });
    const checker = await newUser({});
    env.SITE_MONTHLY_EGRESS_BYTES = (await allDownloaded()) + 1000;
    await expect(assertHasEgressQuota(checker.id)).resolves.toBeUndefined();

    // The same row in the current month is what the cap exists for.
    await prisma.user.update({
      where: { id: stale.id },
      data: { egressPeriodStart: new Date() },
    });
    expect((await refusal(assertHasEgressQuota(checker.id)))?.statusCode).toBe(
      429,
    );
  });
});

describe("the bulk photo and file pull", () => {
  // POST /media/download-urls has no per-request download check, only
  // exhaustedEgressOwnerIds, so the site cap has to reach it there. The API
  // under test keeps SITE_MONTHLY_EGRESS_BYTES at its 300 GiB default.
  const TIB = 1024n ** 4n;

  async function pull(owner: { id: string; subject: string }) {
    const media = await prisma.media.create({
      data: {
        ownerId: owner.id,
        linkedType: "none",
        s3KeyDisplay: `site-caps/${randomUUID()}.gpx`,
        mediaType: "application/gpx+xml",
        filename: "walk.gpx",
        fileSizeBytes: 100n,
      },
    });
    const res = await request(API_URL)
      .post("/media/download-urls")
      .set(as(owner.subject))
      .send({ ids: [media.id] });
    expect(res.status).toBe(200);
    return { items: res.body.items as unknown[] };
  }

  it("returns no items once everyone together has passed the cap", async () => {
    const owner = await newUser({});
    expect((await pull(owner)).items).toHaveLength(1);

    const heavy = await newUser({ egressUsed: TIB });
    expect((await pull(owner)).items).toEqual([]);

    await prisma.user.delete({ where: { id: heavy.id } });
    expect((await pull(owner)).items).toHaveLength(1);
  });

  it("returns them with the cap at 0", async () => {
    const owner = await newUser({});
    await newUser({ egressUsed: TIB });
    expect([...(await exhaustedEgressOwnerIds([owner.id]))]).toEqual([
      owner.id,
    ]);
    env.SITE_MONTHLY_EGRESS_BYTES = 0;
    expect([...(await exhaustedEgressOwnerIds([owner.id]))]).toEqual([]);
  });
});
