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
// Delete the grade system from the `comparePlaces` call of either places list,
// or the `gradeSystem` prop Logjam Web's sidebar hands its list, and "Easiest first" sorts a canyon graded only in ACA among the ungraded.
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
const WEB_LIST = read("frontend/src/components/sidebar/panels/PlacesPanel.tsx");
const GPS_LIST = read("mobile/src/places/PlacesScreen.tsx");
const GPS_FORM = read("mobile/src/places/PlaceEditSheet.tsx");
const GPS_FILTER = read("mobile/src/places/PlaceFilterSheet.tsx");
const WEB_SIDEBAR = read("frontend/src/components/sidebar/SidebarPanel.tsx");

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

  it("shows one Grade row in its attribute table, not the grade inputs", () => {
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

  it("shows one Grade row in its attribute table, not the grade inputs", () => {
    expect(GPS).toContain(
      "canyonGradeRows( attributeRows(labellingDefs, storedFields), place.fieldValues, )",
    );
  });
});

describe("Logjam GPS's plan place sheet", () => {
  it("shows one Grade row in place of the grade inputs", () => {
    expect(GPS_PLAN).toContain(
      "canyonGradeRows( attributeRows(SYSTEM_FIELD_DEFS, userFieldValues(place.fieldValues)), place.fieldValues, )",
    );
  });
});

describe("the places lists", () => {
  // Mutation: drop `gradeSystem` from either `comparePlaces` call, or the prop
  // the sidebar hands its list.
  it("sort by the grade system of the ground in view", () => {
    expect(WEB_LIST).toContain(
      "comparePlaces(a.place, b.place, sort, gradeSystem)",
    );
    expect(GPS_LIST).toContain("comparePlaces(a, b, sort, gradeSystem)");
    expect(WEB_SIDEBAR).toContain("gradeSystem={placesGradeSystem}");
  });
});

// Logjam GPS's place form has no render harness, so it is read like the
// screens above; Logjam Web's is rendered in PlaceDialog.grades.render.test.tsx.
describe("Logjam GPS's place form", () => {
  // Mutation: build `typeFieldDefs` with `defsForType` in PlaceEditSheet, or
  // pass `placeFormDefs` no position, and an NSW canyon is offered the ACA
  // fields.
  it("offers the grade fields of the system where the place stands", () => {
    expect(GPS_FORM).toContain(
      "placeFormDefs( customFieldDefs, placeTypeId, draft.longitude, draft.latitude, { ...place?.fieldValues,",
    );
    expect(GPS_FORM).not.toContain("defsForType(");
  });
});

// Logjam GPS's filter sheet has no render harness either; Logjam Web's is
// rendered in PlaceFilterSheet.grades.render.test.tsx.
describe("Logjam GPS's place filter sheet", () => {
  // Mutation: build `typeDefs` in PlaceFilterSheet with `defsForType`, or drop
  // `listedPlaces` or `gradeSystem` from the `PlaceFilterSheet` call in
  // PlacesScreen: the ACA axes show over NSW.
  it("offers the grade axes of the system in view, and of the places listed", () => {
    expect(GPS_FILTER).toContain(
      "placeFilterDefs( defs, filters.placeTypeId, props.gradeSystem, props.listedPlaces, filters.custom, )",
    );
    expect(GPS_LIST).toContain(
      "gradeSystem={gradeSystem} listedPlaces={places}",
    );
  });
});
