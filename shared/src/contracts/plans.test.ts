import { describe, expect, it } from "vitest";
import type { TripPlanSummary } from "../tripPlans.js";
import {
  planCountsLabel,
  planDeleteConfirm,
  planFormDeleteConfirm,
  planVerbs,
  planVerbsFor,
  PLAN_ADD_VERBS,
  PLAN_FORM_VERBS,
  PLAN_SECTION_VERBS,
  PLAN_VERB_LISTS,
  sortTripPlans,
  tripPlanAddedByLine,
  tripPlanBucket,
  tripPlanCounts,
  tripPlanDatesLabel,
  tripPlanDatesLine,
  tripPlanGoing,
  tripPlanInPlanNow,
  tripPlanIsOver,
  tripPlanLeaveState,
  tripPlanNotice,
  tripPlanRoleWord,
  tripPlanRowPill,
  tripPlanRowSubtitle,
  tripPlansBadgeCount,
  tripPlansEmpty,
  tripPlansHeroTitle,
  tripPlanTripLogPrefill,
} from "./index.js";

const TODAY = "2026-10-19";

function summary(over: Partial<TripPlanSummary>): TripPlanSummary {
  return {
    id: "p",
    name: "Wollangambe trip",
    startDate: null,
    endDate: null,
    tripTypes: [],
    archivedAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    status: "active",
    role: "member",
    ...over,
  };
}

