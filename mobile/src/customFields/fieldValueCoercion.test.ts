import { describe, expect, it } from "vitest";
import type { TripLogCustomFieldDef } from "@logjam/shared";

import {
  coerceCustomFields,
  sameFieldValues,
  withoutClearedFields,
} from "./fieldValueCoercion";

// The place form MERGES this over the stored object (`setFieldValues`, where a
// null removes the key and an absent key is left alone), so "empty" has to
// arrive as null or a cleared field silently keeps its old value — the user
// deletes the text, saves, and nothing changes, with no error and no toast.
const permit: TripLogCustomFieldDef = { key: "permit", label: "Permit", type: "string" };
const capacity: TripLogCustomFieldDef = { key: "capacity", label: "Capacity", type: "integer" };
const isCave: TripLogCustomFieldDef = { key: "is_cave", label: "Is a cave?", type: "boolean" };

describe("coerceCustomFields", () => {
  it("writes what was typed", () => {
    expect(coerceCustomFields({ permit: "NP-1", capacity: "12" }, [permit, capacity])).toEqual({
      permit: "NP-1",
      capacity: 12,
    });
  });

  it("clears an emptied field with a null, rather than omitting it", () => {
    expect(coerceCustomFields({ permit: "   " }, [permit])).toEqual({ permit: null });
    expect(coerceCustomFields({}, [capacity])).toEqual({ capacity: null });
  });

  // An explicit No must survive (a filter for No reads it), and an unanswered
  // yes/no must NOT become one: writing false for an untouched toggle left a No
  // nobody gave on every trip the attribute was shown on.
  it("stores a yes/no as answered, and an unanswered one as cleared", () => {
    expect(coerceCustomFields({ is_cave: "false" }, [isCave])).toEqual({ is_cave: false });
    expect(coerceCustomFields({ is_cave: "true" }, [isCave])).toEqual({ is_cave: true });
    expect(coerceCustomFields({ is_cave: "" }, [isCave])).toEqual({ is_cave: null });
    expect(coerceCustomFields({}, [isCave])).toEqual({ is_cave: null });
  });

  it("touches only the definitions it was given", () => {
    expect(coerceCustomFields({ permit: "NP-1", capacity: "9" }, [permit])).toEqual({
      permit: "NP-1",
    });
  });
});

describe("withoutClearedFields", () => {
  // The trip form replaces the object wholesale, so there is nothing for a
  // null to clear — it would just store a filled-in blank.
  it("drops the nulls a merging caller needs", () => {
    expect(withoutClearedFields({ permit: null, capacity: 12, is_cave: false })).toEqual({
      capacity: 12,
      is_cave: false,
    });
  });
});

describe("sameFieldValues", () => {
  // Postgres jsonb returns keys shortest-first; a form builds them in the
  // definitions' order. Text comparison called that a change on every save.
  it("ignores key order", () => {
    expect(
      sameFieldValues(
        { water_level: "low", rope_length_m: 50, wetsuit: true },
        { wetsuit: true, water_level: "low", rope_length_m: 50 },
      ),
    ).toBe(true);
  });

  it("sees a changed, added or removed value", () => {
    expect(sameFieldValues({ wetsuit: true }, { wetsuit: false })).toBe(false);
    expect(sameFieldValues({ wetsuit: true }, { wetsuit: true, permit: "NP-1" })).toBe(false);
    expect(sameFieldValues({ wetsuit: true, permit: "NP-1" }, { wetsuit: true })).toBe(false);
    expect(sameFieldValues({ permit: undefined }, { other: undefined })).toBe(false);
  });
});
