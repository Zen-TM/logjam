import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import prisma from "../services/prisma";
import {
  hashFriendInviteToken,
  mintFriendInviteToken,
} from "../lib/friendInviteToken";
import {
  API_URL,
  ALICE_ID,
  ALICE_SUB,
  BOB_ID,
  BOB_SUB,
  CAROL_ID,
  CAROL_SUB,
  as,
} from "./_actors";

// Plans: invite links (routes/planInvites.ts). alice leads a plan of her
// own with bob in it and one form required to join; carol holds the link.
// Links are written straight to the table except where minting is the test:
// the mint limiter allows 20 an hour per user, across reruns. carol's
// previews and redeems stay under the redeem limiter's 20 a minute. Answers
// are made up.
//
// Requires `make dev`.
//
// Mutations that turn it red: return members, sections or answers from
// /plan-invites/preview; give an expired, revoked or archived plan's link a
// different status or message from an unknown one; return the token or its
// hash from GET /plans/:planId/invites; let an unapproved requester reach
// GET /plans/:id; notify leaders on every redeem.

let planId: string;
let formId: string;
let token: string;

const UNKNOWN_TOKEN = "A".repeat(43);
const SECTION = "Meet at the Mount Wilson fire station";

async function link(expiresInMs = 86_400_000): Promise<string> {
  const value = mintFriendInviteToken();
  await prisma.tripPlanInvite.create({
    data: {
      planId,
      createdById: ALICE_ID,
      tokenHash: hashFriendInviteToken(value),
      expiresAt: new Date(Date.now() + expiresInMs),
    },
  });
  return value;
}

async function joinAnswers() {
  const form = await prisma.tripPlanForm.findUniqueOrThrow({
    where: { id: formId },
  });
  return {
    [formId]: {
      answers: { agree: true },
      visibleTo: form.visibleTo,
      formUpdatedAt: form.updatedAt.toISOString(),
    },
  };
}

const preview = (sub: string, value: unknown) =>
  request(API_URL)
    .post("/plan-invites/preview")
    .set(as(sub))
    .send({ token: value });
const redeem = async (sub: string, value: unknown, answers?: object) =>
  request(API_URL)
    .post("/plan-invites/redeem")
    .set(as(sub))
    .send({ token: value, answers: answers ?? (await joinAnswers()) });

