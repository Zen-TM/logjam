import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Answering a plan's form, a question reads above its hint, and the hint
 * sits between the question and its answer: the label takes the `rowTitle`
 * role in the text colour, the hint stays `detail` and muted. The kit's field
 * label is `detail` too, and so is a `FieldGroup`'s legend by default, so
 * every question opts in with `prominentLabel` (on its field, its
 * `FieldGroup` or agree's `Checkbox`), and every question but agree opts in
 * with `hintAbove`, whose hint is the tick box's own description.
 *
 * Mutation: delete `prominentLabel` or `hintAbove` from one question (agree
 * excepted for `hintAbove`) in PlanAnswerDialog, or make `.labelProminent`
 * compose `detail`.
 */
const DIR = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(DIR, path), "utf8");

/** The role a CSS class composes. */
const roleOf = (css: string, cls: string) =>
  new RegExp(`\\.${cls}\\s*{[^}]*composes:\\s*(\\w+) from`).exec(css)?.[1];

describe("a plan form's question prompt", () => {
  it("is a bigger role than its hint", () => {
    const kit = read("../../ui/TextField.module.css");
    expect(roleOf(kit, "labelProminent")).toBe("rowTitle");
    expect(roleOf(kit, "hint")).toBe("detail");
    // The tick box that agrees to something, as the text fields.
    expect(roleOf(read("../../ui/Choice.module.css"), "titleProminent")).toBe(
      "rowTitle",
    );
  });

  it("is asked by every kind of question", () => {
    const source = read("PlanAnswerDialog.tsx");
    // text and phone, long text, number, agree, choice, multiple choice
    expect(source.match(/\bprominentLabel\b/g)).toHaveLength(6);
    // the same, bar agree, whose hint is the tick box's own description
    expect(source.match(/\bhintAbove\b/g)).toHaveLength(5);
    // choice and yes/no, multiple choice, agree
    expect(source.match(/<FieldGroup\b/g)).toHaveLength(3);
  });
});
