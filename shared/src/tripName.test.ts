import { describe, expect, it } from "vitest";
import {
  CANYONING_TRIP_TYPE,
  enforceCanyoningTag,
  formatTripCanyonNames,
  MAX_TRIP_TYPES_PER_TRIP,
  TRIP_TYPE_SUGGESTIONS,
} from "./tripName.js";

describe("formatTripCanyonNames", () => {
  it("returns null for an empty list", () => {
    expect(formatTripCanyonNames([])).toBeNull();
  });

  it("returns the single name unchanged", () => {
    expect(formatTripCanyonNames(["Claustral"])).toBe("Claustral");
  });

  it("joins two names with 'and'", () => {
    expect(formatTripCanyonNames(["Claustral", "Ranon"])).toBe(
      "Claustral and Ranon",
    );
  });

  it("comma-separates with 'and' before the last of three", () => {
    expect(
      formatTripCanyonNames(["Claustral", "Ranon", "Whungee Whengee"]),
    ).toBe("Claustral, Ranon and Whungee Whengee");
  });

  it("preserves order for four names", () => {
    expect(formatTripCanyonNames(["A", "B", "C", "D"])).toBe("A, B, C and D");
  });
});

describe("TRIP_TYPE_SUGGESTIONS", () => {
  it("includes the core seed types", () => {
    expect(TRIP_TYPE_SUGGESTIONS).toContain("canyoning");
    expect(TRIP_TYPE_SUGGESTIONS).toContain("bushwalking");
  });
});

describe("enforceCanyoningTag", () => {
  // Ten distinct user types — the cap, with no canyoning among them.
  const atCap = Array.from({ length: MAX_TRIP_TYPES_PER_TRIP }, (_, i) => `t${i}`);

  it("leaves a canyon-less trip untouched", () => {
    expect(enforceCanyoningTag([], false)).toEqual([]);
    expect(enforceCanyoningTag(["bushwalking"], false)).toEqual(["bushwalking"]);
  });

  it("adds the tag to a canyon-linked trip with no types", () => {
    expect(enforceCanyoningTag([], true)).toEqual([CANYONING_TRIP_TYPE]);
  });

  it("appends the tag after the user's own types, preserving their order", () => {
    expect(enforceCanyoningTag(["bushwalking", "packrafting"], true)).toEqual([
      "bushwalking",
      "packrafting",
      CANYONING_TRIP_TYPE,
    ]);
  });

  it("does not duplicate an already-present tag", () => {
    expect(enforceCanyoningTag([CANYONING_TRIP_TYPE], true)).toEqual([
      CANYONING_TRIP_TYPE,
    ]);
  });

  it("treats a case variant as present and leaves the user's casing alone", () => {
    // Adding "canyoning" onto ["Canyoning"] would be a case-insensitive
    // duplicate, which parseTripTypes rejects with a 400.
    expect(enforceCanyoningTag(["Canyoning"], true)).toEqual(["Canyoning"]);
    expect(enforceCanyoningTag(["CANYONING", "bushwalking"], true)).toEqual([
      "CANYONING",
      "bushwalking",
    ]);
  });

  it("skips the tag at the cap rather than exceeding it", () => {
    const result = enforceCanyoningTag(atCap, true);
    expect(result).toEqual(atCap);
    expect(result).toHaveLength(MAX_TRIP_TYPES_PER_TRIP);
    expect(result).not.toContain(CANYONING_TRIP_TYPE);
  });

  it("still adds the tag one below the cap, landing exactly on it", () => {
    const result = enforceCanyoningTag(atCap.slice(0, -1), true);
    expect(result).toHaveLength(MAX_TRIP_TYPES_PER_TRIP);
    expect(result).toContain(CANYONING_TRIP_TYPE);
  });

  it("never force-removes: a canyon-less trip keeps an existing tag", () => {
    expect(enforceCanyoningTag([CANYONING_TRIP_TYPE], false)).toEqual([
      CANYONING_TRIP_TYPE,
    ]);
    expect(enforceCanyoningTag(["Canyoning", "bushwalking"], false)).toEqual([
      "Canyoning",
      "bushwalking",
    ]);
  });

  it("returns the same reference when it adds nothing", () => {
    // Callers rely on this to skip a redundant write.
    const types = [CANYONING_TRIP_TYPE];
    expect(enforceCanyoningTag(types, true)).toBe(types);
    expect(enforceCanyoningTag(atCap, true)).toBe(atCap);
  });

  it("is idempotent — re-enforcing a stored list is a no-op", () => {
    const once = enforceCanyoningTag(["bushwalking"], true);
    expect(enforceCanyoningTag(once, true)).toEqual(once);
  });

  it("does not mutate its input", () => {
    const types = ["bushwalking"];
    enforceCanyoningTag(types, true);
    expect(types).toEqual(["bushwalking"]);
  });
});

// The round-trips the fix exists to protect: a stored 10-type canyon-linked
// trip must stay editable. The dialog reopens on the stored array, re-enforces,
// and PATCHes the result back — that result must never exceed the cap, or
// parseTripTypes 400s and the trip is wedged.
describe("enforceCanyoningTag — dialog round-trips at the cap", () => {
  const nineUserTypes = Array.from({ length: 9 }, (_, i) => `t${i}`);

  it("10 types + link → reopen → save stays within the cap", () => {
    // Stored: 9 user types + the forced tag = exactly the cap.
    const stored = enforceCanyoningTag(nineUserTypes, true);
    expect(stored).toHaveLength(MAX_TRIP_TYPES_PER_TRIP);

    // Reopen (dialog enforces on the stored array) → save (API re-enforces).
    const reopened = enforceCanyoningTag(stored, true);
    const saved = enforceCanyoningTag(reopened, true);
    expect(saved).toHaveLength(MAX_TRIP_TYPES_PER_TRIP);
    expect(saved).toEqual(stored);
  });

  it("10 user types (tag skipped) + link → reopen → save stays within the cap", () => {
    const atCap = Array.from({ length: MAX_TRIP_TYPES_PER_TRIP }, (_, i) => `t${i}`);
    const stored = enforceCanyoningTag(atCap, true);
    const saved = enforceCanyoningTag(enforceCanyoningTag(stored, true), true);
    expect(saved).toHaveLength(MAX_TRIP_TYPES_PER_TRIP);
  });

  it("10 types + link → unlink → reopen → save stays within the cap", () => {
    const stored = enforceCanyoningTag(nineUserTypes, true);
    expect(stored).toHaveLength(MAX_TRIP_TYPES_PER_TRIP);

    // Unlink: never force-remove, so the tag survives and the list stays at 10.
    const unlinked = enforceCanyoningTag(stored, false);
    expect(unlinked).toEqual(stored);

    // Reopen + save on the now canyon-less trip.
    const saved = enforceCanyoningTag(enforceCanyoningTag(unlinked, false), false);
    expect(saved).toHaveLength(MAX_TRIP_TYPES_PER_TRIP);
    expect(saved).toContain(CANYONING_TRIP_TYPE);
  });

  it("10 user types + link → unlink → reopen → save stays within the cap", () => {
    const atCap = Array.from({ length: MAX_TRIP_TYPES_PER_TRIP }, (_, i) => `t${i}`);
    const stored = enforceCanyoningTag(atCap, true);
    const unlinked = enforceCanyoningTag(stored, false);
    const saved = enforceCanyoningTag(enforceCanyoningTag(unlinked, false), false);
    expect(saved).toHaveLength(MAX_TRIP_TYPES_PER_TRIP);
  });
});
