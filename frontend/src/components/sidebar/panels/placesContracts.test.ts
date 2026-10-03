// Logjam Web implements EXACTLY the Places contracts: every section, add entry
// and verb `@logjam/shared` gives this client, and none it does not.
//
// The maps are `Record<…>`s over the contract's keys, so `tsc` already refuses
// a missing or an extra key. These assertions are the same rule for a reader
// who runs only the tests. To see one go red: add `{ key: "weather" }` to
// `PLACES_FILTER_SHEET.sections` (a section this client does not draw), or
// delete `dates` from it (a section this client draws unasked).
//
// The list page's own map (`sections` in PlacesPanel) closes over the page's
// state, so it cannot be imported; the compiler is its check.
import { describe, expect, it } from "vitest";
import {
  contractSectionKeys,
  PLACES_ADD,
  PLACES_FILTER_SHEET,
  placeVerbIds,
} from "@logjam/shared";
import { FILTER_SHEET_SECTIONS } from "./PlaceFilterSheet";
import { ADD_ENTRY_ICON, PLACE_VERB_ICON } from "./placeVerbMenu";

const sorted = (keys: readonly string[]) => [...keys].sort();

describe("Logjam Web draws exactly what the Places contracts name", () => {
  it("the filter sheet's sections", () => {
    expect(sorted(Object.keys(FILTER_SHEET_SECTIONS))).toEqual(
      sorted(contractSectionKeys(PLACES_FILTER_SHEET, "web")),
    );
  });

  it("the ways to add a place", () => {
    expect(sorted(Object.keys(ADD_ENTRY_ICON))).toEqual(
      sorted(contractSectionKeys(PLACES_ADD, "web")),
    );
  });

  it("a place's verbs", () => {
    expect(sorted(Object.keys(PLACE_VERB_ICON))).toEqual(
      sorted(placeVerbIds("web")),
    );
  });
});
