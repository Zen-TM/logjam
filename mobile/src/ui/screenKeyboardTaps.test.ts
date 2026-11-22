import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// A sheet is a Modal, and a Modal's content is still a child of the screen
// that opened it as far as touches go. A list under a sheet that leaves
// `keyboardShouldPersistTaps` at its default takes the first tap on a sheet's
// Save (or on a chip in a rail beside the field) while a field is focused and
// only drops the keyboard: on a phone older than Android 11, even once the
// keyboard is hidden and the field is still focused (react-native's
// ScrollView). Horizontal lists count too.
// Mutation: set `keyboardShouldPersistTaps="never"` on PlanScreen's body
// ScrollView, or delete the prop from ChipRail.
const LISTS = new Set([
  "ScrollView",
  "Animated.ScrollView",
  "FlatList",
  "SectionList",
  "HeroScrollView",
  "HeroFlatList",
  "HeroSectionList",
]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [path]
      : [];
  });
}

// Only "handled" and "always" let a tap through; anything else, a variable
// included, is not proof.
function letsTapsThrough(property: ts.JsxAttribute): boolean {
  const init = property.initializer;
  if (init && ts.isStringLiteral(init))
    return init.text === "handled" || init.text === "always";
  if (
    init &&
    ts.isJsxExpression(init) &&
    init.expression &&
    ts.isStringLiteralLike(init.expression)
  )
    return (
      init.expression.text === "handled" || init.expression.text === "always"
    );
  return false;
}

function lists(file: string): { name: string; kept: boolean }[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: { name: string; kept: boolean }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(source);
      if (LISTS.has(name)) {
        found.push({
          name,
          kept: node.attributes.properties.some(
            (property) =>
              ts.isJsxAttribute(property) &&
              property.name.getText(source) === "keyboardShouldPersistTaps" &&
              letsTapsThrough(property),
          ),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("a scrolling list", () => {
  it("lets a tap through while a field is focused", () => {
    const root = new URL("..", import.meta.url).pathname;
    const all = sources(root).flatMap((file) =>
      lists(file).map((list) => ({ file: file.slice(root.length), ...list })),
    );
    // A scan that matches nothing proves nothing.
    expect(all.length).toBeGreaterThanOrEqual(29);
    expect(
      all
        .filter((list) => !list.kept)
        .map((list) => `${list.file}: <${list.name}>`),
    ).toEqual([]);
  });
});
