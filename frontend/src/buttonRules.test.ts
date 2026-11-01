import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// shared/DESIGN.md §5: "Submit is never disabled for validation: pressing it is
// how the user learns what is missing." A surface's primary action (a filled or
// destructive `Button`, or any `type="submit"`) is busy while its request runs
// (`busy`) and is never `disabled` — so there is no validity expression to put
// there. The few that must stay disabled are listed with the reason.
//
// Mutation that turns it red: add `disabled={!name.trim()}` to the filled Save
// button of `components/dialogs/RouteNameDialog.tsx`.
const SRC = dirname(fileURLToPath(import.meta.url));

const ALLOWED: { file: string; reason: string }[] = [
  {
    file: "components/dialogs/DeleteAccountDialog.tsx",
    reason: "type-to-confirm: the user's own words are the confirmation",
  },
  {
    file: "components/plans/PlanDetailPanel.tsx",
    reason: "Add a form at the cap of 20: a limit, not validation, and says so",
  },
  {
    file: "components/dialogs/SelectedPlacesDialog.tsx",
    reason: "share and delete are one at a time: one in flight locks the other",
  },
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [path]
      : [];
  });
}

/** Every disabled primary `<Button>` in a source text: "line: reason". */
function disabledPrimaries(path: string, text: string): string[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText() === "Button") {
        const literal = (name: string) => {
          const attr = node.attributes.properties.find(
            (p): p is ts.JsxAttribute =>
              ts.isJsxAttribute(p) && p.name.getText() === name,
          );
          return attr?.initializer && ts.isStringLiteral(attr.initializer)
            ? attr.initializer.text
            : undefined;
        };
        const has = (name: string) =>
          node.attributes.properties.some(
            (p) => ts.isJsxAttribute(p) && p.name.getText() === name,
          );
        const primary =
          ["filled", "destructive"].includes(literal("variant") ?? "") ||
          literal("type") === "submit";
        if (primary && has("disabled")) {
          const { line } = file.getLineAndCharacterOfPosition(node.getStart());
          hits.push(`${line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}

describe("a primary action is never disabled for validation", () => {
  it("finds a disabled primary Button — a silent zero would pass forever", () => {
    const source = [
      "export const a = (",
      '  <Button variant="filled" disabled={!name}>Save</Button>',
      ");",
      'export const b = <Button type="submit" disabled={x}>Go</Button>;',
      "export const c = <Button disabled={x}>Cancel</Button>;",
      'export const d = <Button variant="filled" busy={x}>Save</Button>;',
    ].join("\n");
    expect(disabledPrimaries("x.tsx", source)).toEqual(["2", "4"]);
  });

  it("is true of every Button in the source", () => {
    const offenders = sources(SRC).flatMap((path) => {
      const name = relative(SRC, path);
      if (ALLOWED.some((a) => a.file === name)) return [];
      return disabledPrimaries(path, readFileSync(path, "utf8")).map(
        (line) =>
          `${name}:${line} — press-to-explain, or \`busy\`, not disabled`,
      );
    });
    expect(offenders).toEqual([]);
  });

  it("lists only files that still have one", () => {
    const stale = ALLOWED.filter(
      (a) =>
        disabledPrimaries(a.file, readFileSync(join(SRC, a.file), "utf8"))
          .length === 0,
    ).map((a) => a.file);
    expect(stale).toEqual([]);
  });
});
