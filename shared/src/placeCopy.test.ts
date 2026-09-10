import { describe, expect, it } from "vitest";

import {
  asForeignFields,
  matchPlaceTypeByName,
  mergeForeignFields,
  reconcileCopiedFieldValues,
} from "./placeCopy.js";
import { SYSTEM_PLACE_TYPE_IDS } from "./placeTypes.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

const def = (
  key: string,
  type: TripLogCustomFieldDef["type"],
  extra: Partial<TripLogCustomFieldDef> = {},
): TripLogCustomFieldDef => ({ key, label: key, type, ...extra });

describe("reconcileCopiedFieldValues", () => {
  it("keeps a value the recipient has the same-typed definition for", () => {
    const { fieldValues, foreignFields } = reconcileCopiedFieldValues({
      fieldValues: { v_grade: 3, water_temp: 12 },
      senderDefs: [def("v_grade", "integer"), def("water_temp", "float")],
      recipientDefs: [def("v_grade", "integer"), def("water_temp", "float")],
    });
    expect(fieldValues).toEqual({ v_grade: 3, water_temp: 12 });
    expect(foreignFields).toEqual([]);
  });

  it("parks a value the recipient has no definition for, described by the sender's", () => {
    const { fieldValues, foreignFields } = reconcileCopiedFieldValues({
      fieldValues: { permit_no: "NP-4471" },
      senderDefs: [def("permit_no", "string", { label: "Permit number" })],
      recipientDefs: [],
    });
    expect(fieldValues).toEqual({});
    expect(foreignFields).toEqual([
      { key: "permit_no", label: "Permit number", type: "string", value: "NP-4471" },
    ]);
  });

  it("carries the sender's bounds so an adopted field keeps them", () => {
    const { foreignFields } = reconcileCopiedFieldValues({
      fieldValues: { party: 4 },
      senderDefs: [def("party", "integer", { label: "Party size", min: 1, max: 12 })],
      recipientDefs: [],
    });
    expect(foreignFields[0]).toEqual({
      key: "party",
      label: "Party size",
      type: "integer",
      min: 1,
      max: 12,
      value: 4,
    });
  });

  // THE TYPE CHECK IS NOT FUSSINESS. A key match alone drops the sender's "3"
  // into the recipient's integer field, where every numeric filter and every
  // bound check then reads a string: invisible to the filter that should find
  // it, and unfixable through a form that will not accept it.
  it("parks a same-key value whose TYPE differs, rather than mis-filing it", () => {
    const { fieldValues, foreignFields } = reconcileCopiedFieldValues({
      fieldValues: { quality: "excellent" },
      senderDefs: [def("quality", "string")],
      recipientDefs: [def("quality", "integer")],
    });
    expect(fieldValues).toEqual({});
    expect(foreignFields).toEqual([
      { key: "quality", label: "quality", type: "string", value: "excellent" },
    ]);
  });

  // Provenance, not a user field: no definition describes `_sources`, and a
  // copy that dropped it would lose where the place came from.
  it("carries internal keys across untouched", () => {
    const { fieldValues, foreignFields } = reconcileCopiedFieldValues({
      fieldValues: {
        _sources: [["Wiki", "https://example.test/a"]],
        // Not a key the code knows by name: the filter is the `_` prefix.
        _legacy: { note: "kept" },
      },
      senderDefs: [],
      recipientDefs: [],
    });
    expect(fieldValues).toEqual({
      _sources: [["Wiki", "https://example.test/a"]],
      _legacy: { note: "kept" },
    });
    expect(foreignFields).toEqual([]);
  });

  it("drops a null rather than parking an empty foreign field", () => {
    const { fieldValues, foreignFields } = reconcileCopiedFieldValues({
      fieldValues: { permit_no: null, hours: 5 },
      senderDefs: [def("hours", "float")],
      recipientDefs: [def("hours", "float")],
    });
    expect(fieldValues).toEqual({ hours: 5 });
    expect(foreignFields).toEqual([]);
  });

  it("keeps a value neither side defines, keyed by itself", () => {
    // The definition was deleted after the value was stored. Dropping it would
    // be deleting data because the schema drifted.
    const { foreignFields } = reconcileCopiedFieldValues({
      fieldValues: { orphan: 7 },
      senderDefs: [],
      recipientDefs: [],
    });
    expect(foreignFields).toEqual([
      { key: "orphan", label: "orphan", type: "string", value: 7 },
    ]);
  });
});

describe("matchPlaceTypeByName", () => {
  const systemCampsite = {
    id: SYSTEM_PLACE_TYPE_IDS.campsite,
    name: "Campsite",
    ownerId: null,
  };
  const userCampsite = { id: "user-1", name: "campsite", ownerId: "bob" };

  // §2.6 rule 1, and the ordering is the point: branching on the SENDER's type
  // kind would create a second, user-owned "Campsite" beside the system one —
  // two Campsite tabs, and the zero-places self-heal never fires because the
  // copy just put a place in the new one.
  it("prefers the system type when both share a name", () => {
    expect(matchPlaceTypeByName("Campsite", [userCampsite, systemCampsite])?.id).toBe(
      systemCampsite.id,
    );
  });

  it("matches case-insensitively — one category to a person", () => {
    expect(matchPlaceTypeByName("CAMPSITE", [systemCampsite])?.id).toBe(
      systemCampsite.id,
    );
    expect(matchPlaceTypeByName("  campsite  ", [systemCampsite])?.id).toBe(
      systemCampsite.id,
    );
  });

  it("falls back to a user type when no system type matches", () => {
    expect(matchPlaceTypeByName("Campsite", [userCampsite])?.id).toBe("user-1");
  });

  it("is null when nothing matches, which the caller reads as 'create one'", () => {
    expect(matchPlaceTypeByName("Cave", [systemCampsite, userCampsite])).toBeNull();
    expect(matchPlaceTypeByName("   ", [systemCampsite])).toBeNull();
  });
});

describe("mergeForeignFields", () => {
  const parked = (key: string, value: unknown) => ({
    key,
    label: key,
    type: "string",
    value,
  });

  it("appends, because a type change keeps the owner's earlier strandings", () => {
    expect(
      mergeForeignFields([parked("a", 1)], [parked("b", 2)]).map((f) => f.key),
    ).toEqual(["a", "b"]);
  });

  it("keys the result, so retyping twice leaves ONE entry per key", () => {
    const merged = mergeForeignFields([parked("a", 1)], [parked("a", 2)]);
    expect(merged).toHaveLength(1);
    // Newest wins: two rows for one key would offer "Add to my type" twice and
    // only one of them would be right.
    expect(merged[0].value).toBe(2);
  });

  it("treats a null existing list as empty", () => {
    expect(mergeForeignFields(null, [parked("a", 1)])).toHaveLength(1);
  });
});

describe("asForeignFields", () => {
  it("skips a malformed entry rather than throwing at a detail screen", () => {
    expect(
      asForeignFields([
        { key: "a", label: "A", type: "string", value: 1 },
        { key: "b" },
        null,
        "nope",
      ]),
    ).toEqual([{ key: "a", label: "A", type: "string", value: 1 }]);
  });

  it("is empty for anything that is not a list", () => {
    expect(asForeignFields(null)).toEqual([]);
    expect(asForeignFields({ key: "a" })).toEqual([]);
  });
});
