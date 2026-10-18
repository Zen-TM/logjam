import { describe, expect, it, vi } from "vitest";

vi.mock("../services/prisma", () => ({ default: {} }));

const { combineChanges, diffFields, restoreFields } = await import(
  "./importSnapshot"
);

const stored = {
  notes: null,
  altNames: ["Upper"],
  fieldValues: { v_grade: 3, aca: "a" },
};

describe("diffFields", () => {
  // Mutation that turns it red: recording every field the import wrote, or
  // comparing a map field as a whole.
  it("keeps only the fields, and the map keys, that changed", () => {
    expect(
      diffFields(stored, {
        notes: "from file",
        altNames: ["Upper"],
        fieldValues: { v_grade: 3, aca: "b", time: 4 },
      }),
    ).toEqual({
      before: { notes: null, fieldValues: { aca: "a", time: null } },
      after: { notes: "from file", fieldValues: { aca: "b", time: 4 } },
    });
  });

  it("is null when nothing changed, a missing key being a null one", () => {
    expect(
      diffFields(stored, {
        ...stored,
        fieldValues: { ...stored.fieldValues, x: null },
      }),
    ).toBeNull();
  });
});

describe("combineChanges", () => {
  // Mutation that turns it red: letting the later request's `before` win.
  it("keeps the first before and the last after", () => {
    const earlier = { before: { notes: "a" }, after: { notes: "b" } };
    const later = {
      before: { notes: "b", fieldValues: { aca: "a" } },
      after: { notes: "c", fieldValues: { aca: "z" } },
    };
    expect(combineChanges(earlier, later)).toEqual({
      before: { notes: "a", fieldValues: { aca: "a" } },
      after: { notes: "c", fieldValues: { aca: "z" } },
    });
  });

  it("is null when the later change undoes the earlier", () => {
    expect(
      combineChanges(
        { before: { notes: "a" }, after: { notes: "b" } },
        { before: { notes: "b" }, after: { notes: "a" } },
      ),
    ).toBeNull();
  });
});

describe("restoreFields", () => {
  const change = {
    before: { notes: null, fieldValues: { aca: "a", time: null } },
    after: { notes: "from file", fieldValues: { aca: "b", time: 4 } },
  };

  it("puts back every field still as the import left it", () => {
    expect(
      restoreFields(
        { notes: "from file", fieldValues: { v_grade: 3, aca: "b", time: 4 } },
        change,
      ),
    ).toEqual({
      restore: { notes: null, fieldValues: { v_grade: 3, aca: "a" } },
      kept: 0,
    });
  });

  // Mutation that turns it red: restoring without comparing the current value
  // to what the import wrote, or counting a field already back as kept.
  it("keeps and counts a field changed since, key by key", () => {
    expect(
      restoreFields(
        { notes: "mine", fieldValues: { v_grade: 3, aca: "b", time: 6 } },
        change,
      ),
    ).toEqual({
      restore: { fieldValues: { v_grade: 3, aca: "a", time: 6 } },
      kept: 2,
    });
    expect(
      restoreFields({ notes: null, fieldValues: { aca: "a" } }, change),
    ).toEqual({ restore: {}, kept: 0 });
  });
});
