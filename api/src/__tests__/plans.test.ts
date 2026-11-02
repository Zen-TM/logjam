import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { TRIP_PLAN_MAX_SECTIONS } from "@logjam/shared";
import prisma from "../services/prisma";
import {
  API_URL,
  ALICE_ID,
  ALICE_SUB,
  BOB_ID,
  BOB_SUB,
  CAROL_ID,
  CAROL_SUB,
  NONEXISTENT_ID,
  as,
} from "./_actors";

// Plans: the plan itself and its write-up. alice makes a plan and leads it;
// bob is an active member; carol's membership is set per test (none,
// invited, requested, active editor). Members are written straight to the
// table: the routes that invite and let people in come later.
//
// Requires `make dev`. Every plan here is the test's own; the sweep removes it.

let planId: string;

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

async function planUpdatedAt(): Promise<Date> {
  const plan = await prisma.tripPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  return plan.updatedAt;
}

/** Whether `write` moved the plan's watermark. */
async function touches(write: () => Promise<{ status: number }>) {
  const before = await planUpdatedAt();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const res = await write();
  expect(res.status).toBeLessThan(300);
  expect((await planUpdatedAt()).getTime()).toBeGreaterThan(before.getTime());
}

beforeEach(async () => {
  const res = await request(API_URL)
    .post("/plans")
    .set(as(ALICE_SUB))
    .send({
      name: "  Test canyon weekend ",
      startDate: "2026-11-08",
      endDate: "2026-11-09",
      tripTypes: ["canyoning"],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  planId = res.body.id;
  await membership(BOB_ID, "active");
});

afterEach(async () => {
  await prisma.tripPlan.deleteMany({ where: { id: planId } });
});

describe("POST /plans", () => {
  it("makes the caller its leader, with no section", async () => {
    const res = await request(API_URL)
      .get(`/plans/${planId}`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Test canyon weekend",
      startDate: "2026-11-08",
      endDate: "2026-11-09",
      tripTypes: ["canyoning"],
      archivedAt: null,
      createdBy: { id: ALICE_ID, username: "alice" },
      myRole: "leader",
      places: [],
      routes: [],
      files: [],
      forms: [],
    });
    expect(res.body.sections).toEqual([]);
  });

  it("refuses a nameless plan and one that ends before it starts", async () => {
    const nameless = await request(API_URL)
      .post("/plans")
      .set(as(BOB_SUB))
      .send({ name: " " });
    expect(nameless.status).toBe(400);
    expect(nameless.body.error).toBe("Give the plan a name.");
    const backwards = await request(API_URL)
      .post("/plans")
      .set(as(BOB_SUB))
      .send({ name: "x", startDate: "2026-11-09", endDate: "2026-11-08" });
    expect(backwards.status).toBe(400);
    const tooMany = await request(API_URL)
      .post("/plans")
      .set(as(BOB_SUB))
      .send({
        name: "x",
        tripTypes: Array.from({ length: 11 }, (_, i) => `t${i}`),
      });
    expect(tooMany.status).toBe(413);
  });
});

describe("GET /plans", () => {
  // Mutation: count every form rather than those the caller hasn't answered,
  // or count for a plan the caller only has an invite to.
  it("counts the forms the caller hasn't answered", async () => {
    // Undated, so the count doesn't lapse when the fixed dates pass.
    await prisma.tripPlan.update({
      where: { id: planId },
      data: { startDate: null, endDate: null },
    });
    const [a, b] = await Promise.all(
      ["A", "B"].map((title, position) =>
        prisma.tripPlanForm.create({
          data: { planId, title, visibleTo: "leaders", position },
        }),
      ),
    );
    await prisma.tripPlanAnswer.create({
      data: { formId: a.id, userId: BOB_ID, answers: {} },
    });
    const count = async (sub: string) =>
      (await request(API_URL).get("/plans").set(as(sub))).body.plans.find(
        (plan: { id: string }) => plan.id === planId,
      )?.unansweredForms;
    expect(await count(BOB_SUB)).toBe(1);
    // Alice leads the plan: made the forms, never nudged.
    expect(await count(ALICE_SUB)).toBe(0);
    await prisma.tripPlanAnswer.create({
      data: { formId: b.id, userId: BOB_ID, answers: {} },
    });
    expect(await count(BOB_SUB)).toBe(0);
    await membership(CAROL_ID, "invited");
    expect(await count(CAROL_SUB)).toBe(0);
  });

  // Mutation: count for an archived or finished plan, whose page shows no
  // forms to answer (`tripPlanFormsToAnswer`).
  it("counts nothing for an archived or finished plan", async () => {
    await prisma.tripPlanForm.create({
      data: { planId, title: "A", visibleTo: "leaders", position: 0 },
    });
    const count = async () =>
      (await request(API_URL).get("/plans").set(as(BOB_SUB))).body.plans.find(
        (plan: { id: string }) => plan.id === planId,
      )?.unansweredForms;
    await prisma.tripPlan.update({
      where: { id: planId },
      data: { startDate: null, endDate: null },
    });
    expect(await count()).toBe(1);
    await prisma.tripPlan.update({
      where: { id: planId },
      data: { archivedAt: new Date() },
    });
    expect(await count()).toBe(0);
    await prisma.tripPlan.update({
      where: { id: planId },
      data: {
        archivedAt: null,
        startDate: new Date("2020-01-01"),
        endDate: new Date("2020-01-02"),
      },
    });
    expect(await count()).toBe(0);
  });

  it("lists every plan the caller is in, invited to or asking to join", async () => {
    const mine = await request(API_URL).get("/plans").set(as(BOB_SUB));
    expect(mine.body.plans).toContainEqual(
      expect.objectContaining({ id: planId, status: "active", role: "member" }),
    );

    const none = await request(API_URL).get("/plans").set(as(CAROL_SUB));
    expect(JSON.stringify(none.body)).not.toContain(planId);

    await membership(CAROL_ID, "invited");
    const invited = await request(API_URL).get("/plans").set(as(CAROL_SUB));
    expect(invited.body.plans).toContainEqual(
      expect.objectContaining({
        id: planId,
        status: "invited",
        invitedBy: { id: ALICE_ID, username: "alice" },
      }),
    );
  });
});

// The plan boundary (ADR 0002): only an active member sees the plan; anyone
// else gets the answer a missing plan gets. Mutation: let requirePlanMember
// accept any status.
describe("who sees a plan", () => {
  it.each([
    ["not in it", null],
    ["invited", "invited"],
    ["asking to join", "requested"],
  ] as const)("404s for someone %s", async (_who, status) => {
    if (status) await membership(CAROL_ID, status);
    const res = await request(API_URL)
      .get(`/plans/${planId}`)
      .set(as(CAROL_SUB));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Couldn't find that plan.");
    const write = await request(API_URL)
      .post(`/plans/${planId}/sections`)
      .set(as(CAROL_SUB))
      .send({ title: "Gear" });
    expect(write.status).toBe(404);
  });

  it("404s a plan that isn't there", async () => {
    const res = await request(API_URL)
      .get(`/plans/${NONEXISTENT_ID}`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(404);
  });

  // Mutation: drop the leader filter on `members` in loadPlanView, or add
  // `email: true` to `userRef` in lib/tripPlanView.ts (the last assertion).
  it("shows who is invited or asking only to leaders", async () => {
    await membership(CAROL_ID, "requested");
    const asMember = await request(API_URL)
      .get(`/plans/${planId}`)
      .set(as(BOB_SUB));
    expect(asMember.status).toBe(200);
    expect(asMember.body.myRole).toBe("member");
    expect(
      asMember.body.members.map((m: { user: { id: string } }) => m.user.id),
    ).toEqual([ALICE_ID, BOB_ID]);
    const asLeader = await request(API_URL)
      .get(`/plans/${planId}`)
      .set(as(ALICE_SUB));
    expect(asLeader.body.members).toContainEqual(
      expect.objectContaining({
        user: { id: CAROL_ID, username: "carol" },
        status: "requested",
      }),
    );
    expect(JSON.stringify(asLeader.body)).not.toMatch(/@/);
  });
});

describe("PATCH /plans/:id", () => {
  const rename = (sub: string, from: string, to: string) =>
    request(API_URL)
      .patch(`/plans/${planId}`)
      .set(as(sub))
      .send({ name: { from, to } });

  it("403s a member; an editor and a leader may", async () => {
    const member = await rename(BOB_SUB, "Test canyon weekend", "Bob's");
    expect(member.status).toBe(403);
    await membership(CAROL_ID, "active", "editor");
    const editor = await rename(CAROL_SUB, "Test canyon weekend", "Carol's");
    expect(editor.status).toBe(200);
    expect(editor.body.name).toBe("Carol's");
  });

  // Mutation: drop the `from` conditions from the updateMany's where.
  it("saves nothing when a field moved since the client read it", async () => {
    expect(
      (await rename(ALICE_SUB, "Test canyon weekend", "First")).status,
    ).toBe(200);
    const stale = await rename(ALICE_SUB, "Test canyon weekend", "Second");
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe(
      "Not saved: someone else changed this. Check their change, then save yours again.",
    );
    expect(stale.body).not.toHaveProperty("name");
    const plan = await prisma.tripPlan.findUniqueOrThrow({
      where: { id: planId },
    });
    expect(plan.name).toBe("First");
  });

  it("compares and sets the dates as a pair, all fields or none", async () => {
    const res = await request(API_URL)
      .patch(`/plans/${planId}`)
      .set(as(ALICE_SUB))
      .send({
        name: { from: "Test canyon weekend", to: "Renamed" },
        dates: {
          from: { startDate: "2026-11-08", endDate: "2026-11-01" },
          to: { startDate: null, endDate: null },
        },
      });
    expect(res.status).toBe(409);
    const plan = await prisma.tripPlan.findUniqueOrThrow({
      where: { id: planId },
    });
    expect(plan.name).toBe("Test canyon weekend");

    const ok = await request(API_URL)
      .patch(`/plans/${planId}`)
      .set(as(ALICE_SUB))
      .send({
        dates: {
          from: { startDate: "2026-11-08", endDate: "2026-11-09" },
          to: { startDate: null, endDate: null },
        },
        tripTypes: { from: ["canyoning"], to: [] },
      });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      startDate: null,
      endDate: null,
      tripTypes: [],
    });
  });
});

