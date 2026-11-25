import { describe, expect, it } from "vitest";
import {
  ITEM_ATTR,
  itemFieldDefs,
  itemPatch,
  itemWords,
  newPlaceFromWords,
  newPlaceWords,
  retypePlaceWords,
} from "./planItemEdit.js";
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

describe("a place made in a plan", () => {
  const canyon = SYSTEM_PLACE_TYPE_IDS.canyon;

  // Mutation: build the body without trimming, or send a blank attribute.
  it("sends the form's words as the place's fields", () => {
    const words = {
      ...newPlaceWords(canyon, { latitude: -33.5, longitude: 150.25 }),
      name: "  Test drop ",
      altNames: "a, , b",
      elevation: "812",
      notes: "  ",
      "attr:v_grade": "3",
    };
    expect(newPlaceFromWords(canyon, words)).toEqual({
      placeTypeId: canyon,
      name: "Test drop",
      altNames: ["a", "b"],
      latitude: -33.5,
      longitude: 150.25,
      elevation: 812,
      notes: null,
      fieldValues: { v_grade: 3 },
    });
  });

  // Mutation: build the blank from another type's attributes.
  it("starts with the attributes of its type, and none for a marker", () => {
    const keys = (id: string) =>
      Object.keys(newPlaceWords(id)).filter((key) => key.startsWith("attr:"));
    expect(keys(canyon)).toContain("attr:v_grade");
    expect(keys(SYSTEM_PLACE_TYPE_IDS.marker)).toEqual([]);
  });

  // The same words as an edit would start from: a new place saved untouched
  // beside an existing one would show no change.
  it("is the shape an existing place's edit form starts from", () => {
    expect(
      Object.keys(newPlaceWords(SYSTEM_PLACE_TYPE_IDS.marker)).sort(),
    ).toEqual(Object.keys(itemWords(place)).sort());
  });
});

describe("retypePlaceWords", () => {
  const canyon = SYSTEM_PLACE_TYPE_IDS.canyon;
  const at = { latitude: -33.5, longitude: 150.4 };

  // Mutation: drop `elevation` from the kept fields, or keep every key, and a
  // retype loses a typed elevation or sends a Canyon's attribute for a Marker.
  it("keeps the typed place details and drops the old type's attributes", () => {
    const defs = itemFieldDefs({ placeTypeId: canyon });
    expect(defs.length).toBeGreaterThan(0);
    const attr = ITEM_ATTR + defs[0].key;
    const was = {
      ...newPlaceWords(canyon, at),
      name: "Water drop",
      notes: "Fills in March",
      altNames: "The drop",
      elevation: "412",
      [attr]: "3",
    };
    const next = retypePlaceWords(was, SYSTEM_PLACE_TYPE_IDS.marker);
    expect(next).toEqual({
      name: "Water drop",
      notes: "Fills in March",
      altNames: "The drop",
      elevation: "412",
      latitude: String(at.latitude),
      longitude: String(at.longitude),
    });
    expect(next[attr]).toBeUndefined();
  });
});
