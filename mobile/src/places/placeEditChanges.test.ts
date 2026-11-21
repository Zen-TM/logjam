import { SOURCES_FIELD_KEY } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { placeEditChanges, type PlaceFormValues } from "./placeEditChanges";
import type { MirrorPlace } from "../sync/mirrorStore";

const defs = [
  { key: "grade", label: "Grade", type: "integer" as const },
  { key: "permit", label: "Permit", type: "string" as const },
];

// What the sheet opened with.
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

// The place a sync pulled in while the sheet was open: another device changed
// the notes, the grade and the sources.
const pulled = {
  name: "Alpha Gorge",
  notes: "Newer note",
  fieldValues: {
    grade: 4,
    permit: "yes",
    [SOURCES_FIELD_KEY]: [["New", "https://new.example"]],
  },
} as unknown as MirrorPlace;

const parsed = {
  name: "Alpha Gorge",
  altNames: [],
  latitude: -33.74,
  longitude: 150.31,
  notes: "Old note",
};

function changes(
  form: Partial<PlaceFormValues>,
  over: Partial<typeof parsed> = {},
  patch: Record<string, unknown> = {},
) {
  return placeEditChanges({
    seeded,
    form: { ...seeded, ...form },
    parsed: { ...parsed, ...over },
    current: pulled,
    typeFieldDefs: defs,
    sourcesPatch: patch,
  });
}

describe("what an edit pushes", () => {
  // Mutation: compare the form with `current` instead of `seeded`, or build the
  // fields from every definition, and the stale notes, grade and sources the
  // sheet opened with are pushed over what the pull brought in.
  it("leaves out everything the user did not touch", () => {
    expect(changes({}, {})).toEqual({});
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

  // Mutation: drop `touched` for the whole form, and a cleared field is not
  // removed.
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
});
