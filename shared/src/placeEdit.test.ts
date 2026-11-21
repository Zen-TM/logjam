import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { placeEditChanges, type PlaceFormValues } from "./placeEdit.js";
import { SOURCES_FIELD_KEY } from "./placeTypes.js";

const defs = [
  { key: "grade", label: "Grade", type: "integer" as const },
  { key: "permit", label: "Permit", type: "string" as const },
];

// What the form opened with.
const seeded: PlaceFormValues = {
  name: "Alpha Gorge",
  altNames: "",
  latitude: "-33.74",
  longitude: "150.31",
  notes: "Old note",
  placeTypeId: "type-canyon",
  fieldValues: { grade: "3", permit: "yes" },
  sources: [{ label: "Old", url: "https://old.example" }],
};

// The place a sync pulled in while the form was open: another device moved it
// and changed the grade and the sources.
const pulled = {
  latitude: -33.75,
  longitude: 150.32,
  fieldValues: {
    grade: 4,
    permit: "yes",
    [SOURCES_FIELD_KEY]: [["New", "https://new.example"]],
  },
};

const parsed = {
  name: "Alpha Gorge",
  altNames: [],
  latitude: pulled.latitude,
  longitude: pulled.longitude,
  notes: "Old note",
};

function changes(
  form: Partial<PlaceFormValues>,
  over: Partial<typeof parsed> = {},
  patch: Record<string, unknown> = {},
  touched = { latitude: false, longitude: false },
) {
  return placeEditChanges({
    seeded,
    form: { ...seeded, ...form },
    parsed: { ...parsed, ...over },
    touched,
    current: pulled,
    typeFieldDefs: defs,
    sourcesPatch: patch,
  });
}

describe("what an edit of a place sends", () => {
  // Mutation: compare the form with `current` instead of `seeded`, or build the
  // attributes from every definition, and the stale notes, grade and sources
  // the form opened with are sent over what the pull brought in.
  it("leaves out everything the user did not touch", () => {
    expect(changes({})).toEqual({});
    expect(
      changes({ name: "Alpha Gorge 2" }, { name: "Alpha Gorge 2" }),
    ).toEqual({ name: "Alpha Gorge 2" });
  });

  // Mutation: replace `current.fieldValues` with the seeded values as the base
  // of the merge, and the pulled sources and grade are lost from the payload.
  it("builds a changed attribute over the values as they are now", () => {
    expect(
      changes({ fieldValues: { grade: "3", permit: "no" } }).fieldValues,
    ).toEqual({
      grade: 4,
      permit: "no",
      [SOURCES_FIELD_KEY]: [["New", "https://new.example"]],
    });
  });

  // Mutation: filter the definitions on a truthy `touched[def.key]` instead of
  // `def.key in touched`, and a cleared attribute is not removed.
  it("removes an attribute the user cleared", () => {
    expect(
      changes({ fieldValues: { grade: "", permit: "yes" } }).fieldValues,
    ).toEqual({
      permit: "yes",
      [SOURCES_FIELD_KEY]: [["New", "https://new.example"]],
    });
  });

  // Mutation: leave the sources patch out of the merge.
  it("merges the sources the user changed", () => {
    const edited = [["Mine", "https://mine.example"]];
    expect(
      changes({}, {}, { [SOURCES_FIELD_KEY]: edited }).fieldValues,
    ).toMatchObject({ [SOURCES_FIELD_KEY]: edited, grade: 4 });
  });

  // Mutation: compare a coordinate's text with the seeded text, and typing the
  // seeded value back after a pull moved the place is dropped; or send it
  // whether or not the user typed, and a pull is overwritten.
  it("sends a typed coordinate that differs from the place now, and only that", () => {
    const typedBack = { latitude: -33.74, longitude: 150.31 };
    expect(
      changes({}, typedBack, {}, { latitude: true, longitude: true }),
    ).toEqual(typedBack);
    expect(changes({}, typedBack)).toEqual({});
    // Typed, but already what the place holds.
    expect(
      changes(
        {},
        { latitude: pulled.latitude },
        {},
        { latitude: true, longitude: false },
      ),
    ).toEqual({});
    // Not a number: nothing to send.
    expect(
      changes({}, { latitude: null }, {}, { latitude: true, longitude: false }),
    ).toEqual({});
  });
});

describe("both clients send an edit through the shared diff", () => {
  const repo = join(import.meta.dirname, "..", "..");

  // Mutation: build the update in either client again, and the two diverge on
  // what an untouched field does.
  it.each([
    ["Logjam Web", "frontend/src/components/dialogs/PlaceDialog.tsx"],
    ["Logjam GPS", "mobile/src/places/PlaceEditSheet.tsx"],
  ] as const)("%s calls placeEditChanges", (_name, file) => {
    expect(readFileSync(join(repo, file), "utf8")).toContain(
      "placeEditChanges({",
    );
  });
});
