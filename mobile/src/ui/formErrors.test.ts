import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// ONE VISUAL FOR A VALIDATION MESSAGE, AND IT LIVES IN THE KIT.
//
// docs/ux-principles.md §11, "Form errors": a problem with one control is drawn under it by
// `FieldError` (directly, or through `TextField`'s / `ChipPicker`'s `error`).
// Before that rule, the same warning-coloured line was restyled by hand in the
// forms that needed it — `CustomFieldsEditor` drew its place-type error with a
// local `scopeError` style beside a `TextField` that drew its own — and two
// stylesheets for one visual is how the rest of the drift started.
//
// So a style NAMED for an error that sets a text colour (`text`, or the warning
// it used to be) may exist only in `src/ui/`, and no style outside it sets
// `color: theme.warning` at all: the warning is a glyph, edge or fill, never
// the colour of words (docs/ux-principles.md §7). A notice beside a control
// uses `FieldError`; one over the map uses `Notice`.
const SRC = join(__dirname, "..");
const UI = join(SRC, "ui");

function tsxFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFilesUnder(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** Style entries named for an error, or any entry, whose object sets `color: theme.warning`
 *  beside a `fontSize` (words, not an icon's colour; words are `text`: UX §7) or, if named for an error, `color: theme.text`. */
function handRolledErrorStyles(source: string): string[] {
  const named = [
    ...source.matchAll(
      /(\w*(?:[Ee]rror|[Ii]nvalid)\w*)\s*:\s*\{[^}]*color:\s*theme\.(?:warning|text)\b/g,
    ),
  ].map((match) => match[1]);
  const warningWords = [
    ...source.matchAll(
      /(\w+)\s*:\s*\{[^}]*\bfontSize:[^}]*\bcolor:\s*theme\.warning\b|(\w+)\s*:\s*\{[^}]*\bcolor:\s*theme\.warning\b[^}]*\bfontSize:/g,
    ),
  ].map((match) => match[1] ?? match[2]);
  return [...new Set([...named, ...warningWords])];
}

describe("validation messages are drawn by the kit", () => {
  it("recognises the kit's own error style — a silent zero would pass forever", () => {
    expect(
      handRolledErrorStyles(readFileSync(join(UI, "FieldError.tsx"), "utf8")),
    ).toEqual(["error"]);
  });

  it("no screen hand-rolls one", () => {
    const offenders = tsxFilesUnder(SRC)
      .filter((path) => !path.startsWith(UI))
      .flatMap((path) =>
        handRolledErrorStyles(readFileSync(path, "utf8")).map(
          (name) => `${relative(SRC, path)}: ${name}`,
        ),
      );
    expect(offenders).toEqual([]);
  });
});
