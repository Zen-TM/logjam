import { describe, expect, it } from "vitest";
import { tripPlanPerson } from "./planPerson.js";

const user = (id: string) => ({ id, username: id });
const member = (id: string, status: string, role = "member", extra = {}) =>
  ({ user: user(id), status, role, ...extra }) as never;
const form = (title: string, answered: string[], mine = false) =>
  ({
    id: title,
    title,
    myAnswer: mine ? {} : null,
    answers: answered.map((id) => ({ user: user(id) })),
  }) as never;
const plan = (over: object = {}) =>
  ({
    myRole: "leader",
    archivedAt: null,
    startDate: "2026-11-07",
    endDate: "2026-11-08",
    members: [
      member("me", "active", "leader"),
      member("bob", "active"),
      member("ask", "requested"),
      member("inv", "invited", "member", { invitedBy: user("me") }),
    ],
    forms: [form("Gear", ["bob"], true), form("Cars", [], true)],
    ...over,
  }) as never;
const TODAY = "2026-11-01";
const ids = (p: ReturnType<typeof tripPlanPerson>) =>
  p.actions.map((a) => a.id);

describe("tripPlanPerson", () => {
  // Mutation: drop the leader check and a member is shown who hasn't answered.
  it("lists unanswered forms to a leader only", () => {
    const m = member("bob", "active");
    expect(tripPlanPerson(plan(), m, "me", TODAY).unanswered).toEqual(["Cars"]);
    expect(
      tripPlanPerson(plan({ myRole: "member" }), m, "me", TODAY).unanswered,
    ).toBeNull();
  });

  // Mutation: ignore archived/over and a finished trip nags.
  it("lists nothing once the plan is archived or over", () => {
    const m = member("bob", "active");
    expect(
      tripPlanPerson(plan({ archivedAt: "x" }), m, "me", TODAY).unanswered,
    ).toEqual([]);
    expect(tripPlanPerson(plan(), m, "me", "2026-12-01").unanswered).toEqual(
      [],
    );
  });

  // Mutation: offer Let in on an archived plan, or role verbs on a request.
  it("offers a request Let in and Turn down, an invite Cancel invite", () => {
    const p = plan();
    expect(
      ids(tripPlanPerson(p, member("ask", "requested"), "me", TODAY)),
    ).toEqual(["letIn", "turnDown"]);
    expect(
      ids(tripPlanPerson(p, member("inv", "invited"), "me", TODAY)),
    ).toEqual(["cancelInvite"]);
    const archived = plan({ archivedAt: "x" });
    expect(
      ids(tripPlanPerson(archived, member("ask", "requested"), "me", TODAY)),
    ).toEqual(["turnDown"]);
    expect(
      tripPlanPerson(archived, member("inv", "invited"), "me", TODAY).actions,
    ).toEqual([]);
  });

  // Mutation: give a non-leader the leader's verbs.
  it("offers a member the person's name, role and status, no verbs", () => {
    const p = tripPlanPerson(
      plan({ myRole: "member" }),
      member("cat", "active", "editor"),
      "me",
      TODAY,
    );
    expect(p).toMatchObject({ role: "Editor", status: "Going", actions: [] });
  });

  it("gives a going member the role verbs and Remove", () => {
    expect(
      ids(tripPlanPerson(plan(), member("bob", "active"), "me", TODAY)),
    ).toEqual(["makeLeader", "makeEditor", "remove"]);
  });

  it("names who invited", () => {
    expect(
      tripPlanPerson(
        plan(),
        member("inv", "invited", "member", { invitedBy: user("me") }),
        "me",
        TODAY,
      ).invitedBy,
    ).toBe("Invited by me");
  });
});
