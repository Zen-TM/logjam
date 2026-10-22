import { describe, expect, it, vi } from "vitest";
import { answersFromDraft } from "../tripPlanAnswerDraft.js";
import {
  TRIP_PLAN_FORM_PRESETS,
  type TripPlanQuestion,
  type TripPlanSummary,
  type DateOnly,
} from "../tripPlans.js";
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
  tripPlanIsDated,
  tripPlanIsOver,
  tripPlanLeaveState,
  tripPlanNotice,
  planShowsMine,
  tripPlanRoleWord,
  tripPlanRowPill,
  tripPlanRowSubtitle,
  tripPlansBadgeCount,
  tripPlansEmpty,
  tripPlansHeroTitle,
  tripPlanTripLogPrefill,
  tripPlanAnswerText,
  tripPlanSeesAnswers,
  tripPlanVisibilityLine,
  TRIP_PLAN_PRINTED_COLUMNS,
  TRIP_PLAN_PRINTED_PRESETS,
  planItemDeleteConfirm,
  planItemVerbs,
  tripPlanAddable,
  tripPlanAddCopiesLabel,
  tripPlanAddCopyPrice,
  planMemberVerbs,
  planRemoveConfirm,
  planSelfRoleConfirm,
  tripPlanInviteePill,
  tripPlanFilesChargedTo,
  tripPlanInviteLinkLine,
  tripPlanAnswerRows,
  tripPlanQuestionChoices,
  opensPreview,
  tripPlanInvitedLine,
  tripPlanPreviewHeaded,
  tripPlanTripLogPlacesLine,
  tripPlanAddCopyPriceLine,
  tripPlanAddOutcome,
  tripPlanAddPicks,
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
    // Mutation: test startDate only in tripPlanIsDated.
    expect(tripPlanIsDated(startOnly)).toBe(true);
    expect(tripPlanIsDated(summary({ endDate: TODAY }))).toBe(true);
    expect(tripPlanIsDated(summary({}))).toBe(false);
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
    // Mutation: give "member" a pill in tripPlanRowPill.
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

