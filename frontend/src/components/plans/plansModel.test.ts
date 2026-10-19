import { describe, expect, it } from "vitest";
import {
  parseTripPlanFormCreate,
  TRIP_PLAN_FORM_PRESETS,
  type TripPlanFormView,
  type TripPlanView,
} from "@logjam/shared";
import {
  adoptTheirs,
  formPatch,
  type FormValues,
  addedBy,
  answeredForm,
  filesChargedTo,
  PLAN_FIELD_GROUPS,
  planPatch,
  planSummary,
  sectionPatch,
  theirsChanged,
} from "./plansModel";

const plan = {
  name: "Wollangambe trip",
  startDate: "2026-11-07",
  endDate: "2026-11-08",
  tripTypes: ["canyoning"],
};

describe("an edit sends only what changed, with what it last saw", () => {
  // Mutation: send every field (`patch = { name: …, dates: …, tripTypes: … }`
  // always) and a save over someone else's change of another field is refused.
  it("a plan's fields", () => {
    expect(planPatch(plan, plan)).toEqual({});
    expect(planPatch(plan, { ...plan, endDate: null })).toEqual({
      dates: {
        from: { startDate: "2026-11-07", endDate: "2026-11-08" },
        to: { startDate: "2026-11-07", endDate: null },
      },
    });
    expect(planPatch(plan, { ...plan, name: "Wolgan", tripTypes: [] })).toEqual(
      {
        name: { from: "Wollangambe trip", to: "Wolgan" },
        tripTypes: { from: ["canyoning"], to: [] },
      },
    );
  });

  it("a section's title and text, each on its own", () => {
    const seen = { title: "Gear", body: "Wetsuit." };
    expect(sectionPatch(seen, { ...seen, body: "Wetsuit, helmet." })).toEqual({
      body: { from: "Wetsuit.", to: "Wetsuit, helmet." },
    });
  });
});

describe("a form refetched under the user", () => {
  // Mutation: keep `values` as they were (drop the merge), and saving again
  // sends the untouched dates back over the other member's change.
  it("takes their change in every field the user did not touch, and sends only the user's", () => {
    const opened = {
      name: "Wollangambe trip",
      startDate: "2026-11-07",
      endDate: "2026-11-08",
      tripTypes: [],
    };
    const mine = { ...opened, name: "Wollangambe" };
    const theirs = { ...opened, name: "Wolly", startDate: "2026-11-14" };
    const { seen, values } = adoptTheirs(opened, mine, theirs);
    expect(values).toEqual({ ...theirs, name: "Wollangambe" });
    expect(planPatch(seen, values)).toEqual({
      name: { from: "Wolly", to: "Wollangambe" },
    });
  });

  // Mutation: adopt each date on its own, and the untouched start takes
  // theirs while the end keeps mine: 14 Nov to 9 Nov, which nobody chose.
  it("keeps both of the user's dates when they changed one", () => {
    const opened = { ...plan };
    const mine = { ...opened, endDate: "2026-11-09" };
    const theirs = {
      ...opened,
      startDate: "2026-11-14",
      endDate: "2026-11-15",
    };
    const { seen, values } = adoptTheirs(
      opened,
      mine,
      theirs,
      PLAN_FIELD_GROUPS,
    );
    expect([values.startDate, values.endDate]).toEqual([
      "2026-11-07",
      "2026-11-09",
    ]);
    expect(planPatch(seen, values).dates).toEqual({
      from: { startDate: "2026-11-14", endDate: "2026-11-15" },
      to: { startDate: "2026-11-07", endDate: "2026-11-09" },
    });
    // Untouched, both follow the plan.
    const both = adoptTheirs(opened, opened, theirs, PLAN_FIELD_GROUPS);
    expect(both.values).toEqual(theirs);
  });

  // Mutation: drop the `current` against `opened` check in theirsChanged,
  // and "In the plan now" shows under a field only the user changed.
  it("says what the plan now holds only where both the user and the plan changed it", () => {
    const opened = { name: "Wollangambe trip", body: "Meet at 7." };
    const mine = { name: "Wollangambe", body: "Meet at 6." };
    const theirs = { name: "Wolly", body: "Meet at 7." };
    const { values } = adoptTheirs(opened, mine, theirs);
    expect(theirsChanged(opened, theirs, values, ["name"])).toBe(true);
    expect(theirsChanged(opened, theirs, values, ["body"])).toBe(false);
    // Untouched by the user, the field took theirs: nothing to show.
    const untouched = adoptTheirs(opened, opened, theirs).values;
    expect(theirsChanged(opened, theirs, untouched, ["name"])).toBe(false);
  });
});

