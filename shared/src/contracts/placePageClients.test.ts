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
// Delete the `isCanyonGradeKey` filter or the `gradeRowsOf` call from the
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
const WEB_PLAN_ITEM = read(
  "frontend/src/components/plans/PlanItemEditDialog.tsx",
);
const GPS_PLAN_ITEM = read("mobile/src/plans/PlanItemSheet.tsx");
const WEB_SIDEBAR = read("frontend/src/components/sidebar/SidebarPanel.tsx");
const WEB_SETTINGS = read(
  "frontend/src/components/sidebar/panels/SettingsPanel.tsx",
);
const WEB_TYPES = read(
  "frontend/src/components/sidebar/panels/PlaceTypeSection.tsx",
);
const GPS_SETTINGS = read("mobile/src/screens/SettingsScreen.tsx");
const GPS_STEP = read("mobile/src/customFields/useTypeAttributesStep.tsx");
const GPS_VALUES = read("mobile/src/customFields/CustomFieldValues.tsx");
const GPS_ATTRIBUTE_FILTER = read("mobile/src/ui/AttributeFilter.tsx");

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
    expect(WEB).toContain("gradeRowsOf(place.fieldValues)");
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

  // Mutation: hand `PlaceFilterSheet` the filtered list (`visible`) in
  // PlacesPanel: an axis a filter has hidden every holder of would vanish
  // from the sheet as the user narrows the list. The doc of `placeFilterDefs`
  // names this test.
  it("hand the filter sheet every place listed, not the filtered ones", () => {
    expect(WEB_LIST).toContain(
      "listedPlaces={collection.map(({ place }) => place)}",
    );
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
      "placeFormDefs( customFieldDefs, placeTypeId, draft.longitude, draft.latitude, place?.fieldValues, fieldValues, )",
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

// A plan item's edit form patches the list it drew and checked, not one worked
// out again from the item the plan now holds (`itemFieldDefs`'s doc). Logjam
// Web's dialog is rendered nowhere with a plan that moves, so both are read.
describe("Logjam Web's plan item form", () => {
  // Mutation: call `itemPatch(seen, values, itemFieldDefs(seen))` in
  // PlanItemEditDialog.
  it("hands the patch the list it draws and checks", () => {
    expect(WEB_PLAN_ITEM).toContain(
      "const defs = place ? itemFieldDefs(place) : [];",
    );
    expect(WEB_PLAN_ITEM).toContain("itemPatch(seen, values, defs)");
    expect(WEB_PLAN_ITEM.match(/\bitemPatch\(/g)).toHaveLength(1);
  });
});

describe("Logjam GPS's plan item sheet", () => {
  // Mutation: call `itemPatch(base, values, itemFieldDefs(base))` in
  // PlanItemSheet.
  it("hands the patch the list it validates", () => {
    expect(GPS_PLAN_ITEM).toContain(
      'const defs = target.kind === "place" ? itemFieldDefs(target) : [];',
    );
    expect(GPS_PLAN_ITEM).toContain("itemPatch(base, values, defs)");
    expect(GPS_PLAN_ITEM.match(/\bitemPatch\(/g)).toHaveLength(1);
  });
});

// Each client says where the centre of "the map in view" comes from, which
// `gradeSystemOfView`'s doc leaves to it. Neither has a map to render here, so
// the two calls are read.
describe("the centre each client hands gradeSystemOfView", () => {
  // Mutation: swap `mapCenter.lng` and `mapCenter.lat` in `placesGradeSystem`
  // (SidebarPanel), which reads Utah as a point in the Southern Ocean.
  it("is the map's centre as [longitude, latitude] on Logjam Web", () => {
    expect(WEB_SIDEBAR).toContain(
      "gradeSystemOfView( mapCenter ? [mapCenter.lng, mapCenter.lat] : null, currentUser?.uiPreferences, )",
    );
  });

  // Mutation: pass `null` in place of `readLastMapCamera()?.center` in
  // `readGradeSystem` (PlacesScreen): the list follows the account's home
  // whatever the map shows.
  it("is the last map camera's centre on Logjam GPS", () => {
    expect(GPS_LIST).toContain(
      "gradeSystemOfView(readLastMapCamera()?.center ?? null, { regions: readRegions(), })",
    );
  });
});

// Logjam GPS draws a labelled field (the ACA grades) as its words. Neither
// widget has a render harness, so each call is read.
describe("Logjam GPS's labelled fields", () => {
  // Mutation: build the form's rail from `railStops(def)` in CustomFieldValues,
  // which draws the ACA grades as bare ranks.
  it("draw as words in the place form's rail", () => {
    expect(GPS_VALUES).toContain("const options = railChoices(def);");
  });

  // Mutation: drop the `word` prop of `RangePills` in AttributeFilter: the
  // filter's pills read "1" to "4" for the ACA technical grade.
  it("draw as words in the filter's pills", () => {
    expect(GPS_ATTRIBUTE_FILTER).toContain(
      "word={(stop) => stopLabel(def.key, stop)}",
    );
  });
});

// A grade attribute is listed by the system of the account's home region, not
// by a map: the lists belong to no place. Logjam Web's lists are rendered in
// CustomFieldSection.test.tsx and UnifiedImportDialog.render.test.tsx, which
// pass the account's preferences in; here the preferences are followed from
// where each client holds them, and Logjam GPS's lists, with no render
// harness, are read.
describe("the attribute lists", () => {
  // Mutation: in SettingsPanel, pass `{}` in place of the account's
  // preferences to either list, or drop one: Logjam Web lists ACA built-ins
  // over NSW again.
  it("on Logjam Web take the account's preferences to every list", () => {
    expect(
      WEB_SETTINGS.match(/uiPreferences=\{currentUser\?\.uiPreferences\}/g),
    ).toHaveLength(2);
    expect(WEB_TYPES.match(/uiPreferences=\{uiPreferences\}/g)).toHaveLength(2);
    expect(WEB_LIST).toContain("uiPreferences={uiPreferences}");
    expect(WEB_SIDEBAR).toContain(
      "gradeSystem={placesGradeSystem} uiPreferences={currentUser?.uiPreferences}",
    );
  });

  // Mutation: pass `defsFor(sheet.entity)` to `CustomFieldList` in
  // SettingsScreen, or `defsForType(defs, type.id)` in the attributes step:
  // Logjam GPS lists the ACA built-ins over NSW again.
  it("on Logjam GPS are cut to the account's regions", () => {
    expect(GPS_SETTINGS).toContain(
      "defs={listedAttributeDefs(defsFor(sheet.entity), { regions: regionIds, })}",
    );
    expect(GPS_STEP).toContain(
      "listedAttributeDefs(defsForType(defs, type.id), { regions: regionIds, })",
    );
  });
});
