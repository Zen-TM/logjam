import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// ONE VISUAL FOR A VALIDATION MESSAGE, AND IT LIVES IN THE KIT.
//
// DESIGN.md §8, "Form errors": a problem with one control is drawn under it by
// `FieldError` (directly, or through `TextField`'s / `ChipPicker`'s `error`).
// Before that rule, the same warning-coloured line was restyled by hand in the
// forms that needed it — `CustomFieldsEditor` drew its place-type error with a
// local `scopeError` style beside a `TextField` that drew its own — and two
// stylesheets for one visual is how the rest of the drift started.
//
// So a warning-coloured style NAMED for an error may exist only in `src/ui/`.
// Warning-coloured notices (offline, map badges, destructive rows) are not
// validation and are not named for errors, so they do not trip this.
const SRC = join(__dirname, "..");
const UI = join(SRC, "ui");

function tsxFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFilesUnder(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** Style entries named for an error whose object sets `color: theme.warning`. */
function handRolledErrorStyles(source: string): string[] {
  return [
    ...source.matchAll(/(\w*(?:[Ee]rror|[Ii]nvalid)\w*)\s*:\s*\{[^}]*color:\s*theme\.warning\b/g),
  ].map((match) => match[1]);
}

describe("validation messages are drawn by the kit", () => {
  it("recognises the kit's own error style — a silent zero would pass forever", () => {
    expect(handRolledErrorStyles(readFileSync(join(UI, "FieldError.tsx"), "utf8"))).toEqual([
      "error",
    ]);
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
