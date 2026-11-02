import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  TRIP_PLAN_FORM_PRESETS,
  TRIP_PLAN_MAX_FORMS,
  TRIP_PLAN_VISIBILITY_LOCKED_SENTENCE,
} from "@logjam/shared";
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

// Plans: forms and answers, and who sees an answer. alice leads a plan of
// her own; bob and carol are active members (written straight to the
// table). Answers are made up; a safety contact here is no one.
//
// Requires `make dev`.

let planId: string;

const contacts = TRIP_PLAN_FORM_PRESETS.safetyContacts;
const experience = TRIP_PLAN_FORM_PRESETS.experience;
const BOB_EXPERIENCE = {
  trips: "few",
  abseil: true,
  swim: false,
  notes: "Bad knee, take it slow",
};

async function makeForm(form: object): Promise<string> {
  const res = await request(API_URL)
    .post(`/plans/${planId}/forms`)
    .set(as(ALICE_SUB))
    .send(form);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

/** The form's updatedAt as the full fetch serves it. */
async function shownAt(formId: string): Promise<string> {
  const form = await prisma.tripPlanForm.findUnique({ where: { id: formId } });
  return form?.updatedAt.toISOString() ?? "1970-01-01T00:00:00.000Z";
}

/** An answer from someone shown the form as it is now, or at `formUpdatedAt`. */
const answer = async (
  sub: string,
  formId: string,
  answers: object,
  visibleTo: string,
  formUpdatedAt?: string,
) =>
  request(API_URL)
    .put(`/plans/${planId}/forms/${formId}/answers/me`)
    .set(as(sub))
    .send({
      answers,
      visibleTo,
      formUpdatedAt: formUpdatedAt ?? (await shownAt(formId)),
    });

const view = (sub: string) =>
  request(API_URL).get(`/plans/${planId}`).set(as(sub));

beforeEach(async () => {
  const res = await request(API_URL)
    .post("/plans")
    .set(as(ALICE_SUB))
    .send({ name: "Forms test plan" });
  expect(res.status).toBe(201);
  planId = res.body.id;
  await prisma.tripPlanMember.createMany({
    data: [BOB_ID, CAROL_ID].map((userId) => ({
      planId,
      userId,
      role: "member",
      status: "active",
      invitedById: ALICE_ID,
    })),
  });
});

afterEach(async () => {
  await prisma.tripPlan.deleteMany({ where: { id: planId } });
});

describe("building forms", () => {
  // Writes in one plan run one at a time (touchPlan first). Mutation: move
  // touchPlan after the count in POST forms; the racing creates then all
  // read the same count and pass the cap together.
  it("holds the cap against creates that race", async () => {
    await prisma.tripPlanForm.createMany({
      data: Array.from({ length: TRIP_PLAN_MAX_FORMS - 2 }, (_, i) => ({
        planId,
        title: `F${i}`,
        questions: experience.questions,
        visibleTo: "leaders",
        position: i,
      })),
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(API_URL)
          .post(`/plans/${planId}/forms`)
          .set(as(ALICE_SUB))
          .send(experience),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      201, 201, 413, 413, 413,
    ]);
    const positions = (
      await prisma.tripPlanForm.findMany({
        where: { planId },
        select: { position: true },
      })
    ).map((row) => row.position);
    expect(new Set(positions).size).toBe(TRIP_PLAN_MAX_FORMS);
  });

  it("a leader makes one from a preset; anyone else can't", async () => {
    const id = await makeForm(contacts);
    const res = await view(BOB_SUB);
    expect(res.body.forms).toMatchObject([
      { id, preset: "safetyContacts", visibleTo: "members" },
    ]);
    const member = await request(API_URL)
      .post(`/plans/${planId}/forms`)
      .set(as(BOB_SUB))
      .send(contacts);
    expect(member.status).toBe(403);
    expect(member.body.error).toBe("Only a leader can change forms.");
  });

  it("compare-and-sets its fields", async () => {
    const id = await makeForm(experience);
    const patch = (from: string, to: string) =>
      request(API_URL)
        .patch(`/plans/${planId}/forms/${id}`)
        .set(as(ALICE_SUB))
        .send({ title: { from, to } });
    expect((await patch("Experience", "Your experience")).status).toBe(200);
    expect((await patch("Experience", "Background")).status).toBe(409);
  });

  // The one compare-and-set on a JSON column. Mutation: drop the questions
  // arm from the PATCH's where.
  it("compare-and-sets the questions as a whole", async () => {
    const id = await makeForm(experience);
    const served = (await view(ALICE_SUB)).body.forms[0].questions;
    const edit = (to: unknown[]) =>
      request(API_URL)
        .patch(`/plans/${planId}/forms/${id}`)
        .set(as(ALICE_SUB))
        .send({ questions: { from: served, to } });
    expect((await edit(served.slice(0, 3))).status).toBe(200);
    expect((await edit(served.slice(0, 2))).status).toBe(409);
  });

  // A form id is reached only through its own plan. Mutation: drop
  // `plan_id` from either query in lockForm.
  it("404s a form of another plan", async () => {
    const other = await request(API_URL)
      .post("/plans")
      .set(as(BOB_SUB))
      .send({ name: "Bob's own" });
    const foreign = (
      await request(API_URL)
        .post(`/plans/${other.body.id}/forms`)
        .set(as(BOB_SUB))
        .send(experience)
    ).body.id;
    const patch = await request(API_URL)
      .patch(`/plans/${planId}/forms/${foreign}`)
      .set(as(ALICE_SUB))
      .send({ title: { from: "Experience", to: "Mine now" } });
    expect(patch.status).toBe(404);
    expect(patch.body.error).toBe("Couldn't find that.");
    const put = await answer(ALICE_SUB, foreign, BOB_EXPERIENCE, "leaders");
    expect(put.status).toBe(404);
    expect(
      await prisma.tripPlanAnswer.count({ where: { formId: foreign } }),
    ).toBe(0);
    await prisma.tripPlan.delete({ where: { id: other.body.id } });
  });
});

describe("answers", () => {
  it("are validated against the form's questions", async () => {
    const id = await makeForm(contacts);
    const missing = await answer(
      BOB_SUB,
      id,
      { name: "Sam Example" },
      "members",
    );
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("Answer every question marked required.");
    const ok = await answer(
      BOB_SUB,
      id,
      { name: " Sam Example ", phone: "0400 000 000" },
      "members",
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      user: { id: BOB_ID, username: "bob" },
      answers: { name: "Sam Example", phone: "0400 000 000" },
    });
  });

  // Shown the form as it is (formUpdatedAt matches), an answer that doesn't
  // fit it is a broken client's. Mutation: drop the PUT's 409 → malformed.
  it("refuses as malformed an answer that doesn't fit the form it was shown", async () => {
    const id = await makeForm(experience);
    const res = await answer(
      BOB_SUB,
      id,
      { ...BOB_EXPERIENCE, trips: "dozens" },
      "leaders",
    );
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe("an answer doesn't fit the form it was shown");
  });

  it("can be taken back", async () => {
    const id = await makeForm(contacts);
    await answer(BOB_SUB, id, { name: "Sam", phone: "0400" }, "members");
    expect(
      (
        await request(API_URL)
          .delete(`/plans/${planId}/forms/${id}/answers/me`)
          .set(as(BOB_SUB))
      ).status,
    ).toBe(204);
  });

  // Mutation: let a non-leader through formView's visibleTo check, e.g.
  // `viewer.role !== "member"` for the leader test (editors then see it).
  it("leaders-only answers reach the leaders and their author, no one else", async () => {
    const id = await makeForm(experience);
    expect((await answer(BOB_SUB, id, BOB_EXPERIENCE, "leaders")).status).toBe(
      200,
    );

    const carol = await view(CAROL_SUB);
    expect(carol.body.forms[0]).toMatchObject({ myAnswer: null, answers: [] });
    expect(JSON.stringify(carol.body)).not.toContain("Bad knee");

    const bob = await view(BOB_SUB);
    expect(bob.body.forms[0].myAnswer.answers).toEqual(BOB_EXPERIENCE);

    const alice = await view(ALICE_SUB);
    expect(alice.body.forms[0].answers).toMatchObject([
      { user: { id: BOB_ID }, answers: BOB_EXPERIENCE },
    ]);

    await prisma.tripPlanMember.update({
      where: { planId_userId: { planId, userId: CAROL_ID } },
      data: { role: "editor" },
    });
    const editor = await view(CAROL_SUB);
    expect(editor.body.myRole).toBe("editor");
    expect(editor.body.forms[0]).toMatchObject({ myAnswer: null, answers: [] });
    expect(JSON.stringify(editor.body)).not.toContain("Bad knee");
  });

  // Answers outlive a membership row until the leave route deletes them.
  // Mutation: `return true` in formView's leader branch.
  it("an answer whose author is no longer in the plan reaches no one", async () => {
    const id = await makeForm(experience);
    await answer(BOB_SUB, id, BOB_EXPERIENCE, "leaders");
    await prisma.tripPlanMember.delete({
      where: { planId_userId: { planId, userId: BOB_ID } },
    });
    const alice = await view(ALICE_SUB);
    expect(alice.body.forms[0].answers).toEqual([]);
    expect(JSON.stringify(alice.body)).not.toContain("Bad knee");
  });

  // An up-to-date client answering a form a leader edited after serving it:
  // a question removed, or one made required that the person never saw.
  // Mutation: drop the formUpdatedAt check in the answer PUT (the second
  // case then gets the "required" 400 instead).
  it("asks the person to check a form that changed while they answered", async () => {
    const changed =
      "This form changed since you opened it. Check it, then answer again.";
    const id = await makeForm(experience);
    const served = (await view(BOB_SUB)).body.forms[0];
    await request(API_URL)
      .patch(`/plans/${planId}/forms/${id}`)
      .set(as(ALICE_SUB))
      .send({
        questions: {
          from: served.questions,
          to: served.questions.map((q: { id: string }) =>
            q.id === "notes" ? { ...q, required: true } : q,
          ),
        },
      });
    const withoutNotes = { trips: "few", abseil: true, swim: false };
    const res = await answer(
      BOB_SUB,
      id,
      withoutNotes,
      "leaders",
      served.updatedAt,
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(changed);
    expect(await prisma.tripPlanAnswer.count({ where: { formId: id } })).toBe(
      0,
    );
  });

  // Mutation: drop the `author === "active"` condition in formView.
  it("an answer for everyone stays hidden from members while its author only asks to join", async () => {
    const id = await makeForm(contacts);
    await answer(
      BOB_SUB,
      id,
      { name: "Sam", phone: "0400 111 222" },
      "members",
    );
    expect(JSON.stringify((await view(CAROL_SUB)).body)).toContain(
      "0400 111 222",
    );

    await prisma.tripPlanMember.update({
      where: { planId_userId: { planId, userId: BOB_ID } },
      data: { status: "requested" },
    });
    expect(JSON.stringify((await view(CAROL_SUB)).body)).not.toContain(
      "0400 111 222",
    );
    expect(JSON.stringify((await view(ALICE_SUB)).body)).toContain(
      "0400 111 222",
    );
  });
});

// Who sees an answer never widens after it was given. Mutation: drop the
// answeredByOthers check in the form PATCH, or the visibleTo check in the
// answer PUT.
describe("never widening who sees an answer", () => {
  it("a form answered for leaders only can't be opened to everyone", async () => {
    const id = await makeForm(experience);
    await answer(BOB_SUB, id, BOB_EXPERIENCE, "leaders");
    const widen = await request(API_URL)
      .patch(`/plans/${planId}/forms/${id}`)
      .set(as(ALICE_SUB))
      .send({ visibleTo: { from: "leaders", to: "members" } });
    expect(widen.status).toBe(409);
    // The sentence Logjam Web's builder shows before Save.
    expect(widen.body.error).toBe(TRIP_PLAN_VISIBILITY_LOCKED_SENTENCE);
    expect(JSON.stringify((await view(CAROL_SUB)).body)).not.toContain(
      "Bad knee",
    );
  });

  it("an unanswered form can be opened, and narrowed back any time", async () => {
    const id = await makeForm(experience);
    const widen = await request(API_URL)
      .patch(`/plans/${planId}/forms/${id}`)
      .set(as(ALICE_SUB))
      .send({ visibleTo: { from: "leaders", to: "members" } });
    expect(widen.status).toBe(200);
    await answer(BOB_SUB, id, BOB_EXPERIENCE, "members");
    const narrow = await request(API_URL)
      .patch(`/plans/${planId}/forms/${id}`)
      .set(as(ALICE_SUB))
      .send({ visibleTo: { from: "members", to: "leaders" } });
    expect(narrow.status).toBe(200);
    expect(JSON.stringify((await view(CAROL_SUB)).body)).not.toContain(
      "Bad knee",
    );
  });

  it("an answer given against a narrower form than it now is is refused", async () => {
    const id = await makeForm(experience);
    await request(API_URL)
      .patch(`/plans/${planId}/forms/${id}`)
      .set(as(ALICE_SUB))
      .send({ visibleTo: { from: "leaders", to: "members" } });
    // The form changed too; the visibility sentence wins.
    const stale = await answer(
      BOB_SUB,
      id,
      BOB_EXPERIENCE,
      "leaders",
      "2000-01-01T00:00:00.000Z",
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe(
      "Who sees the answers to this form has changed. Check it, then answer again.",
    );
    expect(
      await prisma.tripPlanAnswer.count({
        where: { formId: id, userId: BOB_ID },
      }),
    ).toBe(0);
  });
});

// The poll's watermark moves with every form and answer write. Mutation:
// drop the touchPlan call from any one route in planForms.ts.
describe("touches the plan", () => {
  async function touches(write: () => Promise<{ status: number }>) {
    const before = (
      await prisma.tripPlan.findUniqueOrThrow({ where: { id: planId } })
    ).updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const res = await write();
    expect(res.status).toBeLessThan(300);
    const after = (
      await prisma.tripPlan.findUniqueOrThrow({ where: { id: planId } })
    ).updatedAt;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  }

  it("on every form and answer write", async () => {
    let id = "";
    await touches(async () => {
      const res = await request(API_URL)
        .post(`/plans/${planId}/forms`)
        .set(as(ALICE_SUB))
        .send(experience);
      id = res.body.id;
      return res;
    });
    await touches(() =>
      request(API_URL)
        .patch(`/plans/${planId}/forms/${id}`)
        .set(as(ALICE_SUB))
        .send({ title: { from: experience.title, to: "Renamed" } }),
    );
    await touches(() =>
      request(API_URL)
        .put(`/plans/${planId}/forms/order`)
        .set(as(ALICE_SUB))
        .send({ ids: [id] }),
    );
    await touches(() => answer(BOB_SUB, id, BOB_EXPERIENCE, "leaders"));
    await touches(() =>
      request(API_URL)
        .delete(`/plans/${planId}/forms/${id}/answers/me`)
        .set(as(BOB_SUB)),
    );
    await touches(() =>
      request(API_URL)
        .delete(`/plans/${planId}/forms/${id}`)
        .set(as(ALICE_SUB)),
    );
  });
});

// Mutation: drop the `role: "leader"` or `status: "active"` filter in GET
// /plans/leader-forms, and a member (or someone only invited) reads the
// forms of a plan they don't lead.
describe("copy from my plans", () => {
  let otherPlanId: string;
  beforeEach(async () => {
    await makeForm(experience);
    const res = await request(API_URL)
      .post("/plans")
      .set(as(BOB_SUB))
      .send({ name: "Bob's plan" });
    otherPlanId = res.body.id;
    await request(API_URL)
      .post(`/plans/${otherPlanId}/forms`)
      .set(as(BOB_SUB))
      .send(contacts);
  });
  afterEach(async () => {
    await prisma.tripPlan.deleteMany({ where: { id: otherPlanId } });
  });

  const list = (sub: string, except?: string) =>
    request(API_URL)
      .get(`/plans/leader-forms${except ? `?except=${except}` : ""}`)
      .set(as(sub));

  it("lists the forms of the plans the caller leads, enough to copy", async () => {
    const res = await list(BOB_SUB);
    expect(res.status).toBe(200);
    expect(res.body.forms).toMatchObject([
      {
        planId: otherPlanId,
        planName: "Bob's plan",
        title: contacts.title,
        preset: "safetyContacts",
        visibleTo: "members",
        questions: contacts.questions,
      },
    ]);
    expect(res.body.forms[0].formId).toEqual(expect.any(String));
    expect((await list(BOB_SUB, otherPlanId)).body.forms).toEqual([]);
  });

  it("never lists a plan's forms to a member who doesn't lead it", async () => {
    // bob is a plain member of alice's plan, which has a form.
    const forms = (await list(BOB_SUB)).body.forms;
    expect(forms.map((f: { planId: string }) => f.planId)).not.toContain(
      planId,
    );
    expect((await list(CAROL_SUB)).body.forms).toEqual([]);
    await prisma.tripPlanMember.update({
      where: { planId_userId: { planId, userId: BOB_ID } },
      data: { role: "editor" },
    });
    expect(
      (await list(BOB_SUB)).body.forms.map((f: { planId: string }) => f.planId),
    ).not.toContain(planId);
    await prisma.tripPlanMember.update({
      where: { planId_userId: { planId, userId: BOB_ID } },
      data: { role: "leader", status: "invited" },
    });
    expect(
      (await list(BOB_SUB)).body.forms.map((f: { planId: string }) => f.planId),
    ).not.toContain(planId);
  });
});
