import { describe, expect, it } from "vitest";
import { itemFieldDefs, itemPatch, itemWords } from "./planItemEdit.js";
import { SYSTEM_PLACE_TYPE_IDS } from "./placeTypes.js";
import { NSW_REGION } from "./regions.js";
import { SIM_REGIONS } from "./simRegions.js";
import type { TripPlanItem } from "./tripPlans.js";

const place = {
  kind: "place",
  id: "p1",
  name: "Wollangambe",
  notes: null,
  altNames: [],
  latitude: -33.5,
  longitude: 150.25,
  elevation: null,
  placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker,
  fieldValues: {},
} as unknown as TripPlanItem;
const file = {
  kind: "media",
  id: "m1",
  item: { displayName: null, filename: "day1.gpx" },
} as TripPlanItem;

describe("itemPatch", () => {
  // Mutation: send every attribute, or write the form's "" as the stored
  // value, and an untouched field 409s on another member's edit of it.
  it("sends a place's details field by field", () => {
    const full = {
      ...place,
      altNames: ["The Wolly"],
      placeTypeId: SYSTEM_PLACE_TYPE_IDS.canyon,
      fieldValues: { v_grade: 3 },
    } as unknown as TripPlanItem;
    const words = itemWords(full);
    expect(itemPatch(full, words)).toBeNull();
    expect(
      itemPatch(full, {
        ...words,
        altNames: "The Wolly, Wolly",
        latitude: "-33.6",
        elevation: "812",
        "attr:v_grade": "4",
        "attr:a_grade": "2",
      }),
    ).toEqual({
      altNames: { from: ["The Wolly"], to: ["The Wolly", "Wolly"] },
      position: {
        from: { latitude: -33.5, longitude: 150.25 },
        to: { latitude: -33.6, longitude: 150.25 },
      },
      elevation: { from: null, to: 812 },
      fieldValues: {
        v_grade: { from: 3, to: 4 },
        a_grade: { from: null, to: 2 },
      },
    });
    expect(itemPatch(full, { ...words, "attr:v_grade": "" })).toEqual({
      fieldValues: { v_grade: { from: 3, to: null } },
    });
  });

  // Mutation: drop the `!== was` checks, and an unchanged note is sent.
  it("sends only the changed words, a file's blank name as none", () => {
    expect(itemPatch(place, itemWords(place))).toBeNull();
    expect(
      itemPatch(place, { ...itemWords(place), notes: "Exit left." }),
    ).toEqual({ notes: { from: null, to: "Exit left." } });
    expect(itemPatch(file, { name: "Day 1", notes: "" })).toEqual({
      displayName: { from: null, to: "Day 1" },
    });
  });

  // Mutation: send the form's blanked words as `from`.
  it("compares against what is stored, a blank included", () => {
    expect(
      itemPatch({ ...place, notes: "" } as TripPlanItem, {
        ...itemWords(place),
        notes: "Exit left.",
      }),
    ).toEqual({ notes: { from: "", to: "Exit left." } });
  });
});

describe("the attributes a plan place's edit form offers", () => {
  const canyonAt = (
    latitude: number,
    longitude: number,
    fieldValues: Record<string, unknown> = {},
  ) =>
    ({
      ...place,
      latitude,
      longitude,
      placeTypeId: SYSTEM_PLACE_TYPE_IDS.canyon,
      fieldValues,
    }) as unknown as Extract<TripPlanItem, { kind: "place" }>;
  const regions = [NSW_REGION, ...SIM_REGIONS];
  const keys = (item: ReturnType<typeof canyonAt>) =>
    itemFieldDefs(item, regions).map((def) => def.key);
  const FRENCH = ["v_grade", "a_grade", "commitment"];
  const ACA = ["aca_technical", "aca_water", "aca_time", "aca_risk"];
  const NON_GRADE = ["quality", "hours", "num_abseils", "longest_abseil"];

  // Mutation: return every definition of the type, as before.
  it("are the French grades in NSW and the ACA ones in the simulated Utah", () => {
    expect(keys(canyonAt(-33.5, 150.25))).toEqual([...FRENCH, ...NON_GRADE]);
    expect(keys(canyonAt(38.27, -110.8))).toEqual([...NON_GRADE, ...ACA]);
  });

  // Mutation: drop `place.fieldValues` from the `gradeFieldsAt` call.
  it("keep a grade field the place already holds, in either system", () => {
    expect(keys(canyonAt(-33.5, 150.25, { aca_water: 5 }))).toEqual([
      ...FRENCH,
      ...NON_GRADE,
      "aca_water",
    ]);
  });

  // Mutation: loop over every canyon definition in `itemWords` or in
  // `itemPatch`, instead of `itemFieldDefs`.
  it("are the words the form opens on, and what a patch compares", () => {
    const item = canyonAt(-33.5, 150.25, { v_grade: 3 });
    const words = itemWords(item as TripPlanItem);
    expect(Object.keys(words).filter((key) => key.startsWith("attr:"))).toEqual(
      [...FRENCH, ...NON_GRADE].map((key) => `attr:${key}`),
    );
    expect(itemPatch(item as TripPlanItem, words)).toBeNull();
    // A word for a field the form did not offer is not a change.
    expect(
      itemPatch(item as TripPlanItem, { ...words, "attr:aca_water": "5" }),
    ).toBeNull();
  });
});
