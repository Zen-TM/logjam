import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Answering a plan's form, a question reads above its hint: the label takes
 * the `rowTitle` role in the text colour, the hint stays `detail` and muted
 * (the kit's field label is `detail` too). Logjam Web's twin is
 * `frontend/src/components/plans/questionPrompt.test.ts`.
 *
 * Mutation: delete `prominentLabel` or `hintAbove` from one question in
 * PlanFormFields, or
 * make `Field`'s `labelProminent` spread `textRole.detail`.
 */
const read = (path: string) => readFileSync(join(__dirname, path), "utf8");

describe("a plan form's question prompt", () => {
  it("is a bigger role than its hint", () => {
    const field = read("../ui/Field.tsx");
    expect(field).toContain(
      "labelProminent: { ...textRole.rowTitle, color: theme.text }",
    );
    expect(field).toContain("hint: muted(theme, textRole.detail)");
  });

  it("is asked by every kind of question", () => {
    // text-like, choice and yes/no, multiple choice
    expect(
      read("PlanFormFields.tsx").match(/\bprominentLabel\b/g),
    ).toHaveLength(3);
    expect(read("PlanFormFields.tsx").match(/\bhintAbove\b/g)).toHaveLength(3);
  });

  // Mutation: draw `Field`'s hint after `{children}` whatever `hintAbove`
  // says, and every plan question shows its hint under the answer.
  it("draws the hint between the label and the control when asked", () => {
    const field = read("../ui/Field.tsx");
    const above = field.indexOf("{hintAbove ? hintLine : null}");
    const control = field.indexOf("{children}");
    const below = field.indexOf("{hintAbove ? null : hintLine}");
    expect(above).toBeGreaterThan(0);
    expect(above).toBeLessThan(control);
    expect(control).toBeLessThan(below);
  });
});
