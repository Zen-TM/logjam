// The two halves of moving bare copy into the catalogue: `extractMessages`
// rewrites the literals the ratchet counts (what `bareCopyIn` reports) into `t`
// messages, and `textPieces` lists the text a file spells so a run can be held
// to leaving the English as it was. `scripts/i18n-extract.mjs` and
// `scripts/i18n-identity-check.mjs` drive them; i18nCodemod.test.ts holds what
// each rewrites, skips and reports.
import type * as TypeScript from "typescript";
import { templateKey } from "./i18n.js";
import { bareCopyIn, messageProblems } from "./i18nSource.js";

export type Skipped = { line: number; text: string; reason: string };

export type Extraction = {
  source: string;
  /** Messages written. */
  converted: number;
  /** What it left, each with why: a person writes these. */
  skipped: Skipped[];
};

type Edit = { start: number; end: number; text: string };

/** How a file under `shared/src` (path from the repo root) or any other package's imports `t`. */
export function importFor(repoPath: string): string {
  const inside = /^shared\/src\/(.*)$/.exec(repoPath);
  if (!inside) return "@logjam/shared";
  const depth = inside[1].split("/").length - 1;
  return `${depth ? "../".repeat(depth) : "./"}i18n.js`;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  times: "×",
  copy: "©",
  bull: "•",
};

/** JSX's entities decoded; undefined when one is not in `ENTITIES`, which leaves the text for a person. */
function decodeEntities(text: string): string | undefined {
  let unknown = false;
  const decoded = text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,
    (whole, name: string) => {
      if (name[0] !== "#") {
        const found = ENTITIES[name];
        if (found === undefined) unknown = true;
        return found ?? whole;
      }
      const code =
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number(name.slice(1));
      return String.fromCodePoint(code);
    },
  );
  return unknown ? undefined : decoded;
}

/**
 * What React renders for a piece of JSX text: the whitespace rules of Babel's
 * `cleanJSXElementLiteralChild`, then entities. Undefined where compilers
 * differ (an unknown entity; a tab inside a line, which TypeScript keeps and
 * Babel turns into a space), so a person reads it.
 */
function jsxText(raw: string): string | undefined {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = i;
  });
  let out = "";
  lines.forEach((line, i) => {
    let text = line;
    if (i !== 0) text = text.replace(/^[ \t]+/, "");
    if (i !== lines.length - 1) text = text.replace(/[ \t]+$/, "");
    if (text) out += i === lastNonEmpty ? text : `${text} `;
  });
  return out.includes("\t") ? undefined : decodeEntities(out);
}

/** Text for the inside of a template literal: what it reads back as is `text`. */
function inTemplate(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .split("\u00a0")
    .join("\\u00a0");
}

/** A condition that compares with a number picks between a singular and a plural. */
const COUNTS = /(?:[!=]==?|[<>]=?)\s*\d|\d\s*(?:[!=]==?|[<>]=?)/;

const UNREADABLE =
  "an unknown entity, a tab inside the text, or a line break in an attribute string: compilers read those differently";

const LEADING_NEWLINE = /^[ \t]*[\r\n]/;
const TRAILING_NEWLINE = /[\r\n][ \t]*$/;

/**
 * Rewrite the bare copy `bareCopyIn` counts as copy (and, with `words`, its
 * one-word labels) into `t` messages: JSX text and a run of it with its
 * `{expressions}`, a string or template in a copy prop, a toast's argument or a
 * copy property, each branch of a ternary. It leaves, and lists, what a person
 * must write: a sentence next to an element, a `+` chain, a plural ternary, a
 * fragment with a space at an end, a literal `{0}`, a template whose holes hold
 * words, an entity it cannot decode, a literal typed `as const`, and a place
 * where the file already has a `t` of its own. Prose outside the net is not
 * touched: those need a decision each.
 *
 * `importFrom` is where the file reads `t` from (`importFor`). The output is not
 * formatted; run `make format`.
 */
