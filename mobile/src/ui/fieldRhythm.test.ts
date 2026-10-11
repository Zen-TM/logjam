import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A FIELD'S LABEL AND ITS GAPS COME FROM THE KIT.
//
// `Field` draws the label (`fieldLabel`) and puts it `formRhythm.label` above
// its control; `FormStack` puts one field `formRhythm.field` from the next
// (shared/DESIGN.md §2). A form that imported `fieldLabel` to draw its own
// label also hand-rolled the wrapper gap, which is how a control once sat 4dp
// under the chips above it. So only `src/ui` may import it.
//
// Mutation that turns it red: add `import { fieldLabel } from "../ui/fieldLabel";`
// to `places/PlaceEditSheet.tsx`.
const SRC = join(__dirname, "..");
const UI = join(SRC, "ui");

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.tsx?$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });
}

const importsFieldLabel = (source: string) =>
  /from\s+["'](?:\.\.?\/)+(?:ui\/)?fieldLabel["']/.test(source);

describe("a field's label", () => {
  it("recognises the import it forbids", () => {
    expect(
      importsFieldLabel('import { fieldLabel } from "../ui/fieldLabel";'),
    ).toBe(true);
    expect(
      importsFieldLabel('import { fieldLabel } from "./syncIssueDisplay";'),
    ).toBe(false);
  });

  it("is drawn by the kit, never imported by a screen", () => {
    const offenders = sourcesUnder(SRC)
      .filter((path) => !path.startsWith(UI))
      .filter((path) => importsFieldLabel(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});