describe("archive and delete", () => {
  it("only a leader archives; an archived plan refuses changes until brought back", async () => {
    await membership(CAROL_ID, "active", "editor");
    const editor = await request(API_URL)
      .post(`/plans/${planId}/archive`)
      .set(as(CAROL_SUB))
      .send({ archived: true });
    expect(editor.status).toBe(403);

    const archived = await request(API_URL)
      .post(`/plans/${planId}/archive`)
      .set(as(ALICE_SUB))
      .send({ archived: true });
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({
      id: planId,
      status: "active",
      role: "leader",
    });
    expect(archived.body.archivedAt).not.toBeNull();

    const edit = await request(API_URL)
      .post(`/plans/${planId}/sections`)
      .set(as(CAROL_SUB))
      .send({ title: "Gear" });
    expect(edit.status).toBe(409);
    expect(edit.body.error).toBe(
      "This plan is archived. A leader can bring it back to change it.",
    );
    expect(
      (await request(API_URL).get(`/plans/${planId}`).set(as(BOB_SUB))).status,
    ).toBe(200);

    const back = await request(API_URL)
      .post(`/plans/${planId}/archive`)
      .set(as(ALICE_SUB))
      .send({ archived: false });
    expect(back.body.archivedAt).toBeNull();
  });

  it("only a leader deletes, and the plan is gone for everyone", async () => {
    await membership(CAROL_ID, "active", "editor");
    expect(
      (await request(API_URL).delete(`/plans/${planId}`).set(as(CAROL_SUB)))
        .status,
    ).toBe(403);
    expect(
      (await request(API_URL).delete(`/plans/${planId}`).set(as(ALICE_SUB)))
        .status,
    ).toBe(204);
    expect(
      (await request(API_URL).get(`/plans/${planId}`).set(as(BOB_SUB))).status,
    ).toBe(404);
  });
});

