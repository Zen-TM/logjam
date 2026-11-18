import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Answering a plan's form, a question reads above its hint: the label takes
 * the `rowTitle` role in the text colour, the hint stays `detail` and muted
 * (the kit's field label is `detail` too). Logjam Web's twin is
 * `frontend/src/components/plans/questionPrompt.test.ts`.
 *
 * Mutation: delete `prominentLabel` from one question in PlanFormFields, or
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
  });
});
