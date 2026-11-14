import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// A distance, height, speed, area or rain figure is written by `units.ts` and
// nowhere else: a hand-written "${n} m" prints metres to someone who chose
// feet. This scans source for a figure followed by a unit, in a template, in
// JSX text or after a `+`, and names every one outside `units.ts`.
// There is no allow-list beyond `NOT_YET`, whose files each take a change that
// needs logic: a figure that must stay in one unit takes its number from
// `units.ts` too (`formatFixedMetres`), or is written as plain copy with no
// figure hole.
//
// Mutation that turns it red: write `↑ ${Math.round(gainM)} m` back in
// `profileSeries.ts` or `frontend/src/components/routes/RouteDrawPanel.tsx`,
// or `${Math.round(width)} × ${Math.round(height)} km` in
// `contracts/placesFilterSheet.ts`.

/** Directories scanned, from the repo root. Widening the guard adds one here. */
const SCANNED = ["shared/src", "frontend/src"];
/**
 * Files whose figures this guard cannot hold yet, each with why. A file is
 * named here only while it still holds one: the test "names only files that
 * still hold a figure" fails when a file is fixed, so its entry goes with it.
 */
const NOT_YET: Record<string, string> = {
  "frontend/src/geoPdf/draw/elements.ts":
    "the printed scale bar's step list is metric and its label drops the decimal (1 km, not 1.0 km), so units.ts's formatDistance would change what it prints",
};
/** The one file that writes figures. */
const UNITS_MODULE = "shared/src/units.ts";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** A unit, right after a figure: whitespace (a no-break space too) or none, then not part of a longer word. */
const UNIT_AFTER = /^\s?(?:m|km|km\/h|km²|mm|ft|mi|mph)(?![\p{L}\p{N}_/²])/u;

function sourceFiles(dir: string): string[] {
  return (readdirSync(join(REPO, dir), { recursive: true }) as string[])
    .filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !/\.test\.tsx?$/.test(file) &&
        !/(^|[\\/])(__fixtures__|__tests__|node_modules|dist)[\\/]/.test(file),
    )
    .map((file) => `${dir}/${file}`);
}

/** Line numbers where `text` writes a figure and a unit by hand. */
function figureUnitLines(file: string, text: string): number[] {
  const tree = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: number[] = [];
  const hit = (node: ts.Node) =>
    lines.push(tree.getLineAndCharacterOfPosition(node.getStart()).line + 1);
  const visit = (node: ts.Node) => {
    // `${figure} m`: the text after each hole.
    if (ts.isTemplateExpression(node))
      for (const span of node.templateSpans)
        if (UNIT_AFTER.test(span.literal.text)) hit(span);
    // `figure + " m"`.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      ts.isStringLiteralLike(node.right) &&
      UNIT_AFTER.test(node.right.text)
    )
      hit(node.right);
    // `{figure} m` in JSX text.
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const { children } = node;
      children.forEach((child, index) => {
        const next = children[index + 1];
        if (
          ts.isJsxExpression(child) &&
          next &&
          ts.isJsxText(next) &&
          UNIT_AFTER.test(next.text)
        )
          hit(child);
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return lines;
}

describe("figures and their units", () => {
  // Mutation: remove the `ts.isJsxElement` branch, or the `PlusToken` check,
  // or make `UNIT_AFTER` match nothing, and one of these turns red.
  it("recognises each way of writing one", () => {
    const cases: [string, number][] = [
      ["const a = `${n} m`;", 1],
      ["const a = `${n} km/h`;", 1],
      ["const a = `${n} km²`;", 1],
      ["const a = `${a} × ${b} km`;", 1],
      ['const a = n + " mm";', 1],
      ["const a = <b>{n} ft</b>;", 1],
      ["const a = <>{n}m</>;", 1],
      // Not figures: a longer word, no hole, a comment.
      ["const a = `${n} min`;", 0],
      ["const a = `${n} metres`;", 0],
      ["const a = `${n} mile`;", 0],
      ["const a = `A map is 100 km on a side`;", 0],
      ["// `${n} m`\nconst a = 1;", 0],
    ];
    for (const [code, expected] of cases)
      expect(figureUnitLines("case.tsx", code), code).toHaveLength(expected);
  });

  // Mutation: write `${Math.round(gainM)} m` back in `profileSeries.ts`.
  it("are written by units.ts alone", () => {
    const files = SCANNED.flatMap(sourceFiles);
    // shared/src holds about 200 source files today: a directory this stops
    // reaching, or a filter that drops them all, cannot pass by finding none.
    // Parsing about 480 files takes seconds, hence the timeout below.
    expect(files.length).toBeGreaterThan(150);
    expect(files).toContain(UNITS_MODULE);
    // frontend/src holds about 280: dropping it from SCANNED turns this red.
    expect(
      files.filter((f) => f.startsWith("frontend/src/")).length,
    ).toBeGreaterThan(200);
    const found: string[] = [];
    for (const file of files) {
      if (file === UNITS_MODULE || file in NOT_YET) continue;
      for (const line of figureUnitLines(
        file,
        readFileSync(join(REPO, file), "utf8"),
      ))
        found.push(`${file}:${line}`);
    }
    expect(
      found,
      "a figure with a unit is written by units.ts: use formatDistance, formatHeight, formatSpeed, formatArea, formatBoxSize, formatHeightRange, formatFixedMetres, or lengthToInput with lengthUnitLabel",
    ).toEqual([]);
  }, 30_000);

  // Mutation: name `shared/src/numberFormat.ts`, which holds no figure, in
  // NOT_YET, or make `elements.ts` write its scale bar through units.ts and
  // leave its entry.
  it("names only files that still hold a figure", () => {
    expect(Object.keys(NOT_YET).length).toBeGreaterThan(0);
    for (const file of Object.keys(NOT_YET))
      expect(
        figureUnitLines(file, readFileSync(join(REPO, file), "utf8")).length,
        `${file} no longer writes a figure by hand: remove it from NOT_YET`,
      ).toBeGreaterThan(0);
  });

  // Mutation: `UNIT_AFTER` stops matching a space before the unit.
  it("still finds the figures in units.ts itself", () => {
    const text = readFileSync(join(REPO, UNITS_MODULE), "utf8");
    expect(figureUnitLines(UNITS_MODULE, text).length).toBeGreaterThan(8);
  });
});
