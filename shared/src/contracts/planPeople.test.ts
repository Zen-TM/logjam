import { describe, expect, it } from "vitest";
import { planMemberVerbRole, planMemberVerbs } from "./index.js";

const me = "u-me";
const person = (
  role: "leader" | "editor" | "member",
  status: "active" | "invited" | "requested" = "active",
  id = "u-tom",
) => ({ user: { id, username: "tom" }, role, status });

describe("a person's ⋯ in People", () => {
  // Mutation: drop the role check, and an editor's phone offers verbs the
  // API refuses.
  it("is a leader's alone, and never on their own row", () => {
    expect(planMemberVerbs("editor", me, person("member"))).toEqual([]);
    expect(
      planMemberVerbs("leader", me, person("leader", "active", me)),
    ).toEqual([]);
  });

  it("offers the two other roles and Remove for someone going", () => {
    const ids = planMemberVerbs("leader", me, person("editor")).map(
      (verb) => verb.id,
    );
    expect(ids).toEqual(["makeLeader", "makeMember", "remove"]);
    expect(ids.map(planMemberVerbRole)).toEqual(["leader", "member", null]);
  });

  it("cancels an invite, and leaves a request to Let in and Turn down", () => {
    expect(
      planMemberVerbs("leader", me, person("member", "invited")).map(
        (verb) => verb.id,
      ),
    ).toEqual(["cancelInvite"]);
    expect(
      planMemberVerbs("leader", me, person("member", "requested")),
    ).toEqual([]);
  });
});
