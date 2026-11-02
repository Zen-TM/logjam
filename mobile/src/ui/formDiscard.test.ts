import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// shared/DESIGN.md §10: abandoning a form that holds work confirms it, and
// `BottomSheet` does the asking when it is given `discard`. A form sheet is a
// file that renders `<BottomSheet` with a `<FormStack`; it passes `discard=`.
//
// Mutation: delete the `discard=` line from `places/PlaceEditSheet.tsx`.
const SRC = join(import.meta.dirname, "..");

// These hold no typed work: a filter, or a pick of a role. A new form sheet
// does not join this list.
const NO_WORK_TO_LOSE = [
  "logs/LogsFilterSheet.tsx",
  "places/PlaceFilterSheet.tsx",
  "plans/InviteSheet.tsx",
];
// A form sheet with no `<FormStack`.
const ALSO_FORMS = ["plans/FormSheet.tsx"];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : /\.tsx$/.test(entry.name) && !entry.name.includes(".test.")
        ? [join(dir, entry.name)]
        : [],
  );
}

describe("form sheets", () => {
  const sheets = files(SRC)
    .map((path) => ({
      rel: relative(SRC, path),
      code: readFileSync(path, "utf8"),
    }))
    .filter(({ code }) => /<BottomSheet\b/.test(code));

  it("each passes discard= to BottomSheet", () => {
    const forms = sheets.filter(
      ({ rel, code }) => /<FormStack\b/.test(code) || ALSO_FORMS.includes(rel),
    );
    const missing = forms
      .filter(({ code }) => !/\bdiscard=\{/.test(code))
      .map(({ rel }) => rel)
      .sort();
    expect(missing).toEqual([...NO_WORK_TO_LOSE].sort());
  });
});