export function extractMessages(
  tsModule: unknown,
  fileName: string,
  source: string,
  options: { words?: boolean; importFrom?: string } = {},
): Extraction {
  const ts = tsModule as typeof TypeScript;
  const importFrom = options.importFrom ?? "@logjam/shared";
  const wanted = new Set(
    bareCopyIn(ts, fileName, source, { words: options.words })
      .filter((found) => found.why !== "prose")
      .map((found) => found.start),
  );
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits: Edit[] = [];
  const skipped: Skipped[] = [];
  const skip = (at: number, text: string, reason: string) =>
    void skipped.push({
      line: sf.getLineAndCharacterOfPosition(at).line + 1,
      text,
      reason,
    });

  // A `t` of the file's own (a parameter, a variable) hides the message
  // function inside its scope, so nothing is written there.
  const ownT: TypeScript.Node[] = [];
  const bindsT = (node: TypeScript.Node): boolean =>
    (ts.isParameter(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isBindingElement(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node)) &&
    !!node.name &&
    ts.isIdentifier(node.name) &&
    node.name.text === "t";
  const scopeOf = (node: TypeScript.Node): TypeScript.Node => {
    let at = node.parent;
    while (
      at.parent &&
      !ts.isBlock(at) &&
      !ts.isFunctionLike(at) &&
      !ts.isCatchClause(at) &&
      !ts.isIterationStatement(at, false) &&
      !ts.isCaseBlock(at)
    )
      at = at.parent;
    return at;
  };
  const findT = (node: TypeScript.Node): void => {
    if (bindsT(node))
      ownT.push(ts.isParameter(node) ? node.parent : scopeOf(node));
    ts.forEachChild(node, findT);
  };
  findT(sf);
  // An import is a binding for the whole file. The one that is not another
  // `t` is the shared package's own, unaliased and not type-only.
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const { importClause } = statement;
    const bound = [
      importClause.name,
      ...(importClause.namedBindings
        ? ts.isNamespaceImport(importClause.namedBindings)
          ? [importClause.namedBindings.name]
          : importClause.namedBindings.elements.map((e) => e.name)
        : []),
    ].filter((name) => name?.text === "t");
    const ours =
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === importFrom &&
      !importClause.isTypeOnly &&
      !importClause.name &&
      !!importClause.namedBindings &&
      ts.isNamedImports(importClause.namedBindings) &&
      importClause.namedBindings.elements.every(
        (e) => e.name.text !== "t" || (!e.propertyName && !e.isTypeOnly),
      );
    if (bound.length && !ours) ownT.push(sf);
  }
  const hidden = (at: number) =>
    ownT.some((scope) => at >= scope.getStart() && at < scope.end);

  const write = (edit: Edit, text: string, reason?: string) => {
    if (!reason && hidden(edit.start))
      reason = "this file has a `t` of its own here: rename it, then run again";
    if (reason) skip(edit.start, text, reason);
    else edits.push(edit);
  };

  const outer = (node: TypeScript.Node): TypeScript.Node => {
    let at = node;
    while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
    return at;
  };
  /** Why a literal or template cannot be a message on its own, from where it stands. */
  const placement = (node: TypeScript.Node): string | undefined => {
    if (
      ts.isTaggedTemplateExpression(node.parent) &&
      node.parent.template === node
    )
      return `the text of a ${node.parent.tag.getText()} tag, which is not a sentence for t`;
    let at = outer(node);
    const parent = at.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.PlusToken
    )
      return "joined with +: write the whole sentence as one message";
    if (
      ts.isAsExpression(parent) &&
      ts.isTypeReferenceNode(parent.type) &&
      parent.type.typeName.getText() === "const"
    )
      return "typed `as const`: a message is a string, not a literal type";
    while (
      ts.isConditionalExpression(at.parent) &&
      (at.parent.whenTrue === at || at.parent.whenFalse === at)
    ) {
      if (COUNTS.test(at.parent.condition.getText()))
        return "a plural ternary: write it with plural";
      at = outer(at.parent);
    }
    return undefined;
  };
  const hasWords = (node: TypeScript.Node): boolean => {
    let found = false;
    const look = (n: TypeScript.Node) => {
      if (
        (ts.isStringLiteralLike(n) ||
          ts.isTemplateHead(n) ||
          ts.isTemplateMiddle(n) ||
          ts.isTemplateTail(n) ||
          ts.isJsxText(n)) &&
        /\p{L}/u.test(n.text)
      )
        found = true;
      if (!found) ts.forEachChild(n, look);
    };
    look(node);
    return found;
  };
  const hasJsx = (node: TypeScript.Node): boolean => {
    let found = false;
    const look = (n: TypeScript.Node) => {
      if (
        ts.isJsxElement(n) ||
        ts.isJsxSelfClosingElement(n) ||
        ts.isJsxFragment(n)
      )
        found = true;
      if (!found) ts.forEachChild(n, look);
    };
    look(node);
    return found;
  };

  const literal = (node: TypeScript.StringLiteralLike): void => {
    const attribute = ts.isJsxAttribute(node.parent);
    const text = attribute ? decodeEntities(node.text) : node.text;
    const start = node.getStart();
    // TypeScript keeps a line break in an attribute string; Babel folds it and
    // the indent after it to one space.
    if (text === undefined || (attribute && /[\r\n]/.test(text)))
      return skip(start, node.text, UNREADABLE);
    const message = `t\`${inTemplate(text)}\``;
    write(
      {
        start,
        end: node.end,
        text: attribute ? `{${message}}` : message,
      },
      text,
      placement(node) ?? messageProblems("t", text, [text])[0],
    );
  };

  const template = (node: TypeScript.TemplateExpression): void => {
    const parts = [
      node.head.text,
      ...node.templateSpans.map((span) => span.literal.text),
    ];
    const key = templateKey(parts);
    write(
      { start: node.getStart(), end: node.getStart(), text: "t" },
      key,
      placement(node) ??
        (node.templateSpans.some((span) => hasWords(span.expression))
          ? "a hole holds words of its own: write them into the sentence"
          : messageProblems("t", key, parts)[0]),
    );
  };

  /** The children of a JSX parent: a run of text and plain `{expressions}` is one sentence; an element, a comment or a `{"string"}` ends it. */
  const children = (list: TypeScript.NodeArray<TypeScript.JsxChild>): void => {
    const plainHole = (child: TypeScript.JsxChild) =>
      ts.isJsxExpression(child) &&
      !!child.expression &&
      !child.dotDotDotToken &&
      !ts.isStringLiteralLike(child.expression) &&
      !hasJsx(child.expression) &&
      !hasWords(child.expression);
    const inRun = (child: TypeScript.JsxChild) =>
      ts.isJsxText(child) || plainHole(child);
    for (let from = 0; from < list.length; ) {
      if (!inRun(list[from])) {
        from++;
        continue;
      }
      let to = from;
      while (to < list.length && inRun(list[to])) to++;
      const run = list.slice(from, to);
      from = to;
      const first = run.find(
        (child) => ts.isJsxText(child) && wanted.has(child.getStart()),
      );
      if (!first) continue;
      const parts = [""];
      const holes: string[] = [];
      let unknown = false;
      for (const child of run) {
        if (ts.isJsxText(child)) {
          const text = jsxText(source.slice(child.pos, child.end));
          if (text === undefined) unknown = true;
          else parts[parts.length - 1] += text;
        } else if (ts.isJsxExpression(child) && child.expression) {
          holes.push(child.expression.getText());
          parts.push("");
        }
      }
      const key = templateKey(parts);
      if (unknown) skip(first.getStart(), key, UNREADABLE);
      else {
        const before = list[list.indexOf(run[0]) - 1];
        const after = list[list.indexOf(run[run.length - 1]) + 1];
        const firstRaw = ts.isJsxText(run[0])
          ? source.slice(run[0].pos, run[0].end)
          : "";
        const lastRaw = ts.isJsxText(run[run.length - 1])
          ? source.slice(run[run.length - 1].pos, run[run.length - 1].end)
          : "";
        const problem = messageProblems("t", key, parts)[0];
        const beside = !!(before || after);
        write(
          {
            start: ts.isJsxText(run[0]) ? run[0].pos : run[0].getStart(),
            end: run[run.length - 1].end,
            text: `{t\`${parts
              .map(
                (part, i) =>
                  inTemplate(part) +
                  (i < holes.length ? `\${${holes[i]}}` : ""),
              )
              .join("")}\`}`,
          },
          key,
          (before && !LEADING_NEWLINE.test(firstRaw)) ||
            (after && !TRAILING_NEWLINE.test(lastRaw))
            ? "touches an element: write the sentence whole with rich"
            : problem && beside && key !== key.trim()
              ? "next to an element: write the sentence whole with rich"
              : problem,
        );
      }
    }
  };

  const visit = (node: TypeScript.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node))
      children(node.children);
    else if (ts.isStringLiteralLike(node) && wanted.has(node.getStart()))
      literal(node);
    else if (
      ts.isTemplateExpression(node) &&
      [node.head, ...node.templateSpans.map((span) => span.literal)].some(
        (part) => wanted.has(part.getStart()),
      )
    )
      template(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!edits.length) return { source, converted: 0, skipped };
  const imported = importEdit(ts, sf, importFrom);
  if (imported) edits.push(imported);
  let out = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start))
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return {
    source: out,
    converted: edits.length - (imported ? 1 : 0),
    skipped,
  };
}

