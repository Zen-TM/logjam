import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// shared/DESIGN.md §4: the coordinates are the copy control, never a separate
// button. This holds the lazy half: a button-like element in either client's
// source whose own text (label, children or handler) says "copy ... coordinates",
// including `tripPlanCopyCoordinatesLabel(...)`. It cannot see a label held in
// a variable, a differently worded one ("Copy position") or an icon-only copy
// button; the render tests that press the coordinates on each page cover the
// wiring.
//
// Mutation that turns it red: put an `<IconButton label="Copy the coordinates
// of …" />` or `label={tripPlanCopyCoordinatesLabel(name)}` back in
// `PlaceDetailPanel.tsx` or `PlanPlacePage.tsx`, or a
// `<Button>Copy coordinates</Button>` anywhere in `frontend/src` or
// `mobile/src`.
const CONTROLS = new Set([
  "IconButton",
  "Button",
  "button",
  "Pressable",
  "TouchableOpacity",
]);
const COPY_COORDINATES = /copy[\s\S]{0,12}coordinates/i;

function sourceFiles(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((file) => /\.tsx$/.test(file) && !/\.test\./.test(file))
    .map((file) => join(root, file));
}

/** Every control element whose own text, props included, says copy coordinates. */
function scan(file: string, text: string): string[] {
  const tree = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = ts.isJsxElement(node)
        ? node.openingElement.tagName
        : node.tagName;
      if (CONTROLS.has(tag.getText()) && COPY_COORDINATES.test(node.getText()))
        found.push(
          `${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe("coordinates copy where they are pressed", () => {
  const roots = ["frontend", "mobile"].map((pkg) =>
    join(import.meta.dirname, "../..", pkg, "src"),
  );

  it("reads both clients' source", () => {
    expect(roots.flatMap(sourceFiles).length).toBeGreaterThan(100);
  });

  it("has no copy-coordinates button in either client", () => {
    expect(
      roots
        .flatMap(sourceFiles)
        .flatMap((file) => scan(file, readFileSync(file, "utf8"))),
    ).toEqual([]);
  });

  it.each([
    `<IconButton icon="copy" label="Copy the coordinates of X" />`,
    `<IconButton icon="copy" label={tripPlanCopyCoordinatesLabel(x)} />`,
    `<Button onPress={copyCoordinates}>Copy</Button>`,
  ])("sees a copy-coordinates button in %s", (jsx) => {
    expect(scan("probe.tsx", `const a = ${jsx};`)).toEqual(["probe.tsx:1"]);
  });
});
