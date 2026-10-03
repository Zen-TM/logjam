// Logjam GPS implements EXACTLY the logbook's filter-sheet contract: every
// section `@logjam/shared` gives this client, and none it does not.
//
// The map is a `Record<…>` over the contract's keys, so `tsc` already refuses
// a missing or an extra key. This assertion is the same rule for a reader who
// runs only the tests. To see it go red: add `{ key: "weather" }` to
// `TRIPS_FILTER_SHEET.sections` (a section this client does not draw), or
// delete `dates` from it (a section this client draws unasked).
//
// The logbook's other maps (the list's `sections`, each verb's runner) close
// over their component's state, so they cannot be imported; the same
// `Record<…>` typing is their check, in `npm run typecheck`.
import { describe, expect, it, vi } from "vitest";
import { contractSectionKeys, TRIPS_FILTER_SHEET } from "@logjam/shared";
import { FILTER_SHEET_SECTIONS } from "./LogsFilterSheet";

// The sheet is an RN component; only its module-level section map is wanted,
// so everything it draws with is stubbed out (vitest hoists these above the
// imports).
vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: "View",
}));
vi.mock("../theme", () => ({ spacing: (n: number) => n * 8 }));
vi.mock("../ui", () => ({}));

describe("Logjam GPS draws exactly what the logbook's contracts name", () => {
  it("the filter sheet's sections", () => {
    expect(Object.keys(FILTER_SHEET_SECTIONS).sort()).toEqual(
      [...contractSectionKeys(TRIPS_FILTER_SHEET, "gps")].sort(),
    );
  });
});
