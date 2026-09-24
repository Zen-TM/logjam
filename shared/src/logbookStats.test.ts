import { describe, expect, it } from "vitest";

import {
  computeLogbookStats,
  UNTAGGED_ACTIVITY,
  type StatsInput,
  type StatsTrip,
  type FieldStat,
} from "./logbookStats.js";
import type { ScopedCustomFieldDef } from "./tripLogFields.js";

const CANYON = "type-canyon";
const CAMPSITE = "type-campsite";

function def(
  over: Partial<ScopedCustomFieldDef> & Pick<ScopedCustomFieldDef, "key" | "type">,
): ScopedCustomFieldDef {
  return {
    label: over.key,
    min: null,
    max: null,
    placeTypeIds: [],
    tripTypes: [],
    appliesToAllTypes: false,
    ...over,
  } as ScopedCustomFieldDef;
}

function trip(
  date: string,
  over: Partial<StatsTrip> = {},
): StatsTrip {
  return {
    id: date,
    date: `${date}T00:00:00.000Z`,
    types: ["canyoning"],
    places: [],
    customFields: {},
    ...over,
  };
}

function run(over: Partial<StatsInput> = {}) {
  return computeLogbookStats({
    trips: [],
    places: [],
    tripDefs: [],
    placeDefs: [],
    placeTypes: [],
    ...over,
  });
}

function stat(stats: FieldStat[], key: string): FieldStat {
  const found = stats.find((entry) => entry.key === key);
  if (!found) throw new Error(`no stat for ${key}`);
  return found;
}

/** Every place stat across every type group, for assertions that don't care
 *  which type a field hung under. */
function allPlaceStats(result: { placeFieldStats: { stats: FieldStat[] }[] }): FieldStat[] {
  return result.placeFieldStats.flatMap((group) => group.stats);
}

