import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import prisma from "../services/prisma";
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

// Plans: who is in a plan (routes/planMembers.ts). alice makes a plan and
// leads it; bob is an active member; carol's place in it is set per test.
// The plan has one form required to join, answered for leaders only. Answers
// and contacts are made up.
//
// Requires `make dev`. Every plan here is the test's own; the sweep removes
// it and the notifications it made.

let planId: string;
let formId: string;

const RULES = "I agree to the trip rules";
const SECRET = "Bad knee, take it slow";

async function membership(
  userId: string,
  status: "invited" | "requested" | "active",
  role: "leader" | "editor" | "member" = "member",
) {
  await prisma.tripPlanMember.upsert({
    where: { planId_userId: { planId, userId } },
    create: { planId, userId, status, role, invitedById: ALICE_ID },
    update: { status, role },
  });
}

/** The required form as shown, answered. */
async function joinAnswers(visibleTo = "leaders") {
  const form = await prisma.tripPlanForm.findUniqueOrThrow({
    where: { id: formId },
  });
  return {
    [formId]: {
      answers: { agree: true, notes: SECRET },
      visibleTo,
      formUpdatedAt: form.updatedAt.toISOString(),
    },
  };
}

async function planUpdatedAt(): Promise<number> {
  const plan = await prisma.tripPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  return plan.updatedAt.getTime();
}

/** Whether `write` moved the plan's watermark. */
async function touches(
  write: () => Promise<{ status: number; body: unknown }>,
) {
  const before = await planUpdatedAt();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const res = await write();
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  expect(await planUpdatedAt()).toBeGreaterThan(before);
}

async function notices(userId: string, type: string) {
  return prisma.notification.findMany({
    where: { userId, type, payload: { path: ["planId"], equals: planId } },
  });
}

const invite = (sub: string, body: object) =>
  request(API_URL).post(`/plans/${planId}/members`).set(as(sub)).send(body);
const remove = (sub: string, userId: string) =>
  request(API_URL).delete(`/plans/${planId}/members/${userId}`).set(as(sub));
const setRole = (sub: string, userId: string, role: string) =>
  request(API_URL)
    .patch(`/plans/${planId}/members/${userId}`)
    .set(as(sub))
    .send({ role });

