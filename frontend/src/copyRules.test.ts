import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { copySay, copyViolations, userFacingStrings } from "@logjam/shared";

// The words a user reads on Logjam Web keep the copy rules of
// shared/DESIGN.md §12 (`COPY_RULES` in @logjam/shared): no "Retry", "the app",
// "basemap", "tiles" or "the server", and no Title Case label. The net is JSX
// text, the string props that carry words (`label`, `title`, `message`, …) and
// object properties of those names; a string reaching the user another way
// is a gap in the net, not a licence.
//
// A hit is fixed. One that is legitimate is listed with the reason.
// Mutation that turns it red: set `title` in `components/feedback/RootErrorBoundary.tsx`'s text
// back to "The app hit an unexpected error…"
const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED: { file: string; text: string; reason: string }[] = [
  {
    file: "components/dialogs/TopoDialog.tsx",
    text: "Order Data",
    reason:
      "the name of ELVIS's own button, which the step tells the user to press",
  },
  {
    file: "components/dialogs/TopoDialog.tsx",
    text: "Load File",
    reason:
      "the name of ELVIS's own button, which the step tells the user to press",
  },
  {
    file: "components/dialogs/TopoDialog.tsx",
    text: "Point Clouds",
    reason:
      "the name of ELVIS's own menu entry, which the step tells the user to open",
  },
  {
    file: "components/dialogs/TopoDialog.tsx",
    text: "select the specific tiles",
    reason:
      "ELVIS's own map draws its LiDAR tiles, and the user picks them there",
  },
];

/**
 * The words a JSX child expression can put on screen: `{a ? "x" : \`y ${n}\`}`.
 * `userFacingStrings` reads JSX text and the string props that carry words; a
 * string reaching the screen as a child expression's branch was outside that
 * net (a `tile` count sat there), so it is read here.
 */
function childExpressionStrings(
  path: string,
  text: string,
): { line: number; text: string }[] {
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: { line: number; text: string }[] = [];
  const leaves = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      found.push({
        line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: node.text,
      });
    else if (ts.isTemplateExpression(node))
      found.push({
        line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text:
          node.head.text +
          node.templateSpans.map((span) => span.literal.text).join(""),
      });
    else if (ts.isParenthesizedExpression(node)) leaves(node.expression);
    else if (ts.isConditionalExpression(node)) {
      leaves(node.whenTrue);
      leaves(node.whenFalse);
    } else if (ts.isBinaryExpression(node)) {
      leaves(node.left);
      leaves(node.right);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    )
      leaves(node.expression);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
      ? [path]
      : [];
  });
}

describe("copy on Logjam Web", () => {
  it("reads a string that is a JSX child expression's branch", () => {
    const [first] = childExpressionStrings(
      "x.tsx",
      'export const a = <p>{n ? `${n} tiles` : ""}</p>;',
    );
    expect(first.text).toContain("tiles");
  });

  it("reads the strings of the net — a silent zero would pass forever", () => {
    const [first] = userFacingStrings(
      ts,
      "x.tsx",
      'export const a = <Row title="Open it">Hello there</Row>;',
    );
    expect(first.text).toBe("Open it");
  });

  it("breaks no copy rule", () => {
    const offenders = sources(SRC).flatMap((path) =>
      userFacingStrings(ts, path, readFileSync(path, "utf8")).flatMap(
        ({ line, text }) =>
          copyViolations(text)
            .filter(
              () =>
                !ALLOWED.some(
                  (a) =>
                    relative(SRC, path) === a.file && text.includes(a.text),
                ),
            )
            .map(
              (id) =>
                `${relative(SRC, path)}:${line} "${text}" — ${copySay(id)}`,
            ),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("breaks no copy rule in a child expression either", () => {
    const offenders = sources(SRC).flatMap((path) =>
      path.endsWith(".tsx")
        ? childExpressionStrings(path, readFileSync(path, "utf8")).flatMap(
            ({ line, text }) =>
              copyViolations(text).map(
                (id) =>
                  `${relative(SRC, path)}:${line} "${text}" — ${copySay(id)}`,
              ),
          )
        : [],
    );
    expect(offenders).toEqual([]);
  });
});