describe("computeLogbookStats", () => {
  it("counts days out, not trips, when two trips share a day", () => {
    const stats = run({ trips: [trip("2026-03-01"), trip("2026-03-01")] });
    expect(stats.trips).toBe(2);
    expect(stats.days).toBe(1);
  });

  it("reads trip dates in UTC regardless of the host timezone", () => {
    // A UTC-midnight date read in local fields east of Greenwich is the day
    // before (CH-001). The first/last keys must be the stored day.
    const stats = run({ trips: [trip("2026-01-01"), trip("2026-12-31")] });
    expect(stats.firstDate).toBe("2026-01-01");
    expect(stats.lastDate).toBe("2026-12-31");
  });

  describe("cadence", () => {
    it("measures the longest gap and the longest consecutive run", () => {
      const stats = run({
        trips: [
          trip("2026-01-01"),
          trip("2026-01-02"),
          trip("2026-01-03"),
          trip("2026-03-01"),
        ],
      });
      expect(stats.longestRunDays).toBe(3);
      expect(stats.longestGapDays).toBe(57);
      expect(stats.averageGapDays).toBe(20); // 59 days over 3 intervals
    });

    it("has no gap to report from a single day out", () => {
      const stats = run({ trips: [trip("2026-01-01")] });
      expect(stats.averageGapDays).toBeNull();
      expect(stats.longestGapDays).toBeNull();
      expect(stats.longestRunDays).toBe(1);
    });

    it("counts a Saturday and a Sunday as weekend trips", () => {
      // 2026-03-07 is a Saturday, 2026-03-08 a Sunday, 2026-03-09 a Monday.
      const stats = run({
        trips: [trip("2026-03-07"), trip("2026-03-08"), trip("2026-03-09")],
      });
      expect(stats.weekendTrips).toBe(2);
    });
  });

  describe("range", () => {
    const trips = [trip("2025-06-01"), trip("2026-02-01"), trip("2026-08-01")];

    it("filters inclusively on both bounds", () => {
      expect(run({ trips, from: "2026-02-01", to: "2026-08-01" }).trips).toBe(2);
    });

    it("counts a place as NEW only when its first EVER visit is in range", () => {
      const places = [{ id: "p1", name: "Claustral", placeTypeId: CANYON, fieldValues: {} }];
      const visited = [
        trip("2025-06-01", { places: [{ id: "p1", name: "Claustral" }] }),
        trip("2026-02-01", { places: [{ id: "p1", name: "Claustral" }] }),
      ];
      // In 2026 the place was visited but is not new — the first visit was 2025.
      const stats = run({ trips: visited, places, from: "2026-01-01" });
      expect(stats.places).toBe(1);
      expect(stats.newPlaces).toBe(0);
      expect(run({ trips: visited, places }).newPlaces).toBe(1);
    });
  });

  describe("activities", () => {
    const trips = [
      trip("2026-01-01", { types: ["canyoning"] }),
      trip("2026-01-02", { types: ["bushwalking", "canyoning"] }),
      trip("2026-01-03", { types: [] }),
    ];

    it("counts a multi-tag trip under both tags", () => {
      const stats = run({ trips });
      expect(stats.activityTallies).toEqual([
        { type: "canyoning", trips: 2, places: 0 },
        { type: "bushwalking", trips: 1, places: 0 },
        { type: UNTAGGED_ACTIVITY, trips: 1, places: 0 },
      ]);
    });

    it("sorts untagged last however many there are", () => {
      const many = [
        trip("2026-02-01", { types: [] }),
        trip("2026-02-02", { types: [] }),
        trip("2026-02-03", { types: [] }),
        ...trips,
      ];
      expect(run({ trips: many }).activityTallies.at(-1)?.type).toBe(
        UNTAGGED_ACTIVITY,
      );
    });

    it("filters to one activity, case-insensitively", () => {
      expect(run({ trips, activity: "Canyoning" }).trips).toBe(2);
    });

    it("filters to trips with no tag at all", () => {
      expect(run({ trips, activity: UNTAGGED_ACTIVITY }).trips).toBe(1);
    });

    it("keeps the full tally list while filtered, so the All screen and a drill-down agree", () => {
      expect(run({ trips, activity: "canyoning" }).activityTallies).toHaveLength(3);
    });
  });

  describe("field stats", () => {
    const places = [
      {
        id: "p1",
        name: "Claustral",
        placeTypeId: CANYON,
        fieldValues: { v_grade: 6, num_abseils: 10, quality: 4 },
      },
      {
        id: "p2",
        name: "Empress",
        placeTypeId: CANYON,
        fieldValues: { v_grade: 4, num_abseils: 3, quality: 5 },
      },
    ];
    const placeDefs = [
      def({ key: "v_grade", label: "V grade", type: "integer", min: 1, max: 7, placeTypeIds: [CANYON] }),
      def({ key: "num_abseils", label: "Pitches", type: "integer", min: 0, max: null, placeTypeIds: [CANYON] }),
      def({ key: "quality", label: "Quality", type: "float", min: 1, max: 5, placeTypeIds: [CANYON, CAMPSITE] }),
    ];
    const trips = [
      trip("2025-01-01", { places: [{ id: "p1", name: "Claustral" }] }),
      trip("2026-01-01", { places: [{ id: "p2", name: "Empress" }] }),
      trip("2026-02-01", { places: [{ id: "p2", name: "Empress" }] }),
    ];

    it("weights a place attribute PER TRIP, not per place", () => {
      const stats = run({ trips, places, placeDefs });
      const pitches = stat(allPlaceStats(stats), "num_abseils");
      if (pitches.kind !== "quantity") throw new Error("expected a quantity");
      // Empress twice (3 + 3) plus Claustral once (10). Per-place would be 13.
      expect(pitches.total).toBe(16);
      expect(pitches.best).toEqual({ value: 10, label: "Claustral" });
    });

    it("reads a bounded field as a rating and an unbounded one as a quantity", () => {
      const stats = run({ trips, places, placeDefs });
      expect(stat(allPlaceStats(stats), "v_grade").kind).toBe("rating");
      expect(stat(allPlaceStats(stats), "num_abseils").kind).toBe("quantity");
    });

    it("keeps empty steps in a rating's buckets, because the gaps are the shape", () => {
      const stats = run({ trips, places, placeDefs });
      const grade = stat(allPlaceStats(stats), "v_grade");
      if (grade.kind !== "rating") throw new Error("expected a rating");
      expect(grade.buckets.map((b) => b.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(grade.buckets.find((b) => b.value === 4)?.count).toBe(2);
      expect(grade.buckets.find((b) => b.value === 6)?.count).toBe(1);
      expect(grade.best).toEqual({ value: 6, label: "Claustral" });
    });

    it("summarises a field scoped to two types ONCE PER TYPE, over that type's own samples", () => {
      // The quality of the canyons someone does and the quality of the
      // campsites they stay at are two distributions, not one.
      const both = [
        ...trips,
        trip("2026-03-01", { places: [{ id: "p3", name: "Blue Gum" }] }),
      ];
      const withCampsite = [
        ...places,
        { id: "p3", name: "Blue Gum", placeTypeId: CAMPSITE, fieldValues: { quality: 3 } },
      ];
      const stats = run({
        trips: both,
        places: withCampsite,
        placeDefs,
        placeTypes: [
          { id: CANYON, name: "Canyon", color: "#E4C5AA" },
          { id: CAMPSITE, name: "Campsite", color: "#BED9B5" },
        ],
      });
      expect(allPlaceStats(stats).filter((entry) => entry.key === "quality")).toHaveLength(2);

      const canyonGroup = stats.placeFieldStats.find((g) => g.typeId === CANYON);
      const campsiteGroup = stats.placeFieldStats.find((g) => g.typeId === CAMPSITE);
      const canyonQuality = stat(canyonGroup!.stats, "quality");
      const campsiteQuality = stat(campsiteGroup!.stats, "quality");
      if (canyonQuality.kind !== "rating" || campsiteQuality.kind !== "rating") {
        throw new Error("expected ratings");
      }
      // Claustral 4, Empress 5 twice; the campsite's 3 must not be pooled in.
      expect(canyonQuality.average).toBeCloseTo(14 / 3);
      expect(campsiteQuality.average).toBe(3);
    });

    it("orders type groups by how much the trips actually visited them", () => {
      const both = [
        ...trips,
        trip("2026-03-01", { places: [{ id: "p3", name: "Blue Gum" }] }),
      ];
      const withCampsite = [
        ...places,
        { id: "p3", name: "Blue Gum", placeTypeId: CAMPSITE, fieldValues: { quality: 3 } },
      ];
      const stats = run({
        trips: both,
        places: withCampsite,
        placeDefs,
        placeTypes: [
          { id: CAMPSITE, name: "Campsite", color: "#BED9B5" },
          { id: CANYON, name: "Canyon", color: "#E4C5AA" },
        ],
      });
      // Three canyon visits to one campsite visit, whatever order the types
      // themselves sort in.
      expect(stats.placeFieldStats.map((group) => group.name)).toEqual([
        "Canyon",
        "Campsite",
      ]);
    });

    it("treats a widely-bounded number as a quantity, not a hundred-bar chart", () => {
      const wide = [def({ key: "num_abseils", type: "integer", min: 0, max: 100, placeTypeIds: [CANYON] })];
      const stats = run({ trips, places, placeDefs: wide });
      expect(stat(allPlaceStats(stats), "num_abseils").kind).toBe("quantity");
    });

    it("counts a boolean trip field as yes-of-answered, ignoring unanswered trips", () => {
      const tripDefs = [def({ key: "wetsuit", label: "Wetsuit", type: "boolean", appliesToAllTypes: true })];
      const answered = [
        trip("2026-01-01", { customFields: { wetsuit: true } }),
        trip("2026-01-02", { customFields: { wetsuit: false } }),
        trip("2026-01-03", { customFields: {} }),
      ];
      const stats = run({ trips: answered, tripDefs });
      const wetsuit = stat(stats.tripFieldStats, "wetsuit");
      if (wetsuit.kind !== "boolean") throw new Error("expected a boolean");
      expect(wetsuit).toMatchObject({ yes: 1, of: 2 });
    });

    it("folds a string field's case variants into one answer", () => {
      const tripDefs = [def({ key: "water_level", type: "string", appliesToAllTypes: true })];
      const answered = [
        trip("2026-01-01", { customFields: { water_level: "High" } }),
        trip("2026-01-02", { customFields: { water_level: "high" } }),
        trip("2026-01-03", { customFields: { water_level: "low" } }),
      ];
      const water = stat(run({ trips: answered, tripDefs }).tripFieldStats, "water_level");
      if (water.kind !== "vocabulary") throw new Error("expected a vocabulary");
      expect(water.values).toEqual([
        { value: "High", count: 2 },
        { value: "low", count: 1 },
      ]);
    });

    it("drops a vocabulary with only one answer in it — a tally of one says nothing", () => {
      // Four trips to one canyon repeat its permit number four times: repeated,
      // short, under the cardinality cap, and still not a distribution.
      const placeDefs = [def({ key: "permit", type: "string", placeTypeIds: [CANYON] })];
      const places = [
        { id: "p1", name: "Claustral", placeTypeId: CANYON, fieldValues: { permit: "NPWS-2026-114" } },
      ];
      const answered = [
        trip("2026-01-01", { places: [{ id: "p1", name: "Claustral" }] }),
        trip("2026-02-01", { places: [{ id: "p1", name: "Claustral" }] }),
      ];
      expect(
        allPlaceStats(run({ trips: answered, places, placeDefs })).find(
          (entry) => entry.key === "permit",
        ),
      ).toBeUndefined();
    });

    it("drops a prose answer even when only a few of them are distinct", () => {
      // "Access beta" holds a paragraph, and four trips to one canyon repeat it
      // — three distinct values, under the cardinality cap, and still not a
      // vocabulary.
      const placeDefs = [def({ key: "access", type: "string", placeTypeIds: [CANYON] })];
      const places = [
        {
          id: "p1",
          name: "Claustral",
          placeTypeId: CANYON,
          fieldValues: { access: "Park at the locked gate, walk the fire trail 20 min." },
        },
      ];
      const answered = [trip("2026-01-01", { places: [{ id: "p1", name: "Claustral" }] })];
      expect(
        allPlaceStats(run({ trips: answered, places, placeDefs })).find(
          (entry) => entry.key === "access",
        ),
      ).toBeUndefined();
    });

    it("drops a free-prose string rather than listing every answer", () => {
      const tripDefs = [def({ key: "notes_field", type: "string", appliesToAllTypes: true })];
      const answered = Array.from({ length: 9 }, (_, index) =>
        trip(`2026-01-0${index + 1}`, { customFields: { notes_field: `answer ${index}` } }),
      );
      expect(
        run({ trips: answered, tripDefs }).tripFieldStats.find(
          (entry) => entry.key === "notes_field",
        ),
      ).toBeUndefined();
    });

    // Trip attributes are scoped by TAG. The All screen answers "what does every
    // trip say"; an attribute one activity asks waits for that activity.
    describe("scoped by trip type", () => {
      const tripDefs = [
        def({ key: "wetsuit", type: "boolean", appliesToAllTypes: true }),
        def({ key: "flow", type: "integer", tripTypes: ["packrafting"] }),
      ];
      const answered = [
        trip("2026-01-01", {
          types: ["packrafting"],
          customFields: { wetsuit: true, flow: 12 },
        }),
        trip("2026-01-02", { types: ["canyoning"], customFields: { wetsuit: false } }),
      ];

      it("keeps an activity's attribute off the All screen, and says so", () => {
        const stats = run({ trips: answered, tripDefs });
        expect(stats.tripFieldStats.map((entry) => entry.key)).toEqual(["wetsuit"]);
        expect(stats.tripFieldsUnderActivities).toBe(1);
      });

      it("shows it on that activity's screen, over that activity's trips only", () => {
        const stats = run({ trips: answered, tripDefs, activity: "Packrafting" });
        expect(stats.tripFieldStats.map((entry) => entry.key)).toEqual(["wetsuit", "flow"]);
        const wetsuit = stat(stats.tripFieldStats, "wetsuit");
        if (wetsuit.kind !== "boolean") throw new Error("expected a boolean");
        expect(wetsuit).toMatchObject({ yes: 1, of: 1 });
        expect(stats.tripFieldsUnderActivities).toBe(0);
      });

      it("keeps it off an activity that does not ask it", () => {
        const stats = run({ trips: answered, tripDefs, activity: "canyoning" });
        expect(stats.tripFieldStats.map((entry) => entry.key)).toEqual(["wetsuit"]);
      });

      it("does not mention activity attributes nobody has answered", () => {
        const unanswered = answered.map((entry) => ({ ...entry, customFields: {} }));
        expect(run({ trips: unanswered, tripDefs }).tripFieldsUnderActivities).toBe(0);
      });

      // The union clause `tripFieldDefs` needs: retagging a trip or rescoping a
      // definition must not silently drop a value the user already recorded.
      it("still counts a value on a trip that no longer carries the attribute's tag", () => {
        const retagged = [
          trip("2026-01-01", { types: [], customFields: { flow: 12 } }),
        ];
        const stats = run({ trips: retagged, tripDefs, activity: UNTAGGED_ACTIVITY });
        expect(stat(stats.tripFieldStats, "flow").kind).toBe("quantity");
      });
    });

    it("keeps a trip's own attributes out of the place groups", () => {
      // The two lists answer different questions and the UI presents them
      // differently — a trip attribute is the user's own answer, a place
      // attribute is a property of somewhere they went.
      const tripDefs = [def({ key: "wetsuit", type: "boolean", appliesToAllTypes: true })];
      const answered = [
        trip("2026-01-01", {
          places: [{ id: "p1", name: "Claustral" }],
          customFields: { wetsuit: true },
        }),
      ];
      const stats = run({ trips: answered, places, placeDefs, tripDefs });
      expect(stats.tripFieldStats.map((entry) => entry.key)).toEqual(["wetsuit"]);
      expect(allPlaceStats(stats).map((entry) => entry.key)).toContain("num_abseils");
      expect(allPlaceStats(stats).map((entry) => entry.key)).not.toContain("wetsuit");
    });
  });

  describe("places", () => {
    const places = [
      { id: "p1", name: "Claustral", placeTypeId: CANYON, fieldValues: {} },
      { id: "p2", name: "Empress", placeTypeId: CANYON, fieldValues: {} },
      { id: "p3", name: "Blue Gum", placeTypeId: CAMPSITE, fieldValues: {} },
    ];
    const placeTypes = [
      { id: CANYON, name: "Canyon", color: "#E4C5AA" },
      { id: CAMPSITE, name: "Campsite", color: "#BED9B5" },
    ];
    const trips = [
      trip("2026-01-01", { places: [{ id: "p1", name: "Claustral" }] }),
      trip("2026-01-02", { places: [{ id: "p1", name: "Claustral" }] }),
    ];

    it("reports completion per type over the places that exist", () => {
      expect(run({ trips, places, placeTypes }).completion).toEqual([
        { typeId: CANYON, name: "Canyon", color: "#E4C5AA", total: 2, logged: 1 },
        { typeId: CAMPSITE, name: "Campsite", color: "#BED9B5", total: 1, logged: 0 },
      ]);
    });

    it("omits a type the user has no places of", () => {
      const withEmpty = [...placeTypes, { id: "type-marker", name: "Marker", color: "#B7D0E1" }];
      expect(
        run({ trips, places, placeTypes: withEmpty }).completion.map((entry) => entry.name),
      ).toEqual(["Canyon", "Campsite"]);
    });

    it("counts a place visited twice as a return, and a place visited once as neither", () => {
      const mixed = [
        ...trips,
        trip("2026-01-03", { places: [{ id: "p2", name: "Empress" }] }),
      ];
      const stats = run({ trips: mixed, places, placeTypes });
      expect(stats.repeatPlaces).toBe(1);
      expect(stats.newPlaces).toBe(2);
    });

    it("names the most-returned-to place only when it was returned TO", () => {
      expect(run({ trips, places, placeTypes }).mostReturned).toEqual({
        name: "Claustral",
        trips: 2,
      });
      const once = [trip("2026-01-01", { places: [{ id: "p1", name: "Claustral" }] })];
      expect(run({ trips: once, places, placeTypes }).mostReturned).toBeNull();
    });
  });

  it("returns an honest empty shape with no trips at all", () => {
    const stats = run();
    expect(stats).toMatchObject({
      trips: 0,
      days: 0,
      places: 0,
      firstDate: null,
      longestRunDays: 0,
      mostReturned: null,
      tripFieldStats: [],
      placeFieldStats: [],
    });
  });
});
