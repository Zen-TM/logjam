import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A printer cannot print the outer ~5 mm of a sheet; the summary keeps at
// least 12 mm clear on every side and draws nothing in it.
const css = readFileSync(
  join(process.cwd(), "src/components/plans/PlanSummary.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("the printed summary's margins", () => {
  // Mutation: nest `@page` back inside `@media print`, or set its margin to
  // 5mm, and this turns red.
  it("sets at least 12 mm on a top-level @page", () => {
    const top = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const page = /@page\s*\{([^}]*)\}/.exec(top);
    expect(page, "@page at the top level").not.toBeNull();
    const margin = /margin:\s*([\d.]+)mm\s*;/.exec(page![1]!);
    expect(Number(margin?.[1])).toBeGreaterThanOrEqual(12);
  });

  // Mutation: add `position: fixed` (a running page number or footer) or an
  // @page margin box, and text lands in the margin.
  it("draws nothing outside the page box", () => {
    expect(css).not.toMatch(/position:\s*(fixed|absolute)/);
    expect(css).not.toMatch(/@(top|bottom|left|right)-[a-z-]+\s*\{/);
  });
});
