// Both clients draw a place's page in the order `PLACE_PAGE` declares: each
// takes its keys from `contractSectionsFor`, applies nothing to them but the
// one step it has always had, and calls the section map only from that walk.
// This reads each page's source for exactly that walk, so a hand-written key
// list, a `.reverse()`/`.sort()`/`.filter()` on the keys, or a
// `sections.weather()` call from the JSX turns it red.
//
// Mutations that turn it red: add `.reverse()` after the walk in either page;
// call `sections.weather()` from the JSX of either page; pass `place` instead
// of `place.fieldValues` to `formatCanyonGrade` (`unknown` lets that compile
// and return no grade).
//
//
// Delete the `isCanyonGradeKey` filter or the `canyonGradeRow` call from the
// Web place page, or the `canyonGradeRows` call from either GPS screen, and the
// "one Grade row, not three" tests below turn red. Web's place page is also
// rendered in PlaceDetailPanel.render.test.tsx. Neither GPS screen has a render harness, so they read the
// source like the walk tests above; Web's plan place page is rendered in
// planPlace.render.test.tsx.
//
// Not covered: the order inside a section, which key a section draws under
// (`tsc` holds the keys of the `sections` map against the contract), and the
// rendered DOM or native tree, which only a render test would see.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..", "..", "..");
const read = (file: string) =>
  readFileSync(join(repo, file), "utf8").replace(/\s+/g, " ");

const WEB = read("frontend/src/components/sidebar/panels/PlaceDetailPanel.tsx");
const GPS = read("mobile/src/places/PlaceDetailScreen.tsx");
const GPS_PLAN = read("mobile/src/plans/PlanPlaceSheet.tsx");

/** Every use of the section map in a page: `sections.x(` and `sections[k](`. */
const uses = (source: string) =>
  [...source.matchAll(/\bsections(?:\.\w+|\[[^\]]+\])/g)].map((m) => m[0]);

describe("Logjam Web's place page", () => {
  it("walks the contract's keys and draws each through the one call", () => {
    expect(WEB).toContain(
      'const sectionKeys = contractSectionsFor(PLACE_PAGE, "web", isOwnedPlace);',
    );
    expect(WEB).toContain(
      "{sectionKeys.map((key) => ( <Fragment key={key}>{sections[key]()}</Fragment> ))}",
    );
    expect(WEB.match(/\bsectionKeys\b/g)).toHaveLength(2);
    expect(uses(WEB)).toEqual(["sections[key]"]);
  });

  it("reads the grade from the place's field values", () => {
    expect(WEB).toContain("formatCanyonGrade(current.fieldValues)");
  });

  it("shows one Grade row in its attribute table, not the three inputs", () => {
    expect(WEB).toContain(".filter((def) => !isCanyonGradeKey(def.key))");
    expect(WEB).toContain("canyonGradeRow(place.fieldValues)");
  });
});

describe("Logjam GPS's place page", () => {
  it("walks the contract's keys, takes the hero out, and draws the rest through the one call", () => {
    expect(GPS).toContain(
      '{contractSectionsFor(PLACE_PAGE, "gps", isOwner) .filter((key) => key !== "hero") .map((key) => ( <Fragment key={key}>{sections[key]()}</Fragment> ))}',
    );
    expect(uses(GPS)).toEqual(["sections.hero", "sections[key]"]);
  });

  it("reads the grade from the place's field values", () => {
    expect(GPS).toContain("formatCanyonGrade(place.fieldValues)");
  });

  it("shows one Grade row in its attribute table, not the three inputs", () => {
    expect(GPS).toContain(
      "canyonGradeRows( attributeRows(labellingDefs, storedFields), place.fieldValues, )",
    );
  });
});

describe("Logjam GPS's plan place sheet", () => {
  it("shows one Grade row in place of the three grade inputs", () => {
    expect(GPS_PLAN).toContain(
      "canyonGradeRows( attributeRows(SYSTEM_FIELD_DEFS, userFieldValues(place.fieldValues)), place.fieldValues, )",
    );
  });
});
