import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// shared/DESIGN.md §9: "Labels wrap, never ellipsise; a user's own title stops
// at two lines." A name the user typed (a place, a file, a way) wraps with
// `composes: twoLines from "ui/TwoLines.module.css"`; a clipped single line is
// for what is not a name — a count, a summary the control itself opens to show
// in full — and is listed here with the reason. A file that no longer has one
// is removed from the list.
//
// Mutation that turns it red: add `text-overflow: ellipsis;` to any screen
// stylesheet not listed.
const SRC = dirname(fileURLToPath(import.meta.url));

const ALLOWED: { file: string; reason: string }[] = [
  {
    file: "ui/FilterField.module.css",
    reason:
      "the active filter's summary, not a name: the field opens to show it whole",
  },
  {
    file: "components/map/MapSearchBox.module.css",
    reason: "a place name in a result: wraps with the map chrome's own pass",
  },
];

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

/** Does a stylesheet clip a line with an ellipsis (comments aside)? */
function clips(css: string): boolean {
  return /text-overflow\s*:\s*ellipsis/.test(
    css.replace(/\/\*[\s\S]*?\*\//g, ""),
  );
}

describe("a name wraps; it is not ellipsised", () => {
  it("sees an ellipsis, and not the word in a comment", () => {
    expect(clips("a { text-overflow: ellipsis; }")).toBe(true);
    expect(clips("/* text-overflow: ellipsis */ a { color: red; }")).toBe(
      false,
    );
  });

  it("is true of every stylesheet but those listed", () => {
    const offenders = stylesheets(SRC)
      .map((path) => relative(SRC, path))
      .filter(
        (file) =>
          clips(readFileSync(join(SRC, file), "utf8")) &&
          !ALLOWED.some((a) => a.file === file),
      );
    expect(offenders).toEqual([]);
  });

  it("lists only stylesheets that still clip", () => {
    const stale = ALLOWED.filter(
      (a) => !clips(readFileSync(join(SRC, a.file), "utf8")),
    ).map((a) => a.file);
    expect(stale).toEqual([]);
  });
});
