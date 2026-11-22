import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// A sheet is a Modal, and a Modal's content is still a child of the screen
// that opened it as far as touches go. A vertical list under a sheet that
// leaves `keyboardShouldPersistTaps` at its default takes the first tap on a
// sheet's Save while a field is focused and only drops the keyboard: on a
// phone older than Android 11, even once the keyboard is hidden and the field
// is still focused (react-native's ScrollView).
// Mutation: delete the prop from PlanScreen's body ScrollView.
const LISTS = new Set([
  "ScrollView",
  "Animated.ScrollView",
  "FlatList",
  "SectionList",
  "HeroScrollView",
  "HeroFlatList",
  "HeroSectionList",
]);

// A list that never has a field under it, or a sheet's own body.
const EXEMPT: Record<string, string> = {
  "ConfirmHost.tsx": "a confirm's body: text only, no field to blur",
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [path]
      : [];
  });
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
        const attributes = node.attributes.properties.flatMap((property) =>
          ts.isJsxAttribute(property) ? [property.name.getText(source)] : [],
        );
        found.push({
          name,
          kept:
            attributes.includes("horizontal") ||
            attributes.includes("keyboardShouldPersistTaps"),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("a vertical list under a sheet", () => {
  it("lets a tap on the sheet through while a field is focused", () => {
    const root = new URL("..", import.meta.url).pathname;
    const all = sources(root).flatMap((file) =>
      lists(file).map((list) => ({ file: file.slice(root.length), ...list })),
    );
    // A scan that matches nothing proves nothing.
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(
      all
        .filter((list) => !list.kept && !(list.file in EXEMPT))
        .map((list) => `${list.file}: <${list.name}>`),
    ).toEqual([]);
  });
});
