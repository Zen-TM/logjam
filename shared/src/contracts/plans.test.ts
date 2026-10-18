import { describe, expect, it } from "vitest";
import type { TripPlanSummary } from "../tripPlans.js";
import {
  planCountsLabel,
  planDeleteConfirm,
  planVerbs,
  planVerbsFor,
  PLAN_ADD_VERBS,
  PLAN_FORM_VERBS,
  sortTripPlans,
  tripPlanBucket,
  tripPlanDatesLabel,
  tripPlanDatesLine,
  tripPlanNotice,
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
  it("keeps a plan upcoming through its last day, and one with no dates", () => {
    expect(tripPlanBucket(summary({ endDate: TODAY }), TODAY)).toBe("upcoming");
    expect(tripPlanBucket(summary({}), TODAY)).toBe("upcoming");
    expect(tripPlanBucket(summary({ endDate: "2026-10-18" }), TODAY)).toBe(
      "past",
    );
    // No end: the start is the last day.
    expect(tripPlanBucket(summary({ startDate: "2026-10-18" }), TODAY)).toBe(
      "past",
    );
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
    expect(sortTripPlans([c, a, b], "upcoming").map((p) => p.id)).toEqual([
      "b",
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

  it("leads Logjam GPS's hero with the next trip the caller is in", () => {
    expect(
      tripPlansHeroTitle(
        [
          summary({ name: "Later", startDate: "2026-12-01" }),
          summary({ name: "Soon", startDate: "2026-11-08" }),
          summary({
            name: "Asked",
            startDate: "2026-10-20",
            status: "requested",
          }),
        ],
        TODAY,
        2026,
      ),
    ).toBe("Next: Soon, Sun 8 Nov");
    expect(tripPlansHeroTitle([], TODAY)).toBe("No plans yet");
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
      text: 'Answer "Safety contacts" for the leaders.',
      formId: "f",
    });
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
});

describe("a plan's verbs", () => {
  it("gives a member no verb the API refuses them", () => {
    const ids = planVerbs("web", "member", {
      archived: false,
      over: false,
    }).map((verb) => verb.id);
    expect(ids).toEqual(["print", "leave"]);
  });

  it("offers Archive or Bring back by the plan's state, and only what still works on an archived plan", () => {
    const live = planVerbs("web", "leader", { archived: false, over: true });
    expect(live.map((verb) => verb.id)).toEqual([
      "edit",
      "print",
      "tripLog",
      "archive",
      "leave",
      "delete",
    ]);
    const archived = planVerbs("web", "leader", {
      archived: true,
      over: false,
    });
    expect(archived.map((verb) => verb.id)).toEqual([
      "print",
      "unarchive",
      "leave",
      "delete",
    ]);
  });

  it("builds forms and prints on Logjam Web only", () => {
    expect(
      planVerbsFor(PLAN_ADD_VERBS, "gps", "leader").map((verb) => verb.id),
    ).toEqual(["section", "copy", "invite"]);
    expect(
      planVerbsFor(PLAN_FORM_VERBS, "gps", "leader").map((verb) => verb.id),
    ).toEqual(["delete"]);
    expect(
      planVerbs("gps", "member", { archived: false, over: false }).map(
        (verb) => verb.id,
      ),
    ).toEqual(["leave"]);
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
});

describe("a trip log from a plan", () => {
  it("fills the trip form with the first day, the name, the types and the write-up", () => {
    expect(
      tripPlanTripLogPrefill({
        name: "Wollangambe trip",
        startDate: "2026-11-07",
        tripTypes: ["canyoning"],
        sections: [
          { title: "Overview", body: "Two days." },
          { title: "Gear", body: "" },
        ],
      }),
    ).toEqual({
      date: "2026-11-07",
      displayName: "Wollangambe trip",
      types: ["canyoning"],
      notes: "Overview\n\nTwo days.\n\nGear",
    });
  });
});
