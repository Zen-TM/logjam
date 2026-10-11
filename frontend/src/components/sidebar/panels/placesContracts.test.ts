// Logjam Web implements EXACTLY the Places filter sheet's contract: every
// section `@logjam/shared` gives this client, and none it does not.
//
// The map is a `Record<…>` over the contract's keys, so `tsc` already refuses
// a missing or an extra key. This assertion is the same rule for a reader who
// runs only the tests. To see it go red: add `{ key: "weather" }` to
// `PLACES_FILTER_SHEET.sections` (a section this client does not draw), or
// delete `dates` from it (a section this client draws unasked).
//
// The other Places maps (the list's `sections`, the add menu's entries, each
// verb's runner) close over their component's state, so they cannot be
// imported; the same `Record<…>` typing is their check, in `tsc -b`.
import { describe, expect, it } from "vitest";
import { contractSectionKeys, PLACES_FILTER_SHEET } from "@logjam/shared";
import { FILTER_SHEET_SECTIONS } from "./PlaceFilterSheet";

describe("Logjam Web draws exactly what the Places contracts name", () => {
  it("the filter sheet's sections", () => {
    expect(Object.keys(FILTER_SHEET_SECTIONS).sort()).toEqual(
      [...contractSectionKeys(PLACES_FILTER_SHEET, "web")].sort(),
    );
  });
});
