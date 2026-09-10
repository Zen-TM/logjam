import { describe, expect, it } from "vitest";
import type { TripLogCustomFieldDef } from "@logjam/shared";

import { coerceCustomFields, withoutClearedFields } from "./fieldValueCoercion";

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

  // Skipping `false` left the phone unable to answer "no" at all, and made the
  // stored shape disagree with the web's (an unchecked box IS an explicit No).
  // A filter reads the stored value, so a detail page saying "Is a cave? · No"
  // was invisible to a filter for No.
  it("stores a boolean either way, false included", () => {
    expect(coerceCustomFields({ is_cave: "false" }, [isCave])).toEqual({ is_cave: false });
    expect(coerceCustomFields({ is_cave: "true" }, [isCave])).toEqual({ is_cave: true });
    expect(coerceCustomFields({}, [isCave])).toEqual({ is_cave: false });
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
