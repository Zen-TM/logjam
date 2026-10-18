import { describe, expect, it, vi } from "vitest";

const deleteMany = vi.fn(async () => ({ count: 2 }));
vi.mock("../services/prisma", () => ({
  default: { importSnapshot: { deleteMany } },
}));

const {
  combineChanges,
  diffFields,
  restoreFields,
  sweepExpiredImportSnapshots,
} = await import("./importSnapshot");

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

  // Mutation that turns it red: treating a missing map key as different from
  // a null one, or returning an empty change instead of null.
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

  // Mutation that turns it red: keeping a fold whose before equals its after,
  // so Undo would write a no-op and count the row as restored.
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

  // Mutation that turns it red: restoring a map field wholesale from before
  // (drops v_grade), or writing time: null instead of removing the key.
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

describe("retention", () => {
  const now = new Date("2026-10-18T12:00:00.000Z");

  // Mutation that turns it red: changing SNAPSHOT_TTL_MS from 24 h (Logjam
  // Web's Undo confirm says "for a day"), or sweeping by anything but
  // createdAt older than it.
  it("sweeps snapshots written more than a day ago", async () => {
    expect(await sweepExpiredImportSnapshots(now)).toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-10-17T12:00:00.000Z") } },
    });
  });
});
