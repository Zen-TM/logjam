// The length limit on a switch's words (shared/DESIGN.md table), declared once
// for both clients. Each client's `switchCopy.test.ts` holds every switch row
// to it.
import type * as TypeScript from "typescript";

/** Characters: about a line each on a 360dp phone. Measured on a Galaxy S9, a
 *  hint fits ~27 beside an icon tile and ~33 without one; 30 is the one number
 *  that keeps hints short without tying copy to a row's layout. */
export const SWITCH_COPY_MAX = { label: 20, hint: 30 } as const;

/** A component that draws a switch row, and which of its props are the label
 *  and the hint. */
export type SwitchComponent = { tag: string; label: string; hint: string };

export type SwitchCopy = {
  file: string;
  line: number;
  role: "label" | "hint";
  text: string;
};

/**
 * Every label and hint of a switch row in `files` whose text is known before
 * run time. The type checker reads each prop, so a literal and copy declared
 * `as const` in `@logjam/shared` are both seen; a string built at run time (a
 * count, a name) types as `string` and is skipped, as it has no fixed length
 * to hold. Tags match by name, so a spread, an alias or `ui.SwitchRow` is not
 * seen (none exists).
 */
export function measureSwitchCopy(
  /** The caller's `typescript` module, typed loosely as in `copyRules.ts`. */
  tsModule: unknown,
  tsconfigPath: string,
  files: readonly string[],
  components: readonly SwitchComponent[],
): SwitchCopy[] {
  const ts = tsModule as typeof TypeScript;
  const config = ts.getParsedCommandLineOfConfigFile(
    tsconfigPath,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (!config) throw new Error(`Couldn't read ${tsconfigPath}`);
  const program = ts.createProgram(files, {
    ...config.options,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const byTag = new Map(components.map((c) => [c.tag, c]));
  const found: SwitchCopy[] = [];

  const literals = (type: TypeScript.Type): string[] =>
    type.isUnion()
      ? type.types.flatMap(literals)
      : type.isStringLiteral()
        ? [type.value]
        : [];

  // Each way a prop's words can arrive: `reason ?? "fallback"` types as
  // `string`, so its sides are read one by one or the fallback goes unseen.
  const texts = (expr: TypeScript.Expression): string[] => {
    if (ts.isParenthesizedExpression(expr)) return texts(expr.expression);
    if (ts.isConditionalExpression(expr))
      return [...texts(expr.whenTrue), ...texts(expr.whenFalse)];
    if (
      ts.isBinaryExpression(expr) &&
      (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    )
      return [...texts(expr.left), ...texts(expr.right)];
    // The checker widens a bare literal to `string`.
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))
      return [expr.text];
    return literals(checker.getTypeAtLocation(expr));
  };

  for (const file of files) {
    const sf = program.getSourceFile(file);
    if (!sf) throw new Error(`Not in the program: ${file}`);
    const visit = (node: TypeScript.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const component = byTag.get(node.tagName.getText(sf));
        for (const attr of component ? node.attributes.properties : []) {
          if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
          const name = attr.name.getText(sf);
          const role =
            name === component?.label
              ? "label"
              : name === component?.hint
                ? "hint"
                : null;
          if (!role) continue;
          const init = attr.initializer;
          const expr =
            ts.isJsxExpression(init) && init.expression
              ? init.expression
              : (init as TypeScript.Expression);
          for (const text of texts(expr))
            found.push({
              file,
              line:
                sf.getLineAndCharacterOfPosition(attr.getStart(sf)).line + 1,
              role,
              text,
            });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}
