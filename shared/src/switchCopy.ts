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
 * run time: a literal, a `t` message with no holes, a member of a value
 * `@logjam/shared` exports (read from `contracts`, its runtime exports, since a
 * contract's text is a `t` call that types as `string`), or a literal type. A
 * member is found through a `const` alias (`const copy = X.copy`), a computed
 * key of literal type (`X.copy[key]`) and a callback's parameter over an array
 * the package exports (`LIST.filter(…).map(({ label }) => …)`). A string built
 * at run time (a count, a name) is skipped, as it has no fixed length to hold.
 * Tags match by name, so a spread, an alias or `ui.SwitchRow` is not seen
 * (none exists).
 */
export function measureSwitchCopy(
  /** The caller's `typescript` module, typed loosely as in `copyRules.ts`. */
  tsModule: unknown,
  tsconfigPath: string,
  files: readonly string[],
  components: readonly SwitchComponent[],
  /** What `@logjam/shared` exports at run time: `import * as shared from "@logjam/shared"`. */
  contracts: Readonly<Record<string, unknown>>,
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

  const MAX_DEPTH = 12;
  /** Array methods whose callback is handed each item: the name a switch's words are read through (`LIST.map(({ label }) => …)`). */
  const ARRAY_WALKS = new Set([
    "map",
    "filter",
    "flatMap",
    "forEach",
    "some",
    "every",
    "find",
  ]);
  /** Array methods that return the same items, fewer or reordered: a walk over the result is a walk over the original. Not `map`, `flatMap` or `find`, whose result is something else. */
  const KEEPS_ITEMS = new Set([
    "filter",
    "slice",
    "sort",
    "toSorted",
    "reverse",
    "toReversed",
  ]);
  /** What an expression holds at run time, one value per way it may be reached; `undefined` where it is not one this can follow. */
  const valuesOf = (
    expr: TypeScript.Node,
    depth = 0,
  ): unknown[] | undefined => {
    if (depth > MAX_DEPTH) return undefined;
    const next = (node: TypeScript.Node) => valuesOf(node, depth + 1);
    if (
      ts.isParenthesizedExpression(expr) ||
      ts.isAsExpression(expr) ||
      ts.isSatisfiesExpression(expr) ||
      ts.isNonNullExpression(expr)
    )
      return next(expr.expression);
    if (ts.isIdentifier(expr)) {
      const symbol = checker.getSymbolAtLocation(expr);
      const declaration = symbol?.declarations?.[0];
      if (!declaration) return undefined;
      if (
        ts.isImportSpecifier(declaration) &&
        ts.isStringLiteral(declaration.parent.parent.parent.moduleSpecifier) &&
        declaration.parent.parent.parent.moduleSpecifier.text ===
          "@logjam/shared"
      ) {
        const name = (declaration.propertyName ?? declaration.name).text;
        return name in contracts ? [contracts[name]] : undefined;
      }
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        ts.isVariableDeclarationList(declaration.parent) &&
        declaration.parent.flags & ts.NodeFlags.Const
      )
        return next(declaration.initializer);
      if (ts.isParameter(declaration) || ts.isBindingElement(declaration))
        return bound(declaration, depth + 1);
      return undefined;
    }
    if (ts.isPropertyAccessExpression(expr))
      return next(expr.expression)?.map(
        (value) =>
          (value as Record<string, unknown> | undefined)?.[expr.name.text],
      );
    if (ts.isElementAccessExpression(expr)) {
      const keys = literals(checker.getTypeAtLocation(expr.argumentExpression));
      return keys.length
        ? next(expr.expression)?.flatMap((value) =>
            keys.map((key) => (value as Record<string, unknown>)?.[key]),
          )
        : undefined;
    }
    // A call that returns some of the same items: `LIST.filter(…)` holds what `LIST` does.
    if (
      ts.isCallExpression(expr) &&
      ts.isPropertyAccessExpression(expr.expression) &&
      KEEPS_ITEMS.has(expr.expression.name.text)
    )
      return next(expr.expression.expression);
    return undefined;
  };

  /** What a name declared by destructuring holds, or a callback's parameter: each item of the array the callback walks. */
  const bound = (
    declaration: TypeScript.ParameterDeclaration | TypeScript.BindingElement,
    depth: number,
  ): unknown[] | undefined => {
    if (ts.isBindingElement(declaration)) {
      if (!ts.isObjectBindingPattern(declaration.parent)) return undefined;
      const holder = declaration.parent.parent;
      const key = (declaration.propertyName ?? declaration.name).getText();
      // `const { copy } = X`, or a parameter's, or a name inside one of those.
      const held = ts.isVariableDeclaration(holder)
        ? holder.initializer &&
          ts.isVariableDeclarationList(holder.parent) &&
          holder.parent.flags & ts.NodeFlags.Const
          ? valuesOf(holder.initializer, depth + 1)
          : undefined
        : bound(holder, depth + 1);
      return held?.map(
        (value) => (value as Record<string, unknown> | undefined)?.[key],
      );
    }
    const fn = declaration.parent;
    const call = fn.parent;
    if (
      !ts.isArrowFunction(fn) ||
      fn.parameters[0] !== declaration ||
      !ts.isCallExpression(call) ||
      call.arguments[0] !== fn ||
      !ts.isPropertyAccessExpression(call.expression) ||
      !ARRAY_WALKS.has(call.expression.name.text)
    )
      return undefined;
    return valuesOf(call.expression.expression, depth + 1)?.flatMap((value) =>
      Array.isArray(value) ? value : [],
    );
  };

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
    if (
      ts.isTaggedTemplateExpression(expr) &&
      expr.tag.getText(expr.getSourceFile()) === "t"
    )
      return ts.isNoSubstitutionTemplateLiteral(expr.template)
        ? [expr.template.text]
        : [];
    const read = valuesOf(expr)?.filter(
      (value): value is string => typeof value === "string",
    );
    if (read?.length) return read;
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
