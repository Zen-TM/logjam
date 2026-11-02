import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// shared/DESIGN.md §10: abandoning a form that holds work confirms it, and
// `Dialog` does the asking when it is given `discard`. A form dialog is a
// `<Dialog` whose footer submits a form (`form={`); it passes `discard=`.
//
// Mutation: delete the `discard=` line from `PlaceDialog.tsx`.
//
// These raise no confirm: a single field or a pick from a list, where leaving
// loses a few seconds, not work. A new form dialog does not join this list.
const NO_WORK_TO_LOSE = [
  "components/dialogs/ChangeEmailDialog.tsx",
  "components/dialogs/DeleteAccountDialog.tsx",
  "components/dialogs/RouteNameDialog.tsx",
  "components/plans/PlanAddCopyDialog.tsx",
  "components/plans/PlanPrintDialog.tsx",
  "components/plans/PlanTripLogPlacesDialog.tsx",
  "components/sidebar/panels/AccountPanel.tsx",
];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx$/.test(name) && !name.includes(".test.")) out.push(path);
  }
  return out;
}

describe("form dialogs", () => {
  const root = __dirname;
  const forms = sources(root)
    .map((path) => ({
      rel: path.slice(root.length + 1),
      code: readFileSync(path, "utf8"),
    }))
    .filter(({ code }) => /<Dialog\b/.test(code) && /\bform=\{/.test(code));

  it("each passes discard= to Dialog", () => {
    const missing = forms
      .filter(({ code }) => !/\bdiscard=\{/.test(code))
      .map(({ rel }) => rel)
      .sort();
    expect(missing).toEqual([...NO_WORK_TO_LOSE].sort());
  });
});
