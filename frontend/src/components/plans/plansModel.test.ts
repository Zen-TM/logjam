import { describe, expect, it } from "vitest";
import {
  TRIP_PLAN_FORM_PRESETS,
  tripPlanFilesChargedTo,
  type TripPlanFormView,
  type TripPlanView,
} from "@logjam/shared";
import { addedBy, planMapPress, planSummary } from "./plansModel";

describe("the print summary", () => {
  const user = (username: string) => ({ id: username, username });
  // Answers by username, as a leader is served them: sue's too, though she
  // has only asked to join.
  const form = (
    preset: TripPlanFormView["preset"],
    byUser: Record<string, Record<string, unknown>>,
  ): TripPlanFormView => ({
    id: preset ?? "f",
    title: preset ?? "Other",
    preset,
    questions: preset ? TRIP_PLAN_FORM_PRESETS[preset].questions : [],
    visibleTo: "members",
    position: 0,
    updatedAt: "",
    myAnswer: null,
    answers: Object.entries(byUser).map(([username, answers]) => ({
      user: user(username),
      answers: answers as never,
      updatedAt: "",
    })),
  });
  const plan = {
    id: "p",
    name: "Wollangambe trip",
    startDate: null,
    endDate: null,
    tripTypes: [],
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
    createdBy: null,
    myRole: "leader",
    sections: [
      {
        id: "s",
        title: "Overview",
        body: "Two days.",
        position: 0,
        updatedAt: "",
      },
    ],
    members: [
      {
        user: user("mira"),
        role: "leader",
        status: "active",
        invitedBy: null,
        createdAt: "",
      },
      {
        user: user("tom"),
        role: "member",
        status: "active",
        invitedBy: null,
        createdAt: "",
      },
      {
        user: user("sue"),
        role: "member",
        status: "requested",
        invitedBy: null,
        createdAt: "",
      },
    ],
    places: [
      {
        kind: "place",
        name: "Secret pool",
        latitude: -33.51234,
        longitude: 150.41234,
      },
    ],
    routes: [],
    files: [],
    forms: [
      form("carpool", {
        tom: { mode: "lift", seats: 2, from: "Katoomba" },
        sue: { mode: "own", from: "Leura" },
      }),
      form("safetyContacts", {
        tom: { name: "Ann", phone: "0400 000 000" },
        sue: { name: "Sue's dad", phone: "0400 999 999" },
      }),
      form("firstAid", { tom: { cert: "no", conditions: "Bee allergy" } }),
    ],
  } as unknown as TripPlanView;
  const all = {
    writeUp: true,
    going: true,
    presets: ["carpool", "safetyContacts"] as const,
  };
  const table = (summary: ReturnType<typeof planSummary>, preset: string) =>
    summary.tables.find((each) => each.preset === preset);

  // Mutation: add the places to planSummary's result, and the pool's position
  // reaches paper a parent keeps. The bee allergy is kept out three ways
  // (summaryForms, the ticked presets, the printed columns): no one edit
  // lets it through.
  it("never carries a place, a coordinate or another form's answers", () => {
    const text = JSON.stringify(planSummary(plan, all));
    expect(text).not.toContain("Secret pool");
    expect(text).not.toContain("-33.5");
    expect(text).not.toContain("Bee allergy");
    expect(text).toContain("Katoomba");
    expect(text).toContain("0400 000 000");
  });

  // Mutation: drop the going filter in `answerTable`, and a stranger asking
  // by link has their emergency contact printed as one of the group's.
  it("prints no answer from someone who only asked to join", () => {
    const text = JSON.stringify(planSummary(plan, all));
    expect(text).not.toContain("sue");
    expect(text).not.toContain("Leura");
    expect(text).not.toContain("0400 999 999");
  });

  // Mutation: offer any form the caller sees, and a leaders-only form's
  // answers go on paper though their authors were told only leaders see them.
  it("prints no form only the leaders see", () => {
    const leadersOnly = {
      ...plan,
      forms: plan.forms.map((each) => ({
        ...each,
        visibleTo: "leaders" as const,
      })),
    };
    expect(planSummary(leadersOnly, all).tables).toEqual([]);
  });

  // Mutation: head the columns with the preset's words, or keep a column
  // whose kind changed, and a "Medications" answer prints as a contact.
  it("heads its columns with the labels now, and drops a question that became something else", () => {
    const contacts = plan.forms[1];
    const edited = {
      ...plan,
      forms: [
        {
          ...contacts,
          questions: contacts.questions.map((question) =>
            question.id === "name"
              ? { ...question, label: "Who to call" }
              : question.id === "phone"
                ? {
                    ...question,
                    kind: "longText" as const,
                    label: "Medications",
                  }
                : question,
          ),
        },
      ],
    };
    const summary = planSummary(edited, all);
    expect(table(summary, "safetyContacts")?.head).toEqual([
      "Name",
      "Who to call",
      "Second contact's name",
      "Second contact's phone",
    ]);
    expect(JSON.stringify(summary)).not.toContain("0400 000 000");
  });

  it("lists who's going, not who asked to join, and leaves out what was unticked", () => {
    const summary = planSummary(plan, {
      ...all,
      presets: ["safetyContacts"],
      writeUp: false,
    });
    expect(summary.going.map(([name]) => name)).toEqual(["mira", "tom"]);
    expect(summary.leaders).toEqual(["mira"]);
    expect(table(summary, "carpool")).toBeUndefined();
    expect(table(summary, "safetyContacts")).toBeDefined();
    expect(summary.sections).toEqual([]);
  });
});

