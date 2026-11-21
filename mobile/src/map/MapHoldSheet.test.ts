// The hold sheet's rows come from the contract, read as text: the screens have
// no render test.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mapHoldVerbs, mapPointVerbs } from "@logjam/shared";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("the press-and-hold sheet", () => {
  // Mutation: write a verb's label back into `MapScreen.tsx` as a literal, or
  // draw a list other than `mapHoldVerbs("gps")` in the sheet.
  it("draws its rows from the contract and keeps no verb words of its own", () => {
    expect(read("MapHoldSheet.tsx")).toContain('mapHoldVerbs("gps")');
    const screen = read("MapScreen.tsx");
    for (const verb of [...mapHoldVerbs("gps"), ...mapPointVerbs("gps")])
      expect(screen, verb.label).not.toContain(`"${verb.label}"`);
  });
});

describe("the tap sheet", () => {
  // Mutation: draw a verb list of its own in the tap sheet, or put a verb
  // back on the facts view: they belong behind one Options row.
  it("draws its verbs from the contract, behind one Options row", () => {
    const sheet = read("MapPointSheet.tsx");
    expect(sheet).toContain('mapPointVerbs("gps"');
    expect(sheet).toContain("MAP_POINT.copy.options");
    expect(sheet.match(/mapPointVerbs\(/g)).toHaveLength(1);
  });

  // Mutation: build a stat from `mapPointFacts` other than with `factStat`,
  // or drop `factStat`'s `copy` to `onCopy` wiring, and the coordinates and
  // grid reference stop copying where they are pressed.
  it("copies every copyable figure where it is pressed", () => {
    const sheet = read("MapPointSheet.tsx");
    expect(sheet.match(/mapPointFacts\(/g)).toHaveLength(2);
    expect(
      sheet.match(/\.map\(\(fact\) => factStat\(fact, onInfo\)\)/g),
    ).toHaveLength(2);
    expect(read("factStat.ts")).toContain(
      "...(fact.copy ? { onCopy: copyFact(fact.copy, onInfo) } : {})",
    );
  });

  // Mutation: draw a place page's coordinates as a Row of its own again, and
  // Logjam GPS's place and plan place pages lose the grid reference.
  it("gives the place pages the same position rows", () => {
    for (const file of [
      "../places/PlaceDetailScreen.tsx",
      "../plans/PlanPlaceSheet.tsx",
    ])
      expect(read(file), file).toContain("<PositionRows");
    expect(read("../places/PositionRows.tsx")).toContain(
      "positionFacts(point).map(",
    );
  });

  // Mutation: give the sheet a plain `onClose={onClose}` again, and the back
  // gesture, the scrim and the swipe close the whole sheet from the forecast
  // or Options instead of undoing one layer. The steps themselves are
  // `mapPointStepBack`'s, held by its shared test.
  it("steps back one layer on the back gesture, the scrim and the arrow alike", () => {
    const sheet = read("MapPointSheet.tsx");
    expect(sheet).toContain("const back = mapPointStepBack(view);");
    expect(sheet).toMatch(/onClose=\{back \? \(\) => show\(back\) : onClose\}/);
    expect(sheet).toMatch(
      /onBack=\{back \? \(\) => show\(back\) : undefined\}/,
    );
  });
});
