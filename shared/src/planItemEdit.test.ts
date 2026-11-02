import { describe, expect, it } from "vitest";
import { itemPatch, itemWords } from "./planItemEdit.js";
import { SYSTEM_PLACE_TYPE_IDS } from "./placeTypes.js";
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