beforeEach(async () => {
  const res = await request(API_URL)
    .post("/plans")
    .set(as(ALICE_SUB))
    .send({ name: "Link test weekend", startDate: "2026-11-08" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  planId = res.body.id;
  await prisma.tripPlanMember.create({
    data: { planId, userId: BOB_ID, role: "member", status: "active" },
  });
  await prisma.tripPlanSection.updateMany({
    where: { planId },
    data: { body: SECTION },
  });
  formId = (
    await prisma.tripPlanForm.create({
      data: {
        planId,
        title: "Trip rules",
        questions: [
          { id: "agree", kind: "agree", label: "I agree", required: true },
        ],
        visibleTo: "members",
        requiredToJoin: true,
        position: 0,
      },
    })
  ).id;
  token = await link();
});

afterEach(async () => {
  await prisma.tripPlan.deleteMany({ where: { id: planId } });
});

describe("a leader's links", () => {
  it("mints, lists without the link, and revokes; members can't", async () => {
    expect(
      (await request(API_URL).post(`/plans/${planId}/invites`).set(as(BOB_SUB)))
        .status,
    ).toBe(403);
    const minted = await request(API_URL)
      .post(`/plans/${planId}/invites`)
      .set(as(ALICE_SUB));
    expect(minted.status).toBe(201);
    const days = (Date.parse(minted.body.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    const list = await request(API_URL)
      .get(`/plans/${planId}/invites`)
      .set(as(ALICE_SUB));
    expect(list.status).toBe(200);
    expect(list.body.invites).toHaveLength(2);
    expect(list.body.invites[0]).toMatchObject({
      createdBy: { id: ALICE_ID, username: "alice" },
    });
    const listed = JSON.stringify(list.body);
    expect(listed).not.toContain(minted.body.token);
    expect(listed).not.toContain(hashFriendInviteToken(minted.body.token));

    const revoke = await request(API_URL)
      .delete(`/plans/${planId}/invites/${list.body.invites[0].id}`)
      .set(as(ALICE_SUB));
    expect(revoke.status).toBe(204);
    expect((await preview(CAROL_SUB, minted.body.token)).status).toBe(404);
  });
});

describe("holding a link", () => {
  it("previews the name, dates, leader and required forms, never who or what", async () => {
    await prisma.tripPlanAnswer.create({
      data: { formId, userId: BOB_ID, answers: { agree: true } },
    });
    const res = await preview(CAROL_SUB, token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      planId,
      name: "Link test weekend",
      startDate: "2026-11-08",
      endDate: null,
      leader: { id: ALICE_ID, username: "alice" },
      requiredForms: [
        expect.objectContaining({ id: formId, visibleTo: "members" }),
      ],
      membership: null,
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("bob");
    expect(body).not.toContain(SECTION);
    expect(body).not.toContain("answers");
  });

  // One answer for every way a link fails, so a response can't tell a spent
  // link from one that never existed.
  it("gives one identical 404 for an unknown, malformed, expired, revoked or archived plan's link", async () => {
    const expired = await link(-1000);
    const revoked = await link();
    await prisma.tripPlanInvite.deleteMany({
      where: { tokenHash: hashFriendInviteToken(revoked) },
    });
    const bodies = [];
    for (const value of [UNKNOWN_TOKEN, "short", 42, expired, revoked])
      bodies.push(await preview(BOB_SUB, value));
    await prisma.tripPlan.update({
      where: { id: planId },
      data: { archivedAt: new Date() },
    });
    bodies.push(await preview(BOB_SUB, token));
    bodies.push(await redeem(CAROL_SUB, token));
    // Everything but the request's own id.
    const answer = ({ requestId: _, ...rest }: Record<string, unknown>) => rest;
    for (const res of bodies) {
      expect(res.status).toBe(404);
      expect(answer(res.body)).toEqual(answer(bodies[0].body));
    }
    expect(bodies[0].body.error).toBe("This invite link no longer works.");
  });

  it("asks to join: leaders are told once, and the plan stays shut until one approves", async () => {
    const asked = await redeem(CAROL_SUB, token);
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    expect(asked.body).toEqual({
      planId,
      status: "requested",
      waitingFor: { id: ALICE_ID, username: "alice" },
    });
    expect(
      (await request(API_URL).get(`/plans/${planId}`).set(as(CAROL_SUB)))
        .status,
    ).toBe(404);
    const requests = () =>
      prisma.notification.findMany({
        where: {
          type: "plan_join_request",
          payload: { path: ["planId"], equals: planId },
        },
      });
    const [row] = await requests();
    expect(row.userId).toBe(ALICE_ID);
    expect(row.payload).toEqual({ planId, requesterId: CAROL_ID });

    // Again, as a dialog sent twice would: answers replaced, nobody told twice.
    expect((await redeem(CAROL_SUB, token)).status).toBe(201);
    expect(await requests()).toHaveLength(1);
    // The link is multi-use.
    expect((await preview(CAROL_SUB, token)).body.membership).toBe("requested");

    const approve = await request(API_URL)
      .post(`/plans/${planId}/members/${CAROL_ID}/approve`)
      .set(as(ALICE_SUB));
    expect(approve.status).toBe(200);
    const plan = await request(API_URL)
      .get(`/plans/${planId}`)
      .set(as(CAROL_SUB));
    expect(plan.status).toBe(200);
    expect(plan.body.forms[0].myAnswer.answers).toEqual({ agree: true });
  });

  it("refuses a request without the forms required to join", async () => {
    const res = await redeem(CAROL_SUB, token, {});
    expect(res.status).toBe(400);
    expect(
      await prisma.tripPlanMember.count({
        where: { planId, userId: CAROL_ID },
      }),
    ).toBe(0);
  });

  it("joins someone already invited by username at once, and leaves a member as is", async () => {
    await prisma.tripPlanMember.create({
      data: {
        planId,
        userId: CAROL_ID,
        role: "member",
        status: "invited",
        invitedById: ALICE_ID,
      },
    });
    const joined = await redeem(CAROL_SUB, token);
    expect(joined.status).toBe(200);
    expect(joined.body).toEqual({ planId, status: "active" });
    const member = await redeem(BOB_SUB, token, {});
    expect(member.status).toBe(200);
    expect(member.body).toEqual({ planId, status: "active" });
  });

  // Mutations: drop the block check in resolveLink; drop its
  // leaders-blocked-the-caller arm; narrow it to the link's maker.
  it("answers a block, either way, with any leader as a dead link", async () => {
    await prisma.tripPlanMember.update({
      where: { planId_userId: { planId, userId: BOB_ID } },
      data: { role: "leader" },
    });
    const dead = async (sub: string) => {
      const res = await preview(sub, token);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("This invite link no longer works.");
    };
    const block = (requesterId: string, addresseeId: string, status: string) =>
      prisma.friendship.updateMany({
        where: { requesterId, addresseeId },
        data: { status },
      });
    try {
      // The caller blocked the link's maker.
      await block(CAROL_ID, ALICE_ID, "blocked");
      await dead(CAROL_SUB);
      expect((await redeem(CAROL_SUB, token)).status).toBe(404);
      await block(CAROL_ID, ALICE_ID, "pending");
      // Another leader, not the link's maker, blocked the caller.
      await block(BOB_ID, CAROL_ID, "blocked");
      await dead(CAROL_SUB);
    } finally {
      // The seed's rows; the sweep would write them back too.
      await block(CAROL_ID, ALICE_ID, "pending");
      await block(BOB_ID, CAROL_ID, "accepted");
    }
    expect(
      await prisma.tripPlanMember.count({
        where: { planId, userId: CAROL_ID },
      }),
    ).toBe(0);
  });

  // Mutation: store the link's invitedById on a repeat request without
  // updating it, or let a 201 name a leader the row doesn't.
  it("waits for the leader whose link was used last, in the 201 and in GET /plans", async () => {
    await prisma.tripPlanMember.update({
      where: { planId_userId: { planId, userId: BOB_ID } },
      data: { role: "leader" },
    });
    const bobsLink = mintFriendInviteToken();
    await prisma.tripPlanInvite.create({
      data: {
        planId,
        createdById: BOB_ID,
        tokenHash: hashFriendInviteToken(bobsLink),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect((await redeem(CAROL_SUB, token)).body.waitingFor).toEqual({
      id: ALICE_ID,
      username: "alice",
    });
    const again = await redeem(CAROL_SUB, bobsLink);
    expect(again.status).toBe(201);
    expect(again.body.waitingFor).toEqual({ id: BOB_ID, username: "bob" });
    const list = await request(API_URL).get("/plans").set(as(CAROL_SUB));
    expect(
      list.body.plans.find((p: { id: string }) => p.id === planId).waitingFor,
    ).toEqual({ id: BOB_ID, username: "bob" });
  });
});

// A redeem reads the link, then waits behind the plan row (touchPlan). What
// lands in that wait is staged here: the test takes the plan row, starts the
// redeem, makes its change in the same transaction, and lets go. Mutation:
// drop the invite re-read in request() (planInvites.ts).
describe("redeeming while the plan changes", () => {
  async function racing(
    during: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    const answers = await joinAnswers();
    let pending!: Promise<{ status: number; body: Record<string, unknown> }>;
    await prisma.$transaction(
      async (tx) => {
        await tx.tripPlan.update({
          where: { id: planId },
          data: { updatedAt: new Date() },
        });
        pending = new Promise((resolve, reject) => {
          redeem(CAROL_SUB, token, answers).then(resolve, reject);
        });
        // Long enough for the redeem to read the link and reach touchPlan.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await during(tx);
      },
      { timeout: 10_000 },
    );
    return pending;
  }

  it.each([
    [
      "revoked",
      (tx: Prisma.TransactionClient) =>
        tx.tripPlanInvite.deleteMany({ where: { planId } }),
    ],
    [
      "archived",
      (tx: Prisma.TransactionClient) =>
        tx.tripPlan.update({
          where: { id: planId },
          data: { archivedAt: new Date() },
        }),
    ],
  ] as const)(
    "a link %s meanwhile is dead, and asks nothing",
    async (_, change) => {
      const res = await racing(change);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("This invite link no longer works.");
      expect(
        await prisma.tripPlanMember.count({
          where: { planId, userId: CAROL_ID },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: { payload: { path: ["planId"], equals: planId } },
        }),
      ).toBe(0);
    },
  );

  // Mutation: answer an active row with the 409 for a racing invite.
  it("someone let in meanwhile is told they're in", async () => {
    expect((await redeem(CAROL_SUB, token)).status).toBe(201);
    const res = await racing((tx) =>
      tx.tripPlanMember.update({
        where: { planId_userId: { planId, userId: CAROL_ID } },
        data: { status: "active" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ planId, status: "active" });
  });
});