// Mutation: return `showMine` alone, and the map is empty of the user's own
// with no plan on it.
describe("planShowsMine", () => {
  it("draws the user's own with no plan, and beside one only when asked", () => {
    expect(planShowsMine(false, false)).toBe(true);
    expect(planShowsMine(true, false)).toBe(false);
    expect(planShowsMine(true, true)).toBe(true);
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

describe("a form's answers", () => {
  const question = (over: Partial<TripPlanQuestion>): TripPlanQuestion => ({
    id: "q",
    kind: "text",
    label: "Q",
    required: false,
    ...over,
  });
  const options = [
    { id: "a", label: "Harness" },
    { id: "b", label: "Helmet" },
  ];

  it("says each kind's answer in words, and nothing for no answer", () => {
    expect(tripPlanAnswerText(question({ kind: "choice", options }), "b")).toBe(
      "Helmet",
    );
    expect(
      tripPlanAnswerText(question({ kind: "multiChoice", options }), [
        "a",
        "b",
      ]),
    ).toBe("Harness, Helmet");
    expect(tripPlanAnswerText(question({ kind: "yesNo" }), false)).toBe("No");
    expect(tripPlanAnswerText(question({ kind: "agree" }), true)).toBe(
      "Agreed",
    );
    expect(tripPlanAnswerText(question({ kind: "number" }), 3)).toBe("3");
    expect(tripPlanAnswerText(question({}), undefined)).toBe("");
  });

  it("shows others' answers to leaders always, and to the rest when the form says so", () => {
    expect(tripPlanSeesAnswers("leader", "leaders")).toBe(true);
    expect(tripPlanSeesAnswers("editor", "leaders")).toBe(false);
    expect(tripPlanSeesAnswers("member", "members")).toBe(true);
  });
});

describe("the printed columns", () => {
  // Mutation: name a question the preset doesn't have, and its column
  // never prints.
  it("are each a question of the preset they print", () => {
    for (const preset of TRIP_PLAN_PRINTED_PRESETS) {
      const ids = TRIP_PLAN_FORM_PRESETS[preset].questions.map((q) => q.id);
      for (const column of TRIP_PLAN_PRINTED_COLUMNS[preset] ?? [])
        expect(ids).toContain(column);
    }
  });
});

describe("who sees a form's answers, as its filler reads it", () => {
  // Mutation: drop the preset check, and a gear list says it may be printed;
  // drop the line, and a safety contact goes on paper its author was never
  // told about.
  it("says a members form the print summary carries may be printed", () => {
    const printed = /may print them for someone not on the trip/;
    expect(tripPlanVisibilityLine("members", "safetyContacts")).toMatch(
      printed,
    );
    expect(tripPlanVisibilityLine("members", "carpool")).toMatch(printed);
    expect(tripPlanVisibilityLine("members", "gear")).not.toMatch(printed);
    expect(tripPlanVisibilityLine("members")).not.toMatch(printed);
    expect(tripPlanVisibilityLine("leaders", "carpool")).not.toMatch(printed);
  });
});

describe("a plan's items", () => {
  const ids = (verbs: { id: string }[]) => verbs.map((v) => v.id);
  const live = { archived: false };

  // Mutation: offer Edit and Delete to every member, and a member's press
  // on someone else's place is the API's 403 (`canChangeItem`).
  it("lets a member change only what they added, a leader or an editor anything", () => {
    const theirs = { kind: "place", mine: false };
    expect(ids(planItemVerbs("member", theirs, live))).toEqual(["save"]);
    expect(
      ids(planItemVerbs("member", { kind: "place", mine: true }, live)),
    ).toEqual(["save", "edit", "delete"]);
    expect(ids(planItemVerbs("editor", theirs, live))).toEqual([
      "save",
      "edit",
      "delete",
    ]);
  });

  // Mutation: drop `whenArchived` from Save a copy, and an archived plan's
  // things can no longer be kept, which the API allows.
  it("keeps Save a copy on an archived plan, and gives a map no Edit", () => {
    expect(
      ids(
        planItemVerbs(
          "leader",
          { kind: "route", mine: true },
          { archived: true },
        ),
      ),
    ).toEqual(["save"]);
    expect(
      ids(planItemVerbs("leader", { kind: "geoPdf", mine: true }, live)),
    ).toEqual(["download", "save", "delete"]);
  });

  // Mutation: offer Download on every kind, and a place's ⋯ has a verb with
  // nothing to fetch; drop its `whenArchived`, and an archived plan's
  // files can't be had.
  it("puts Download first on a file or a map, archived plans too", () => {
    expect(
      ids(planItemVerbs("member", { kind: "media", mine: false }, live)),
    ).toEqual(["download", "save"]);
    expect(
      ids(
        planItemVerbs(
          "member",
          { kind: "geoPdf", mine: false },
          { archived: true },
        ),
      ),
    ).toEqual(["download", "save"]);
  });

  // Mutation: leave the count out, and a place's photos go unannounced
  // (shared/DESIGN.md §9: a destructive confirm counts what goes).
  it("counts a deleted place's photos", () => {
    expect(planItemDeleteConfirm("Wollangambe").confirmBody).toBe(
      "It goes for everyone in the plan. Copies people saved stay.",
    );
    expect(planItemDeleteConfirm("Wollangambe", 1).confirmBody).toBe(
      "It goes for everyone in the plan. Its photo goes too. Copies people saved stay.",
    );
    expect(planItemDeleteConfirm("Wollangambe", 3).confirmBody).toContain(
      "Its 3 photos go too.",
    );
  });
});

describe("what Add a copy offers", () => {
  const own = {
    places: [{ id: "p1" }, { id: "p2" }],
    routes: [
      { id: "r1", ownerId: "me", placeId: null },
      { id: "r2", ownerId: "me", placeId: "p1" },
      { id: "r3", ownerId: "friend", placeId: null },
    ],
    files: [
      { id: "f1", linkedPlaceId: null },
      { id: "f2", linkedPlaceId: "p1" },
    ],
    geoPdfs: [
      { id: "g1", status: "completed", syncRole: "owner" as const },
      { id: "g2", status: "running", syncRole: "owner" as const },
      { id: "g3", status: "completed", syncRole: "shared" as const },
    ],
  };
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

  // Mutation: offer a ticked place's route or file again, and the plan gets
  // the same line twice; hide a place's file whatever Bring its photos says,
  // and with photos off it is lost and can't be added any other way.
  it("offers a place's route and file only while they would not come with it", () => {
    const none = { me: "me", tickedPlaceIds: [], copyMedia: true };
    expect(ids(tripPlanAddable(own, none).routes)).toEqual(["r1", "r2"]);
    expect(ids(tripPlanAddable(own, none).files)).toEqual(["f1", "f2"]);
    const withPhotos = { me: "me", tickedPlaceIds: ["p1"], copyMedia: true };
    expect(ids(tripPlanAddable(own, withPhotos).routes)).toEqual(["r1"]);
    expect(ids(tripPlanAddable(own, withPhotos).files)).toEqual(["f1"]);
    const noPhotos = { ...withPhotos, copyMedia: false };
    expect(ids(tripPlanAddable(own, noPhotos).routes)).toEqual(["r1"]);
    expect(ids(tripPlanAddable(own, noPhotos).files)).toEqual(["f1", "f2"]);
  });

  // Mutation: count the zero, and Add a copy opens on "Add 0 copies"; size
  // a places-only pick, and the one number beside a charge is "0 KB".
  it("leaves out a zero, in the submit and the price", () => {
    expect(tripPlanAddCopiesLabel(0)).toBe("Add a copy");
    expect(tripPlanAddCopiesLabel(2)).toBe("Add 2 copies");
    expect(tripPlanAddCopyPrice(null, "5.0 GB")).toBe("You have 5.0 GB left.");
  });

  // Mutation: drop the owner or status checks, and the API's refusal of
  // someone else's route or an unfinished map is the user's to read.
  it("offers only the caller's own routes and their finished maps", () => {
    const state = { me: "me", tickedPlaceIds: [], copyMedia: true };
    expect(ids(tripPlanAddable(own, state).routes)).not.toContain("r3");
    expect(ids(tripPlanAddable(own, state).geoPdfs)).toEqual(["g1"]);
  });
});

describe("a plan's people", () => {
  it("gives no Make for the role someone has, and nothing to a non-leader or on an archived plan", () => {
    const live = { archived: false, leaders: 1 };
    expect(
      planMemberVerbs("leader", { role: "editor", self: false }, live).map(
        (v) => v.id,
      ),
    ).toEqual(["makeLeader", "makeMember", "remove"]);
    expect(
      planMemberVerbs("editor", { role: "member", self: false }, live),
    ).toEqual([]);
    expect(
      planMemberVerbs(
        "leader",
        { role: "editor", self: false },
        { archived: true, leaders: 1 },
      ),
    ).toEqual([]);
  });

  // Mutation: drop the leaders count, and the last leader can step down and
  // leave the plan with none (the API's 409); offer Remove on yourself, and
  // a leader removes themselves past Leave's confirm.
  it("lets a leader step down only while another leader remains, never remove themselves", () => {
    const self = { role: "leader", self: true } as const;
    expect(
      planMemberVerbs("leader", self, { archived: false, leaders: 2 }).map(
        (v) => v.id,
      ),
    ).toEqual(["makeEditor", "makeMember"]);
    expect(
      planMemberVerbs("leader", self, { archived: false, leaders: 1 }),
    ).toEqual([]);
    expect(
      planMemberVerbs(
        "leader",
        { role: "editor", self: true },
        { archived: false, leaders: 2 },
      ),
    ).toEqual([]);
  });

  it("prices a removal only when the person has files", () => {
    expect(planSelfRoleConfirm("member", ["mira", "tom", "sue"])).toEqual({
      confirmTitle: "Make yourself a member?",
      confirmBody:
        "You won't be able to make yourself a leader again. The leaders mira, tom and sue can.",
      confirmLabel: "Make yourself a member",
    });
    expect(planSelfRoleConfirm("editor", ["mira"]).confirmBody).toBe(
      "You won't be able to make yourself a leader again. The leader mira can.",
    );
    expect(planRemoveConfirm("tom", "Wollangambe trip", null)).toMatchObject({
      confirmBody:
        "They lose access at once and are told. Their answers to its forms go. What they added stays in the plan.",
      deleteFilesLabel: null,
    });
    expect(
      planRemoveConfirm("tom", "Wollangambe trip", {
        count: 2,
        size: "340 MB",
      }),
    ).toMatchObject({
      confirmBody: expect.stringContaining(
        "Their files (2 files, 340 MB) will count against your storage instead.",
      ),
      deleteFilesLabel: "Delete their files instead (2 files, 340 MB)",
    });
  });
});

describe("Invite people", () => {
  // Mutation: format the instants as UTC days, and a link made before about
  // 10 am in Sydney reads as made the day before.
  it("says a link's days where the reader is, without this year", () => {
    vi.stubEnv("TZ", "Australia/Sydney");
    try {
      expect(
        tripPlanInviteLinkLine(
          {
            createdAt: "2026-10-18T22:30:00.000Z",
            expiresAt: "2026-10-25T22:30:00.000Z",
          },
          2026,
        ),
      ).toBe("Made Mon 19 Oct, works until Mon 26 Oct");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Mutation: pill everyone with a plan row "In this plan", and someone only
  // invited or asking to join is said to be in it.
  it("pills a person found by what the plan has them as", () => {
    expect(tripPlanInviteePill("active")).toBe("In this plan");
    expect(tripPlanInviteePill("invited")).toBe("Invited");
    expect(tripPlanInviteePill("requested")).toBe("Asking to join");
    expect(tripPlanInviteePill(undefined)).toBeNull();
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

describe("tripPlanFilesChargedTo", () => {
  // Mutation: leave out place photos. A removal would move storage the
  // confirm never named.
  it("counts every file charged to them, photos included", () => {
    const tom = { id: "tom", username: "tom" };
    const ann = { id: "ann", username: "ann" };
    const file = (chargedTo: typeof tom, sizeBytes: string) => ({
      chargedTo,
      sizeBytes,
    });
    expect(
      tripPlanFilesChargedTo(
        {
          files: [file(tom, "100")],
          geoPdfs: [file(ann, "50")],
          places: [{ media: [file(tom, "20"), file(ann, "5")] }],
        } as never,
        "tom",
      ),
    ).toEqual({ count: 2, bytes: 120 });
  });
});

describe("a form's answers as a reader sees them", () => {
  const user = (id: string) => ({ id, username: id });
  const answer = (id: string) => ({
    user: user(id),
    answers: { q: "x" },
    updatedAt: "",
  });
  const member = (id: string, status: "active" | "requested" | "invited") => ({
    user: user(id),
    status,
  });

  // Mutation: list only those who answered, or leave the requesters mixed
  // in. A member who owes an answer disappears, or an asker reads as going.
  it("lists everyone going, those without an answer last, then the askers", () => {
    const rows = tripPlanAnswerRows(
      {
        answers: [answer("carol"), answer("bob"), answer("ivy")],
        myAnswer: null,
      },
      [
        member("dave", "active"),
        member("bob", "active"),
        member("carol", "requested"),
        member("ivy", "invited"),
      ],
    );
    expect(rows.going.map((row) => [row.user.id, row.answer != null])).toEqual([
      ["bob", true],
      ["dave", false],
    ]);
    expect(rows.asking.map((row) => row.user.id)).toEqual(["carol"]);
  });
});

describe("the picks a choice or yes/no question offers", () => {
  // Mutation: give yes/no the values "yes"/"no", and every yes/no answer
  // fails the parser on one client only.
  it("hold what the shared draft turns into an answer", () => {
    const yesNo = tripPlanQuestionChoices({ kind: "yesNo", required: true });
    expect(yesNo.map((pick) => pick.value)).toEqual(["true", "false"]);
    const questions = [
      { id: "q", kind: "yesNo" as const, label: "Q", required: true },
    ];
    for (const { value } of yesNo)
      expect(typeof answersFromDraft(questions, { q: value }).q).toBe(
        "boolean",
      );
  });

  // Mutation: drop the "—" stop, and an optional pick can't be taken back.
  it("starts an optional one with a way back, and a required one without", () => {
    const options = [{ id: "a", label: "A" }];
    expect(
      tripPlanQuestionChoices({ kind: "choice", required: false, options }),
    ).toEqual([
      { value: "", label: "—" },
      { value: "a", label: "A" },
    ]);
    expect(
      tripPlanQuestionChoices({ kind: "choice", required: true, options })[0]
        .value,
    ).toBe("a");
  });
});

describe("which page a plan opens on", () => {
  // Mutation: decide from the list alone, and an invite that arrived while
  // the list was open opens the member's page, which 404s.
  it("opens an invite's preview though the list has not heard of it", () => {
    expect(opensPreview(true, undefined)).toBe(true);
    expect(opensPreview(true, "invited")).toBe(true);
    expect(opensPreview(true, "active")).toBe(false);
    expect(opensPreview(false, "invited")).toBe(false);
  });
});

describe("an invite's preview", () => {
  const preview = {
    startDate: "2026-11-26" as DateOnly,
    endDate: "2026-11-27" as DateOnly,
    invitedBy: { id: "c", username: "carol" },
  };
  // Mutation: drop the invitedBy part, or join a stray " · " when there is
  // no invitedBy.
  it("says the dates and who invited, whichever there are", () => {
    expect(tripPlanInvitedLine(preview, 2026)).toBe(
      "Thu 26 – Fri 27 Nov · Invited by carol",
    );
    expect(tripPlanInvitedLine({ ...preview, invitedBy: null }, 2026)).toBe(
      "Thu 26 – Fri 27 Nov",
    );
    expect(
      tripPlanInvitedLine(
        { startDate: null, endDate: null, invitedBy: preview.invitedBy },
        2026,
      ),
    ).toBe("No dates yet · Invited by carol");
  });

  // Mutation: always head the people, and a preview of people alone gets a
  // lone heading.
  it("heads its groups only beside a second one", () => {
    expect(tripPlanPreviewHeaded({ sections: [], requiredForms: [] })).toBe(
      false,
    );
    expect(
      tripPlanPreviewHeaded({ sections: [], requiredForms: [{}] as never }),
    ).toBe(true);
  });
});

describe("Start a trip log's places line", () => {
  const bare = { media: [] };
  const withOne = { media: [{}] };
  // Mutation: decide from every place, or ignore the picks, and picking
  // only a place without photos promises "with its photos".
  it("promises photos only where the picks have some", () => {
    expect(tripPlanTripLogPlacesLine([bare], true)).not.toMatch(/photos/);
    expect(tripPlanTripLogPlacesLine([], true)).not.toMatch(/photos/);
    expect(tripPlanTripLogPlacesLine([bare, withOne], true)).toMatch(
      /with its photos/,
    );
    expect(tripPlanTripLogPlacesLine([withOne], false)).toMatch(
      /without its photos/,
    );
  });
});

describe("Add a copy's footer and outcome", () => {
  const MB = 1024 * 1024;
  const room = { quotaBytes: MB, usedBytes: 0 };
  // Mutation: drop `&& copyMedia`, and "Photos count too." promises a cost
  // the POST (copyMedia: false) never takes.
  it("prices what is ticked, photos only when they come", () => {
    expect(
      tripPlanAddCopyPriceLine({
        bytes: 0,
        placesPicked: false,
        copyMedia: true,
        ...room,
      }),
    ).toBeNull();
    expect(
      tripPlanAddCopyPriceLine({
        bytes: 0,
        placesPicked: true,
        copyMedia: true,
        ...room,
      }),
    ).toMatch(/Photos count too\.$/);
    expect(
      tripPlanAddCopyPriceLine({
        bytes: MB,
        placesPicked: true,
        copyMedia: false,
        ...room,
      }),
    ).not.toMatch(/Photos/);
  });

  // Mutation: send every tick, and a route ticked before its place goes
  // twice, once alone and once with the place, both charged.
  it("sends only ticks still offered, in list order", () => {
    const offered = [
      { kind: "place", id: "p" },
      { kind: "geoPdf", id: "g" },
    ];
    expect(
      tripPlanAddPicks(offered, ["geoPdf:g", "route:r", "place:p"]),
    ).toEqual(offered);
  });

  // Mutation: toast a run that added nothing, and its reason leaves the
  // dialog where it can be read.
  it("says what landed, and nothing when nothing did", () => {
    const base = { asked: 2, skipped: 0, outOfSpace: false, why: null };
    expect(tripPlanAddOutcome({ ...base, added: 0, why: "No." })).toBeNull();
    expect(tripPlanAddOutcome({ ...base, added: 2 })).toEqual({
      message: "Added 2 copies.",
      tone: "info",
    });
    expect(tripPlanAddOutcome({ ...base, added: 1, why: "No." })).toEqual({
      message: "Added 1 of 2. No.",
      tone: "error",
    });
  });
});