describe("sections", () => {
  const section = (sub: string, body: object) =>
    request(API_URL).post(`/plans/${planId}/sections`).set(as(sub)).send(body);

  it("leaders and editors write them; members can't", async () => {
    expect((await section(BOB_SUB, { title: "Gear" })).status).toBe(403);
    await membership(CAROL_ID, "active", "editor");
    const res = await section(CAROL_SUB, {
      title: " Gear ",
      body: "Helmet\nHarness",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "Gear",
      body: "Helmet\nHarness",
      position: 0,
    });
  });

  it("compare-and-sets title and body", async () => {
    const id = (await section(ALICE_SUB, { title: "Exit" })).body.id;
    const patch = (from: string, to: string) =>
      request(API_URL)
        .patch(`/plans/${planId}/sections/${id}`)
        .set(as(ALICE_SUB))
        .send({ body: { from, to } });
    expect((await patch("", "Up the gully")).status).toBe(200);
    expect((await patch("", "Down the creek")).status).toBe(409);
  });

  it("reorders only the whole current set", async () => {
    const overview = (await section(ALICE_SUB, { title: "Overview" })).body.id;
    const exit = (await section(ALICE_SUB, { title: "Exit" })).body.id;
    const order = (ids: string[]) =>
      request(API_URL)
        .put(`/plans/${planId}/sections/order`)
        .set(as(ALICE_SUB))
        .send({ ids });
    expect((await order([exit])).status).toBe(409);
    const res = await order([exit, overview]);
    expect(res.status).toBe(200);
    expect(res.body.sections.map((s: { id: string }) => s.id)).toEqual([
      exit,
      overview,
    ]);
  });

  // Writes in one plan run one at a time (touchPlan first). Mutation: move
  // touchPlan after the count in POST sections; the racing creates then all
  // read the same count and pass the cap together.
  it("holds the cap against creates that race", async () => {
    const start = await prisma.tripPlanSection.count({ where: { planId } });
    await prisma.tripPlanSection.createMany({
      data: Array.from(
        { length: TRIP_PLAN_MAX_SECTIONS - 2 - start },
        (_, i) => ({
          planId,
          title: `S${i}`,
          position: start + i,
        }),
      ),
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => section(ALICE_SUB, { title: "Race" })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      201, 201, 413, 413, 413,
    ]);
    const positions = (
      await prisma.tripPlanSection.findMany({
        where: { planId },
        select: { position: true },
      })
    ).map((row) => row.position);
    expect(new Set(positions).size).toBe(TRIP_PLAN_MAX_SECTIONS);
  });

  it("404s a section of another plan", async () => {
    const other = await request(API_URL)
      .post("/plans")
      .set(as(BOB_SUB))
      .send({ name: "Bob's own" });
    const foreign = (
      await request(API_URL)
        .post(`/plans/${other.body.id}/sections`)
        .set(as(BOB_SUB))
        .send({ title: "Overview" })
    ).body.id;
    const res = await request(API_URL)
      .delete(`/plans/${planId}/sections/${foreign}`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Couldn't find that.");
    await prisma.tripPlan.delete({ where: { id: other.body.id } });
  });
});

// The poll's watermark moves with every write inside the plan. Mutation:
// drop the touchPlan call from any one section route.
describe("touches the plan", () => {
  it("on every section write", async () => {
    let id = "";
    await touches(async () => {
      const res = await request(API_URL)
        .post(`/plans/${planId}/sections`)
        .set(as(ALICE_SUB))
        .send({ title: "Gear" });
      id = res.body.id;
      return res;
    });
    await touches(() =>
      request(API_URL)
        .patch(`/plans/${planId}/sections/${id}`)
        .set(as(ALICE_SUB))
        .send({ title: { from: "Gear", to: "Gear list" } }),
    );
    const view = await request(API_URL)
      .get(`/plans/${planId}`)
      .set(as(ALICE_SUB));
    await touches(() =>
      request(API_URL)
        .put(`/plans/${planId}/sections/order`)
        .set(as(ALICE_SUB))
        .send({
          ids: view.body.sections.map((s: { id: string }) => s.id).reverse(),
        }),
    );
    await touches(() =>
      request(API_URL)
        .delete(`/plans/${planId}/sections/${id}`)
        .set(as(ALICE_SUB)),
    );
  });
});
