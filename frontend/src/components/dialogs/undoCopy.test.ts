import { describe, expect, it } from "vitest";
import { undoConfirmMessage, undoToastMessage } from "./undoCopy";

const none = {
  deletedPlaces: 0,
  deletedTrips: 0,
  restoredPlaces: 0,
  restoredTrips: 0,
  keptFields: 0,
};

describe("undoToastMessage", () => {
  it("says only that the import is undone when nothing changed", () => {
    expect(undoToastMessage(none)).toBe("Import undone.");
  });

  // Mutation that turns it red: dropping either list, or joining them with
  // "and" so removed and restored run together.
  it("names what was removed and what was restored", () => {
    expect(
      undoToastMessage({
        ...none,
        deletedPlaces: 2,
        deletedTrips: 1,
        restoredPlaces: 1,
      }),
    ).toBe("Import undone — 2 places and 1 trip removed, 1 place restored.");
  });

  // Mutation that turns it red: swapping the singular and plural sentences.
  it("counts what it kept, singular and plural", () => {
    expect(
      undoToastMessage({ ...none, restoredPlaces: 1, keptFields: 1 }),
    ).toBe(
      "Import undone — 1 place restored. 1 field you changed since stays as you left it.",
    );
    expect(undoToastMessage({ ...none, keptFields: 3 })).toBe(
      "Import undone. 3 fields you changed since stay as you left them.",
    );
  });

  // Mutation that turns it red: testing keptFields === 0, which reads
  // "undefined fields" against an API from before Undo restored.
  it("reads a count an older API leaves out as zero", () => {
    expect(
      undoToastMessage({ deletedPlaces: 1, deletedTrips: 0 } as never),
    ).toBe("Import undone — 1 place removed.");
  });
});

describe("undoConfirmMessage", () => {
  const now = new Date("2026-10-18T12:00:00Z");

  // Mutation that turns it red: promising a restore once restorableUntil has
  // passed, or when the import changed nothing it can put back.
  it("promises a restore only before the deadline", () => {
    expect(undoConfirmMessage("2026-10-19T11:00:00Z", now)).toContain(
      "go back to the values they had before it",
    );
    const late = undoConfirmMessage("2026-10-18T11:00:00Z", now);
    expect(late).toContain("keep its values");
    expect(late).not.toContain("go back");
    expect(undoConfirmMessage(null, now)).toBe(
      "Every place and trip this import created is deleted. This can't be undone.",
    );
  });
});
