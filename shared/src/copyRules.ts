// The copy rules of shared/DESIGN.md §12 that a machine can check, declared
// once for both clients. `copyRules.test.ts` holds every string in
// `contracts/` and in each client's JSX to them; a hit is fixed, or listed in
// the test's allow-list with the reason it is legitimate.
import type * as TypeScript from "typescript";

export type CopyRule = {
  id: string;
  /** Matches the words the rule forbids. */
  pattern: RegExp;
  /** What to write instead, in the message a failing test prints. */
  say: string;
};

export const COPY_RULES: readonly CopyRule[] = [
  {
    id: "retry",
    pattern: /\bretry\b/i,
    say: 'Say "Try again", and only where trying again can help.',
  },
  {
    id: "the-app",
    pattern: /\bthe (?:web )?app\b/i,
    say: "Name the surface: Logjam Web or Logjam GPS.",
  },
  {
    id: "basemap",
    pattern: /\bbase ?maps?\b/i,
    say: 'Say "map" or "map data", never "basemap".',
  },
  {
    id: "tiles",
    pattern: /\btiles?\b/i,
    say: 'Say "map" or "map data", never "tiles".',
  },
  {
    id: "the-server",
    pattern: /\bthe server\b/i,
    say: 'Say what failed in our words ("Couldn\'t reach Logjam"), not where it ran.',
  },
];

/** Two or more plain Capitalised Words: a Title Case label. Sentence case is
 *  the rule (§12). A word with an inner capital (GeoPDFs, LiDAR) or all
 *  capitals (GPS) is a name or an acronym, and is not one of these words. */
const TITLE_CASE = /^[A-Z][a-z’']+(?: [A-Z][a-z’']+)+$/;

export const TITLE_CASE_SAY = 'Sentence case: "Mark all as read".';

/** The ids of the rules `text` breaks (`title-case` for a Title Case label). */
export function copyViolations(text: string): string[] {
  const hits = COPY_RULES.filter((rule) => rule.pattern.test(text)).map(
    (rule) => rule.id,
  );
  // A surface's name is capitalised in a sentence-case line.
  const words = text.trim().replace(/\bLogjam (?:Web|GPS)\b/g, "x");
  if (TITLE_CASE.test(words)) hits.push("title-case");
  return hits;
}

/** What each rule id asks for, for a failure message. */
export function copySay(id: string): string {
  return id === "title-case"
    ? TITLE_CASE_SAY
    : (COPY_RULES.find((rule) => rule.id === id)?.say ?? "");
}

/** JSX attributes and object properties whose string is words a user reads. */
const COPY_PROPS = new Set([
  "label",
  "title",
  "subtitle",
  "description",
  "hint",
  "placeholder",
  "message",
  "accessibilityLabel",
  "accessibilityHint",
  "aria-label",
  "emptyTitle",
  "emptyBody",
  "body",
  "note",
  "caption",
]);

/**
 * The strings in a source file that a user reads: JSX text, a JSX attribute
 * named in `COPY_PROPS`, and an object property named in it. A template's
 * `${}` holes are left out. Not every user-facing string is one of these (a
 * `throw new Error("…")` reaches the user through a screen that may reword it),
 * which is why the net is words, not files: a miss is a gap in the net, never a
 * licence.
 */
export function userFacingStrings(
  /** The caller's `typescript` module. Typed loosely: each package pins its
   *  own version, and their `Node` types do not unify. */
  tsModule: unknown,
  fileName: string,
  source: string,
): { line: number; text: string }[] {
  const ts = tsModule as typeof TypeScript;
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: { line: number; text: string }[] = [];
  const stringOf = (node: TypeScript.Node): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return node.text;
    if (ts.isTemplateExpression(node))
      return (
        node.head.text + node.templateSpans.map((s) => s.literal.text).join("")
      );
    return null;
  };
  const visit = (node: TypeScript.Node): void => {
    let text: string | null = null;
    if (ts.isJsxText(node)) text = node.text.trim();
    else if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      COPY_PROPS.has(node.name.getText())
    ) {
      const init = node.initializer;
      text = stringOf(
        ts.isJsxExpression(init) && init.expression ? init.expression : init,
      );
    } else if (
      ts.isPropertyAssignment(node) &&
      COPY_PROPS.has(node.name.getText().replace(/["']/g, ""))
    )
      text = stringOf(node.initializer);
    if (text)
      found.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text,
      });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