describe("a form edit", () => {
  // As Postgres serves a JSONB column: keys sorted by length, then bytes.
  const served: FormValues = {
    title: "Carpooling",
    preset: "carpool",
    visibleTo: "members",
    requiredToJoin: false,
    questions: [
      {
        id: "how",
        help: "Pick one.",
        kind: "choice",
        label: "How are you getting there?",
        options: [
          { id: "drive", label: "Driving" },
          { id: "lift", label: "Need a lift" },
        ],
        required: true,
      },
    ],
  };
  const parsed = (values: FormValues) => {
    const result = parseTripPlanFormCreate(values);
    if (!("value" in result)) throw new Error("the fixture must parse");
    return { ...values, ...result.value } as FormValues;
  };

  // Mutation: compare the questions with a raw `JSON.stringify`, and Save
  // with nothing changed writes them, so everyone's answer dialog gets a 409.
  it("sends nothing for a served form saved unchanged, and only the title for a title edit", () => {
    expect(formPatch(served, parsed(served))).toEqual({});
    expect(formPatch(served, parsed({ ...served, title: "Lifts" }))).toEqual({
      title: { from: "Carpooling", to: "Lifts" },
    });
  });

  // Mutation: re-base `seen` on theirs but keep every value as it was, and
  // the save sends the old title and questions back over the other leader's.
  it("takes another leader's rename and question when the leader changed only who sees answers", () => {
    const mine = { ...served, visibleTo: "leaders" as const };
    const theirs: FormValues = {
      ...served,
      title: "Lifts",
      questions: [
        ...served.questions,
        { id: "seats", kind: "number", label: "Spare seats", required: false },
      ],
    };
    const { seen, values } = adoptTheirs(served, mine, theirs);
    expect(formPatch(seen, values)).toEqual({
      visibleTo: { from: "members", to: "leaders" },
    });
  });
});

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
    requiredToJoin: false,
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
    geoPdfs: [],
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

  // Mutation: list every form's answers, or the places, and the bee allergy
  // or the pool's position reaches paper a parent keeps.
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
    geoPdfs: [file("60000", "tom")],
    forms: [],
  } as unknown as TripPlanView;

  // Mutation: drop the place media from `planFiles`, and Remove's "Delete
  // their files instead" leaves tom's photo charged to the leader.
  it("prices a person's files, place photos included", () => {
    expect(filesChargedTo(plan, "tom")).toEqual({ count: 3, bytes: 65000 });
    expect(filesChargedTo(plan, "mira")).toEqual({ count: 3, bytes: 370 });
  });

  // Mutations: drop `+ mine(plan.files).length` from `ways`, or the media
  // from the bytes, and Leave's "Also delete what I added" undercounts.
  it("counts what a person added, as Leave prices it", () => {
    expect(addedBy(plan, "tom")).toEqual({
      places: 2,
      ways: 2,
      maps: 1,
      bytes: 65300,
    });
    expect(addedBy(plan, "mira")).toEqual({
      places: 1,
      ways: 1,
      maps: 0,
      bytes: 70,
    });
  });
});

describe("a request's answers", () => {
  const answer = (id: string) => ({ user: { id, username: id } });
  // Mutation: ignore the user, and See answers opens a form carol never
  // answered, or shows on a request with no answers at all.
  it("opens the first form the person answered, or none", () => {
    const plan = {
      forms: [
        { id: "carpool", answers: [answer("tom")] },
        { id: "contacts", answers: [answer("tom"), answer("carol")] },
      ],
    } as unknown as TripPlanView;
    expect(answeredForm(plan, "carol")).toBe("contacts");
    expect(answeredForm(plan, "sue")).toBeNull();
  });
});