describe("what someone going takes or leaves", () => {
  const ref = (id: string) => ({ id, username: id });
  const file = (sizeBytes: string, charged: string, added = charged) => ({
    sizeBytes,
    chargedTo: ref(charged),
    addedBy: ref(added),
  });
  // tom added a place with a photo, a route, a GPX file and a GeoPDF; mira
  // added a place and a file, and pays for tom's photo after taking it on.
  const plan = {
    places: [
      { addedBy: ref("tom"), media: [file("1000", "tom")] },
      { addedBy: ref("mira"), media: [file("20", "mira")] },
      { addedBy: ref("tom"), media: [file("300", "mira", "tom")] },
    ],
    routes: [{ addedBy: ref("tom") }],
    files: [file("4000", "tom"), file("50", "mira")],
    forms: [],
  } as unknown as TripPlanView;

  // Mutation: drop the place media from shared's `tripPlanFilesChargedTo`,
  // and Remove's "Delete their files instead" leaves tom's photo charged to
  // the leader.
  it("prices a person's files, place photos included", () => {
    expect(tripPlanFilesChargedTo(plan, "tom")).toEqual({
      count: 2,
      bytes: 5000,
    });
    expect(tripPlanFilesChargedTo(plan, "mira")).toEqual({
      count: 3,
      bytes: 370,
    });
  });

  // Mutations: drop `+ mine(plan.files).length` from `ways`, or the media
  // from the bytes, and Leave's "Also delete what I added" undercounts.
  it("counts what a person added, as Leave prices it", () => {
    expect(addedBy(plan, "tom")).toEqual({
      places: 2,
      ways: 2,
      bytes: 5300,
    });
    expect(addedBy(plan, "mira")).toEqual({
      places: 1,
      ways: 1,
      bytes: 70,
    });
  });
});

describe("a press on the map while a plan is open", () => {
  const own = {
    places: [{ id: "p1" }],
    routes: [
      { id: "r1", ownerId: "me" },
      { id: "r2", ownerId: "friend" },
    ],
    files: [
      { id: "f1", linkedPlaceId: null },
      { id: "f2", linkedPlaceId: "p1" },
    ],
    tracks: [
      { mediaId: "t1", placeId: "p1" },
      { mediaId: "t2", placeId: "theirs" },
    ],
  };

  // Mutation: treat a track press as outside the plan (open its way), and
  // the way page replaces the plan, its bar and its things. Or send a
  // place's file to its place: a file of the user's own asks for itself and
  // brings its photos, and any other track on their place asks for the place.
  it("asks Add a place or way for the user's own file, or a track's place", () => {
    expect(planMapPress({ kind: "track", id: "f1" }, own, "me")).toEqual({
      kind: "media",
      id: "f1",
    });
    expect(planMapPress({ kind: "track", id: "f2" }, own, "me")).toEqual({
      kind: "media",
      id: "f2",
    });
    expect(planMapPress({ kind: "track", id: "t1" }, own, "me")).toEqual({
      kind: "place",
      id: "p1",
    });
    expect(planMapPress({ kind: "track", id: "t2" }, own, "me")).toBeNull();
  });

  // Mutation: drop the owner check, and a friend's route shared with the
  // user opens an Add a place or way the API refuses.
  it("asks nothing for the plan's own things or someone else's", () => {
    expect(planMapPress({ kind: "route", id: "r1" }, own, "me")).toEqual({
      kind: "route",
      id: "r1",
    });
    expect(planMapPress({ kind: "route", id: "r2" }, own, "me")).toBeNull();
    expect(
      planMapPress({ kind: "place", id: "plan-place" }, own, "me"),
    ).toBeNull();
  });
});