/** The edit that makes `t` available: added to an import already there from `importFrom`, else a new import after the last. */
function importEdit(
  ts: typeof TypeScript,
  sf: TypeScript.SourceFile,
  importFrom: string,
): Edit | undefined {
  const imports = sf.statements.filter(ts.isImportDeclaration);
  for (const statement of imports) {
    const bindings = statement.importClause?.namedBindings;
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== importFrom ||
      statement.importClause?.isTypeOnly ||
      !bindings ||
      !ts.isNamedImports(bindings) ||
      !bindings.elements.length
    )
      continue;
    if (bindings.elements.some((element) => element.name.text === "t"))
      return undefined;
    const end = bindings.elements[bindings.elements.length - 1].end;
    return { start: end, end, text: ", t" };
  }
  const line = `import { t } from "${importFrom}";`;
  const last = imports[imports.length - 1];
  if (last) return { start: last.end, end: last.end, text: `\n${line}` };
  const start = sf.statements[0]?.getStart() ?? 0;
  return { start, end: start, text: `${line}\n` };
}

/**
 * The text a file spells, as the pieces its compiled form holds: every string
 * and every literal part of a template, in order, once JSX has been compiled
 * (so TypeScript's own whitespace and entity rules say what a JSX text is, not
 * this file's). A `t` message's pieces are the pieces of the literal it came
 * from, so a run that only moves copy into the catalogue leaves them as they
 * were. Pieces are compared as a multiset (`pieceChanges`, each piece with its count): neither their
 * order nor the expressions between them is looked at.
 */