describe("the plans list", () => {
  // Mutation: make the last day `startDate ?? endDate`, and a trip running
  // today moves to Past and is called over.
  it("keeps a plan upcoming through its last day, and one with no dates", () => {
    const running = summary({ startDate: "2026-10-18", endDate: "2026-10-20" });
    expect(tripPlanBucket(running, TODAY)).toBe("upcoming");
    expect(tripPlanIsOver(running, TODAY)).toBe(false);
    expect(tripPlanBucket(summary({ endDate: TODAY }), TODAY)).toBe("upcoming");
    // Mutation: `last <= today`, and on the trip's last day it is called
    // over and Start a trip log enables.
    expect(tripPlanIsOver(summary({ endDate: TODAY }), TODAY)).toBe(false);
    expect(tripPlanBucket(summary({}), TODAY)).toBe("upcoming");
    expect(tripPlanBucket(summary({ endDate: "2026-10-18" }), TODAY)).toBe(
      "past",
    );
    // No end: the start is the last day.
    const startOnly = summary({ startDate: "2026-10-18" });
    expect(tripPlanBucket(startOnly, TODAY)).toBe("past");
    expect(tripPlanIsOver(startOnly, TODAY)).toBe(true);
    expect(tripPlanIsOver(summary({}), TODAY)).toBe(false);
    expect(
      tripPlanBucket(
        summary({ endDate: "2027-01-01", archivedAt: "2026-10-01" }),
        TODAY,
      ),
    ).toBe("archived");
  });

  it("puts the soonest trip first while coming, the newest first once over, undated last", () => {
    const a = summary({ id: "a", startDate: "2026-11-08" });
    const b = summary({ id: "b", startDate: "2026-10-25" });
    const c = summary({ id: "c" });
    // Only an end date: it sorts by that day, not with the undated.
    const d = summary({ id: "d", endDate: "2026-11-01" });
    expect(sortTripPlans([c, a, d, b], "upcoming").map((p) => p.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
    expect(sortTripPlans([b, c, a], "past").map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("says the dates as a range, with the year only when it is another", () => {
    expect(tripPlanDatesLabel("2026-11-07", "2026-11-08", 2026)).toBe(
      "Sat 7 – Sun 8 Nov",
    );
    expect(tripPlanDatesLabel("2026-10-31", "2026-11-02", 2026)).toBe(
      "Sat 31 Oct – Mon 2 Nov",
    );
    expect(tripPlanDatesLabel("2026-12-31", "2027-01-01", 2026)).toBe(
      "Thu 31 Dec – Fri 1 Jan 2027",
    );
    expect(tripPlanDatesLabel("2025-11-08", null, 2026)).toBe("Sat 8 Nov 2025");
    expect(tripPlanDatesLabel(null, null)).toBe("No dates yet");
  });

  it("marks an invite and a request over a role, and a member not at all", () => {
    expect(
      tripPlanRowPill(summary({ status: "invited", role: "leader" })),
    ).toBe("Invited");
    expect(tripPlanRowPill(summary({ status: "requested" }))).toBe("Waiting");
    expect(tripPlanRowPill(summary({ role: "editor" }))).toBe("Editor");
    expect(tripPlanRowPill(summary({}))).toBeNull();
  });

  it("says who a request waits on in place of the dates", () => {
    expect(
      tripPlanRowSubtitle(
        summary({
          status: "requested",
          waitingFor: { id: "u", username: "mira" },
        }),
      ),
    ).toBe("Waiting for mira to let you in");
  });

  it("badges the invites the caller has not answered", () => {
    expect(
      tripPlansBadgeCount([
        summary({ status: "invited" }),
        summary({ status: "requested" }),
        summary({}),
      ]),
    ).toBe(1);
  });

  it("tells no plans at all from an empty bucket", () => {
    expect(tripPlansEmpty(0, "past").title).toBe("No plans yet");
    expect(tripPlansEmpty(2, "past").title).toBe("No past plans");
    expect(tripPlansEmpty(2, "archived").title).toBe("Nothing archived");
  });
});

describe("Logjam GPS's plans hero", () => {
  const hero = (plans: TripPlanSummary[]) =>
    tripPlansHeroTitle(plans, TODAY, 2026);

  it("leads with a trip under way", () => {
    expect(
      hero([
        summary({ name: "Soon", startDate: "2026-10-25" }),
        summary({
          name: "Now",
          startDate: "2026-10-18",
          endDate: "2026-10-20",
        }),
      ]),
    ).toBe("On now: Now");
  });

  it("else the next trip the caller is in, by its first day", () => {
    expect(
      hero([
        summary({ name: "Later", startDate: "2026-12-01" }),
        summary({ name: "Soon", startDate: "2026-11-08" }),
        summary({
          name: "Asked",
          startDate: "2026-10-20",
          status: "requested",
        }),
      ]),
    ).toBe("Next: Soon, Sun 8 Nov");
    expect(hero([summary({ name: "Ends", endDate: "2026-10-25" })])).toBe(
      "Next: Ends, until Sun 25 Oct",
    );
  });

  it("leaves undated plans out, and says when nothing is planned or there are no plans", () => {
    expect(hero([summary({ name: "Someday" })])).toBe("Nothing planned");
    expect(hero([summary({ startDate: "2026-01-01" })])).toBe(
      "Nothing planned",
    );
    expect(hero([])).toBe("No plans yet");
  });
});

describe("a plan's page", () => {
  it("shows one notice, archived first, then a form owed, then the trip being over", () => {
    const form = { id: "f", title: "Safety contacts" };
    expect(
      tripPlanNotice({ archived: true, unansweredRequired: form, over: true })
        ?.kind,
    ).toBe("archived");
    expect(
      tripPlanNotice({ archived: false, unansweredRequired: form, over: true }),
    ).toEqual({
      kind: "answer",
      icon: "form",
      text: 'Answer "Safety contacts".',
      formId: "f",
    });
    expect(
      tripPlanNotice({ archived: false, unansweredRequired: null, over: true }),
    ).toEqual({ kind: "over", icon: "trip", text: "This trip is over." });
    expect(
      tripPlanNotice({
        archived: false,
        unansweredRequired: null,
        over: false,
      }),
    ).toBeNull();
  });

  it("names a leader's and an editor's role on the dates line, and a member's not", () => {
    const plan = {
      startDate: "2026-11-07",
      endDate: "2026-11-08",
      tripTypes: ["canyoning"],
    };
    const label = (type: string) => type;
    expect(tripPlanDatesLine(plan, "leader", label, 2026)).toBe(
      "Sat 7 – Sun 8 Nov · canyoning · You're a leader",
    );
    expect(tripPlanDatesLine(plan, "member", label, 2026)).toBe(
      "Sat 7 – Sun 8 Nov · canyoning",
    );
  });

  it("lists who's going, leaders first, and never who is invited or asking", () => {
    const member = (
      username: string,
      role: "leader" | "editor" | "member",
      status: "active" | "invited" | "requested" = "active",
    ) => ({ username, role, status });
    // Mutation: filter out only `requested`, and the invited leader is
    // listed as going.
    expect(
      tripPlanGoing([
        member("tom", "member"),
        member("sue", "editor"),
        member("ann", "member", "requested"),
        member("lee", "leader", "invited"),
        member("mira", "leader"),
        member("bo", "member"),
      ]).map((m) => m.username),
    ).toEqual(["mira", "sue", "tom", "bo"]);
  });

  it("names every role in one word, and a member's row says nothing", () => {
    expect(
      ["leader", "editor", "member"].map((role) =>
        tripPlanRoleWord(role as "leader"),
      ),
    ).toEqual(["Leader", "Editor", "Member"]);
    expect(tripPlanRowPill({ status: "active", role: "member" })).toBeNull();
    expect(tripPlanRowPill({ status: "active", role: "editor" })).toBe(
      "Editor",
    );
  });

  it("says what the plan holds now under a changed field, and an empty one as nothing", () => {
    expect(tripPlanInPlanNow("Sat 7 Nov")).toBe("In the plan now: Sat 7 Nov");
    expect(tripPlanInPlanNow("")).toBe("In the plan now: nothing");
  });

  it("says who added an item, and nothing once their account is gone", () => {
    expect(tripPlanAddedByLine({ username: "tom" })).toBe("Added by tom");
    expect(tripPlanAddedByLine(null)).toBeUndefined();
  });
});

describe("a plan's verbs", () => {
  const state = {
    archived: false,
    dated: true,
    over: false,
    alone: false,
    soleLeader: false,
  };
  const ids = (verbs: { id: string }[]) => verbs.map((verb) => verb.id);

  it("gives a member no verb the API refuses them", () => {
    expect(ids(planVerbs("web", "member", state))).toEqual([
      "print",
      "tripLog",
      "leave",
    ]);
  });

  // Mutation: drop the tripLog map in planVerbs, and the verb runs before
  // the trip has happened.
  it("offers Start a trip log before the trip, disabled with the reason", () => {
    const before = planVerbs("web", "member", state).find(
      (verb) => verb.id === "tripLog",
    );
    expect(before?.disabledReason).toBe("After the trip");
    const after = planVerbs("web", "member", { ...state, over: true }).find(
      (verb) => verb.id === "tripLog",
    );
    expect(after?.disabledReason).toBeUndefined();
  });

  // Mutation: drop the `dated` check, and an undated plan waits "After the
  // trip" for a trip nobody can date (members cannot edit dates).
  it("leaves Start a trip log out while the plan has no dates", () => {
    expect(
      ids(planVerbs("web", "member", { ...state, dated: false })),
    ).not.toContain("tripLog");
  });

  it("leaves Leave out for the only person and the only leader, whom the API refuses", () => {
    expect(
      ids(planVerbs("web", "leader", { ...state, alone: true })),
    ).not.toContain("leave");
    expect(
      ids(planVerbs("web", "leader", { ...state, soleLeader: true })),
    ).not.toContain("leave");
    expect(
      tripPlanLeaveState({
        myRole: "leader",
        members: [
          { role: "leader", status: "active" },
          { role: "member", status: "active" },
          { role: "leader", status: "invited" },
        ],
      }),
    ).toEqual({ alone: false, soleLeader: true });
    expect(
      tripPlanLeaveState({
        myRole: "member",
        members: [{ role: "member", status: "active" }],
      }),
    ).toEqual({ alone: true, soleLeader: false });
    // Mutation: count every member row, not the active ones, and someone
    // alone with an invite out is offered a Leave the API refuses.
    expect(
      tripPlanLeaveState({
        myRole: "member",
        members: [
          { role: "member", status: "active" },
          { role: "leader", status: "invited" },
        ],
      }),
    ).toEqual({ alone: true, soleLeader: false });
  });

  it("offers Archive or Bring back by the plan's state, and only what the API serves on an archived plan", () => {
    expect(ids(planVerbs("web", "leader", { ...state, over: true }))).toEqual([
      "edit",
      "print",
      "tripLog",
      "archive",
      "leave",
      "delete",
    ]);
    expect(
      ids(planVerbs("web", "leader", { ...state, archived: true, over: true })),
    ).toEqual(["print", "tripLog", "unarchive", "leave", "delete"]);
  });

  // Mutation: drop the `whenArchived` filter in planVerbsFor, and a client
  // offers writes the API refuses with 409 on an archived plan.
  it("offers no add, section or form verb on an archived plan", () => {
    for (const list of [PLAN_ADD_VERBS, PLAN_SECTION_VERBS, PLAN_FORM_VERBS])
      expect(planVerbsFor(list, "web", "leader", { archived: true })).toEqual(
        [],
      );
  });

  it("builds forms and prints on Logjam Web only", () => {
    const live = { archived: false };
    expect(ids(planVerbsFor(PLAN_ADD_VERBS, "gps", "leader", live))).toEqual([
      "section",
      "copy",
      "invite",
    ]);
    expect(ids(planVerbsFor(PLAN_FORM_VERBS, "gps", "leader", live))).toEqual([
      "delete",
    ]);
    expect(ids(planVerbs("gps", "member", state))).toEqual([
      "tripLog",
      "leave",
    ]);
  });

  // Mutation: drop `reason` from `form` or `print`.
  it("gives a reason for each verb only one client has, and for no other", () => {
    for (const list of PLAN_VERB_LISTS)
      for (const verb of list)
        expect("on" in verb, verb.id).toBe("reason" in verb);
  });

  it("counts what a delete takes, leaving zeros out", () => {
    expect(planCountsLabel({ places: 2, ways: 0, maps: 1 }, "340 MB")).toBe(
      "2 places, 1 map, 340 MB",
    );
    expect(
      planDeleteConfirm("Wollangambe trip", { places: 0, ways: 0, maps: 0 })
        .confirmBody,
    ).toBe(
      "Its write-up, forms and everyone's answers go, for everyone. Copies people saved to their own accounts stay.",
    );
  });

  // Mutation: count `answers` alone, and a form only its leader answered
  // goes with "Its questions go", its answer unmentioned.
  it("counts the caller's own answer among those a form delete takes", () => {
    const form = { title: "Carpooling", answers: [], myAnswer: { seats: 2 } };
    expect(planFormDeleteConfirm(form).confirmBody).toBe(
      "Its questions and 1 answer go, for everyone in the plan.",
    );
    expect(
      planFormDeleteConfirm({ ...form, answers: [{}, {}] }).confirmBody,
    ).toBe("Its questions and 3 answers go, for everyone in the plan.");
    expect(planFormDeleteConfirm({ ...form, myAnswer: null }).confirmBody).toBe(
      "Its questions go, for everyone in the plan.",
    );
  });
});

describe("a trip log from a plan", () => {
  it("fills the trip form with the first day, the name, the types and the written sections", () => {
    expect(
      tripPlanTripLogPrefill({
        name: "Wollangambe trip",
        startDate: "2026-11-07",
        endDate: "2026-11-08",
        tripTypes: ["canyoning"],
        sections: [
          { title: "Overview", body: "" },
          { title: "Access", body: "Two days." },
          { title: "Gear", body: "" },
        ],
      }),
    ).toEqual({
      date: "2026-11-07",
      displayName: "Wollangambe trip",
      types: ["canyoning"],
      notes: "Access\n\nTwo days.",
    });
  });

  it("dates a plan with only an end on that day", () => {
    expect(
      tripPlanTripLogPrefill({
        name: "Ends",
        startDate: null,
        endDate: "2026-10-10",
        tripTypes: [],
        sections: [],
      }).date,
    ).toBe("2026-10-10");
  });
});

describe("tripPlanCounts", () => {
  // Mutation: count only routes as ways. A plan's imported tracks would go
  // uncounted in the delete confirm.
  it("counts routes and files as ways", () => {
    expect(
      tripPlanCounts({
        places: [1, 2],
        routes: [1],
        files: [1, 2],
        geoPdfs: [],
      }),
    ).toEqual({ places: 2, ways: 3, maps: 0 });
  });
});