beforeEach(async () => {
  const res = await request(API_URL)
    .post("/plans")
    .set(as(ALICE_SUB))
    .send({ name: "Members test weekend", startDate: "2026-11-08" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  planId = res.body.id;
  await membership(BOB_ID, "active");
  formId = (
    await prisma.tripPlanForm.create({
      data: {
        planId,
        title: "Trip rules",
        questions: [
          { id: "agree", kind: "agree", label: RULES, required: true },
          {
            id: "notes",
            kind: "longText",
            label: "Anything else",
            required: false,
          },
        ],
        visibleTo: "leaders",
        requiredToJoin: true,
        position: 0,
      },
    })
  ).id;
});

afterEach(async () => {
  await prisma.tripPlan.deleteMany({ where: { id: planId } });
});

describe("inviting by username", () => {
  it("invites as invited, never by email, and tells only the invitee", async () => {
    const res = await invite(ALICE_SUB, { username: "carol", role: "editor" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      user: { id: CAROL_ID, username: "carol" },
      role: "editor",
      status: "invited",
      invitedBy: { id: ALICE_ID, username: "alice" },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/@/);
    const [row] = await notices(CAROL_ID, "plan_invited");
    expect(row.payload).toEqual({ planId, invitedById: ALICE_ID });
  });

  it("refuses a member, yourself, an unknown name and someone already in", async () => {
    expect((await invite(BOB_SUB, { username: "carol" })).status).toBe(403);
    const self = await invite(ALICE_SUB, { username: "alice" });
    expect(self.status).toBe(400);
    expect(self.body.error).toBe("This is you.");
    const unknown = await invite(ALICE_SUB, { username: "nobody-here" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("Couldn't find anyone with that username.");
    const already = await invite(ALICE_SUB, { username: "bob" });
    expect(already.status).toBe(409);
    expect(already.body.error).toBe("They're already in this plan.");
  });

  // Mutation: drop the block check in POST /members.
  it("answers a block, either way, as an unknown username", async () => {
    // The seed's pending carol -> alice request, blocked for this test; the
    // sweep writes it back.
    await prisma.friendship.updateMany({
      where: { requesterId: CAROL_ID, addresseeId: ALICE_ID },
      data: { status: "blocked" },
    });
    try {
      const res = await invite(ALICE_SUB, { username: "carol" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Couldn't find anyone with that username.");
    } finally {
      await prisma.friendship.updateMany({
        where: { requesterId: CAROL_ID, addresseeId: ALICE_ID },
        data: { status: "pending" },
      });
    }
  });
});

describe("the invited preview and joining", () => {
  // Mutation: let the preview through for status "requested".
  it("shows someone invited the write-up, members and required forms, never answers", async () => {
    await invite(ALICE_SUB, { username: "carol" });
    await prisma.tripPlanAnswer.create({
      data: { formId, userId: BOB_ID, answers: { agree: true, notes: SECRET } },
    });
    const res = await request(API_URL)
      .get(`/plans/${planId}/preview`)
      .set(as(CAROL_SUB));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: planId,
      name: "Members test weekend",
      invitedBy: { id: ALICE_ID, username: "alice" },
      members: [
        { id: ALICE_ID, username: "alice" },
        { id: BOB_ID, username: "bob" },
      ],
    });
    expect(res.body.sections[0].title).toBe("Overview");
    expect(res.body.requiredForms).toMatchObject([
      { id: formId, title: "Trip rules", visibleTo: "leaders" },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);

    await membership(CAROL_ID, "requested");
    expect(
      (
        await request(API_URL)
          .get(`/plans/${planId}/preview`)
          .set(as(CAROL_SUB))
      ).status,
    ).toBe(404);
  });

  it("joins with the required answers, and tells the members", async () => {
    await invite(ALICE_SUB, { username: "carol" });
    const join = (answers: object) =>
      request(API_URL)
        .post(`/plans/${planId}/join`)
        .set(as(CAROL_SUB))
        .send({ answers });

    const none = await join({});
    expect(none.status).toBe(400);
    expect(none.body.error).toBe("Answer the forms marked required to join.");
    // Mutation: skip the visibleTo check in saveJoinAnswers.
    const widened = await join(await joinAnswers("members"));
    expect(widened.status).toBe(409);
    expect(widened.body.error).toBe(
      "Who sees the answers to this form has changed. Check it, then answer again.",
    );
    const stale = await joinAnswers();
    stale[formId].formUpdatedAt = "2020-01-01T00:00:00.000Z";
    expect((await join(stale)).status).toBe(409);

    await touches(async () => join(await joinAnswers()));
    const plan = await request(API_URL)
      .get(`/plans/${planId}`)
      .set(as(CAROL_SUB));
    expect(plan.status).toBe(200);
    expect(plan.body.myRole).toBe("member");
    expect(plan.body.forms[0].myAnswer.answers).toEqual({
      agree: true,
      notes: SECRET,
    });

    expect(await notices(CAROL_ID, "plan_invited")).toEqual([]);
    for (const userId of [ALICE_ID, BOB_ID]) {
      const [row] = await notices(userId, "plan_member_joined");
      expect(row.payload).toEqual({ planId, memberId: CAROL_ID });
    }
  });

  it("404s a join from anyone not invited", async () => {
    await membership(CAROL_ID, "requested");
    const res = await request(API_URL)
      .post(`/plans/${planId}/join`)
      .set(as(CAROL_SUB))
      .send({ answers: await joinAnswers() });
    expect(res.status).toBe(404);
  });
});

// The membership boundary (ADR 0002): only an active member reaches the plan
// or anything under it. Mutation: let requirePlanMember accept any status,
// or keep the row on remove.
describe("who reaches a plan", () => {
  const childRoutes = () => [
    request(API_URL).get(`/plans/${planId}`),
    request(API_URL).post(`/plans/${planId}/sections`).send({ title: "Gear" }),
    request(API_URL)
      .put(`/plans/${planId}/forms/${formId}/answers/me`)
      .send({ answers: {}, visibleTo: "leaders", formUpdatedAt: "x" }),
    request(API_URL).get(`/plans/${planId}/invites`),
    request(API_URL).post(`/plans/${planId}/members`).send({ username: "bob" }),
    request(API_URL)
      .patch(`/plans/${planId}/members/${BOB_ID}`)
      .send({ role: "editor" }),
    request(API_URL).delete(`/plans/${planId}/members/${BOB_ID}`),
  ];

  it.each([
    ["never in it", null],
    ["invited, not yet joined", "invited"],
    ["asking by link, not yet let in", "requested"],
    ["removed", "removed"],
  ] as const)(
    "404s someone %s, on the plan and every child route",
    async (_who, state) => {
      if (state === "removed") {
        await membership(CAROL_ID, "active");
        expect((await remove(ALICE_SUB, CAROL_ID)).status).toBe(204);
      } else if (state) await membership(CAROL_ID, state);
      for (const req of childRoutes()) {
        const res = await req.set(as(CAROL_SUB));
        expect(res.status, `${req.method} ${req.url}`).toBe(404);
      }
    },
  );
});

describe("roles", () => {
  it("a leader changes roles, but never leaves the plan without one", async () => {
    expect((await setRole(BOB_SUB, BOB_ID, "leader")).status).toBe(403);
    const last = await setRole(ALICE_SUB, "me", "member");
    expect(last.status).toBe(409);
    expect(last.body.error).toBe(
      "A plan needs a leader. Make someone else a leader first.",
    );
    await touches(() => setRole(ALICE_SUB, BOB_ID, "leader"));
    const stepDown = await setRole(ALICE_SUB, "me", "editor");
    expect(stepDown.status).toBe(200);
    expect(stepDown.body).toMatchObject({
      user: { id: ALICE_ID, username: "alice" },
      role: "editor",
    });
  });

  it("404s a role change for someone not active in the plan", async () => {
    await membership(CAROL_ID, "invited");
    expect((await setRole(ALICE_SUB, CAROL_ID, "editor")).status).toBe(404);
  });
});

describe("approving a request", () => {
  it("lets them in, tells them and the others, and drops the leaders' request rows", async () => {
    await membership(CAROL_ID, "requested");
    await prisma.notification.create({
      data: {
        userId: ALICE_ID,
        type: "plan_join_request",
        payload: { planId, requesterId: CAROL_ID },
      },
    });
    const approve = () =>
      request(API_URL)
        .post(`/plans/${planId}/members/${CAROL_ID}/approve`)
        .set(as(ALICE_SUB));
    await touches(approve);
    expect((await approve()).status).toBe(404);
    expect(
      (await request(API_URL).get(`/plans/${planId}`).set(as(CAROL_SUB)))
        .status,
    ).toBe(200);
    expect(await notices(ALICE_ID, "plan_join_request")).toEqual([]);
    const [approved] = await notices(CAROL_ID, "plan_join_approved");
    expect(approved.payload).toEqual({ planId, approvedById: ALICE_ID });
    const [joined] = await notices(BOB_ID, "plan_member_joined");
    expect(joined.payload).toEqual({ planId, memberId: CAROL_ID });
    // The approver did it; they are not told.
    expect(await notices(ALICE_ID, "plan_member_joined")).toEqual([]);
  });

  it("only a leader approves", async () => {
    await membership(CAROL_ID, "requested");
    const res = await request(API_URL)
      .post(`/plans/${planId}/members/${CAROL_ID}/approve`)
      .set(as(BOB_SUB));
    expect(res.status).toBe(403);
  });
});

describe("leaving and removing", () => {
  // Mutation: drop the answers deleteMany in DELETE /members.
  it("leaving takes the person's answers and access, and tells no one", async () => {
    await prisma.tripPlanAnswer.create({
      data: { formId, userId: BOB_ID, answers: { agree: true } },
    });
    await touches(() => remove(BOB_SUB, "me"));
    expect(await prisma.tripPlanAnswer.count({ where: { formId } })).toBe(0);
    expect(
      (await request(API_URL).get(`/plans/${planId}`).set(as(BOB_SUB))).status,
    ).toBe(404);
    expect(
      await prisma.notification.count({
        where: { payload: { path: ["planId"], equals: planId } },
      }),
    ).toBe(0);
  });

  it("the only one in a plan deletes it instead; the last leader hands over first", async () => {
    const lastLeader = await remove(ALICE_SUB, "me");
    expect(lastLeader.status).toBe(409);
    expect(lastLeader.body.error).toBe(
      "A plan needs a leader. Make someone else a leader first.",
    );
    expect((await remove(ALICE_SUB, BOB_ID)).status).toBe(204);
    const alone = await remove(ALICE_SUB, "me");
    expect(alone.status).toBe(409);
    expect(alone.body.error).toBe(
      "You're the only one in this plan. Delete it instead.",
    );
  });

  // Mutation: put the form label or an answer into plan_access_ended's payload.
  it("removing tells the person which plan, with no answers", async () => {
    await prisma.tripPlanAnswer.create({
      data: { formId, userId: BOB_ID, answers: { agree: true, notes: SECRET } },
    });
    expect((await remove(BOB_SUB, ALICE_ID)).status).toBe(403);
    await touches(() => remove(ALICE_SUB, BOB_ID));
    const [row] = await notices(BOB_ID, "plan_access_ended");
    expect(row.payload).toEqual({
      planId,
      reason: "removed",
      planName: "Members test weekend",
    });
    expect(JSON.stringify(row.payload)).not.toContain(SECRET);
    expect(JSON.stringify(row.payload)).not.toContain(RULES);
  });

  it("turning down a request tells them; cancelling an invite doesn't", async () => {
    await membership(CAROL_ID, "requested");
    await touches(() => remove(ALICE_SUB, CAROL_ID));
    const [declined] = await notices(CAROL_ID, "plan_access_ended");
    expect(declined.payload).toMatchObject({ reason: "declined" });

    await prisma.notification.deleteMany({
      where: {
        userId: CAROL_ID,
        type: "plan_access_ended",
        payload: { path: ["planId"], equals: planId },
      },
    });
    await invite(ALICE_SUB, { username: "carol" });
    expect((await remove(ALICE_SUB, CAROL_ID)).status).toBe(204);
    expect(await notices(CAROL_ID, "plan_invited")).toEqual([]);
    expect(await notices(CAROL_ID, "plan_access_ended")).toEqual([]);
  });

  it("declining an invite or withdrawing a request is the person's own DELETE", async () => {
    await invite(ALICE_SUB, { username: "carol" });
    expect((await remove(CAROL_SUB, "me")).status).toBe(204);
    expect(await notices(CAROL_ID, "plan_invited")).toEqual([]);

    await membership(CAROL_ID, "requested");
    await prisma.tripPlanAnswer.create({
      data: { formId, userId: CAROL_ID, answers: { agree: true } },
    });
    await prisma.notification.create({
      data: {
        userId: ALICE_ID,
        type: "plan_join_request",
        payload: { planId, requesterId: CAROL_ID },
      },
    });
    await touches(() => remove(CAROL_SUB, "me"));
    expect(await prisma.tripPlanAnswer.count({ where: { formId } })).toBe(0);
    expect(await notices(ALICE_ID, "plan_join_request")).toEqual([]);
  });
});

describe("deleting a plan", () => {
  // Mutation: drop the notifyPlan call in DELETE /plans/:id.
  it("tells everyone else with a row, and leaves nothing else about it", async () => {
    await membership(CAROL_ID, "requested");
    await prisma.notification.create({
      data: {
        userId: ALICE_ID,
        type: "plan_join_request",
        payload: { planId, requesterId: CAROL_ID },
      },
    });
    expect(
      (await request(API_URL).delete(`/plans/${planId}`).set(as(ALICE_SUB)))
        .status,
    ).toBe(204);
    const rows = await prisma.notification.findMany({
      where: { payload: { path: ["planId"], equals: planId } },
      orderBy: { userId: "asc" },
    });
    expect(rows.map((row) => [row.userId, row.type])).toEqual([
      [BOB_ID, "plan_access_ended"],
      [CAROL_ID, "plan_access_ended"],
    ]);
    expect(rows[0].payload).toEqual({
      planId,
      reason: "deleted",
      planName: "Members test weekend",
    });
  });
});

describe("the inbox", () => {
  // Mutation: drop the membership check for plan_join_request in
  // routes/notifications.ts.
  it("names the person and the plan while the request stands, then drops it", async () => {
    await membership(CAROL_ID, "requested");
    const row = await prisma.notification.create({
      data: {
        userId: ALICE_ID,
        type: "plan_join_request",
        payload: { planId, requesterId: CAROL_ID },
      },
    });
    const inbox = async () =>
      (
        await request(API_URL).get("/notifications").set(as(ALICE_SUB))
      ).body.find((n: { id: string }) => n.id === row.id);
    expect((await inbox()).payload).toMatchObject({
      planName: "Members test weekend",
      requesterUsername: "carol",
    });
    await membership(CAROL_ID, "active");
    expect(await inbox()).toBeUndefined();
  });

  it("GET /plans says who a request waits for", async () => {
    await membership(CAROL_ID, "requested");
    const res = await request(API_URL).get("/plans").set(as(CAROL_SUB));
    expect(res.body.plans).toContainEqual(
      expect.objectContaining({
        id: planId,
        status: "requested",
        waitingFor: { id: ALICE_ID, username: "alice" },
      }),
    );
  });
});