export function textPieces(
  tsModule: unknown,
  fileName: string,
  source: string,
): string[] {
  const ts = tsModule as typeof TypeScript;
  const js = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const sf = ts.createSourceFile(
    "pieces.js",
    js,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const pieces: string[] = [];
  const visit = (node: TypeScript.Node): void => {
    // A module specifier is not text a user reads, and a new import is the
    // one thing every rewrite adds.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteralLike(node)) pieces.push(node.text);
    else if (ts.isTemplateExpression(node))
      pieces.push(
        node.head.text,
        ...node.templateSpans.map((span) => span.literal.text),
      );
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return pieces.filter((piece) => piece !== "");
}

/**
 * The source files a text check reads from `git diff --name-status -M` output:
 * those added, modified or renamed, each with the path it had at the base (a
 * rename's old path; a new file's own, which the base does not have).
 */
export function changedFiles(
  nameStatus: string,
): { path: string; from: string }[] {
  return nameStatus.split("\n").flatMap((line) => {
    const [status, first, second] = line.split("\t");
    if (!/^[AMR]/.test(status ?? "")) return [];
    const path = second ?? first;
    return /\.tsx?$/.test(path) && !/\.d\.ts$/.test(path)
      ? [{ path, from: first }]
      : [];
  });
}

/** The pieces `before` has that `after` lacks, and the pieces `after` has that `before` lacks, each as many times as they differ. A reworded piece is one of each. */
export function pieceChanges(
  before: readonly string[],
  after: readonly string[],
): { removed: string[]; added: string[] } {
  const left = new Map<string, number>();
  for (const piece of before) left.set(piece, (left.get(piece) ?? 0) + 1);
  const added: string[] = [];
  for (const piece of after) {
    const count = left.get(piece) ?? 0;
    if (count) left.set(piece, count - 1);
    else added.push(piece);
  }
  const removed = [...left].flatMap(([piece, count]) =>
    Array<string>(count).fill(piece),
  );
  return { removed, added };
}
