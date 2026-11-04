import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Coordinates copy where they are pressed (the Position stat, a pressable
// Row), never from a button beside them: one rule for every coordinates card
// in both clients, as Logjam GPS's place page already did.
//
// Mutation that turns it red: put an `<IconButton label="Copy the coordinates
// of …" />` back in `PlaceDetailPanel.tsx` or `PlanPlacePage.tsx`, or a
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

  it("sees a copy-coordinates button when there is one", () => {
    const src = `const a = <IconButton icon="copy" label="Copy the coordinates of X" />;`;
    expect(scan("probe.tsx", src)).toEqual(["probe.tsx:1"]);
  });
});
