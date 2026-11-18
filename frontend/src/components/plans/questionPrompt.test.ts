import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Answering a plan's form, a question reads above its hint: the label takes
 * the `rowTitle` role in the text colour, the hint stays `detail` and muted.
 * The kit's field label is `detail` too, so each text-like question opts in
 * with `prominentLabel` and the chip and tick-box questions use
 * `questionPrompt`.
 *
 * Mutation: delete `prominentLabel` from one question in PlanAnswerDialog, or
 * make `.questionPrompt` compose `detail`.
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
    expect(roleOf(read("plans.module.css"), "questionPrompt")).toBe("rowTitle");
  });

  it("is asked by every kind of question", () => {
    const source = read("PlanAnswerDialog.tsx");
    // text and phone, long text, number
    expect(source.match(/\bprominentLabel\b/g)).toHaveLength(3);
    // choice and yes/no, multiple choice
    expect(source.match(/classes\.questionPrompt/g)).toHaveLength(2);
  });
});
