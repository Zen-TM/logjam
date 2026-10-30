// The length limit on a switch's words (shared/DESIGN.md table), declared once
// for both clients. Each client's `switchCopy.test.ts` holds every switch row
// to it.
import type * as TypeScript from "typescript";

/** Characters: the label one line and the hint one line on a 360dp phone,
 *  measured on a Galaxy S9 ("Canyon leaderboard" fits; "Save photos to your
 *  gallery" wraps). */
export const SWITCH_COPY_MAX = { label: 20, hint: 30 } as const;

/** A component that draws a switch row, and which of its props are the label
 *  and the hint. */
export type SwitchComponent = { tag: string; label: string; hint: string };

export type SwitchCopyHit = {
  file: string;
  line: number;
  role: "label" | "hint";
  text: string;
};

/**
 * Every label and hint of a switch row in `files` longer than
 * `SWITCH_COPY_MAX`. The type checker reads each prop, so a literal and copy
 * declared `as const` in `@logjam/shared` are both seen; a string built at run
 * time (a count, a name) types as `string` and is skipped, as it has no fixed
 * length to hold.
 */
export function switchCopyOverLimit(
  /** The caller's `typescript` module, typed loosely as in `copyRules.ts`. */
  tsModule: unknown,
  tsconfigPath: string,
  files: readonly string[],
  components: readonly SwitchComponent[],
): SwitchCopyHit[] {
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
  const hits: SwitchCopyHit[] = [];

  const literals = (type: TypeScript.Type): string[] =>
    type.isUnion()
      ? type.types.flatMap(literals)
      : type.isStringLiteral()
        ? [type.value]
        : [];

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
              : init;
          // The checker widens a bare attribute literal to `string`.
          const texts =
            ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)
              ? [expr.text]
              : literals(checker.getTypeAtLocation(expr));
          for (const text of texts)
            if (text.length > SWITCH_COPY_MAX[role])
              hits.push({
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
  return hits;
}
