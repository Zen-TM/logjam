// What the i18n guards read from source: every message (`t`, `plural`, `rich`,
// `say`) with its key, and every bare literal a user may read that skipped them.
// The guards are `i18nCoverage.test.ts` in each package; the reasoning is
// docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md.
import type * as TypeScript from "typescript";
import {
  COPY_CALLS,
  COPY_PROPS,
  MESSAGE_TAGS,
  pluralNames,
} from "./copyRules.js";
import { type Catalogue, RICH_TAG, templateKey } from "./i18n.js";

/** Where the reasoning for the guards that read this scan lives. */
export const I18N_ADR =
  "docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md";

export type MessageKind = "t" | "say" | "rich" | "plural";

export type SourceMessage = {
  line: number;
  kind: MessageKind;
  /** The catalogue key: the English with each hole written `{0}`, `{1}`, … (a plural's is its `other` form). */
  key: string;
  /** What is wrong with it, from `messageProblems`; empty when it is fine. */
  problems: string[];
};

const loadFile = (
  ts: typeof TypeScript,
  fileName: string,
  source: string,
): TypeScript.SourceFile =>
  ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/** The literal parts of a template: one for a plain one, else head, then each span's. */
function templateParts(
  ts: typeof TypeScript,
  template: TypeScript.TemplateLiteral,
): string[] {
  return ts.isNoSubstitutionTemplateLiteral(template)
    ? [template.text]
    : [
        template.head.text,
        ...template.templateSpans.map((s) => s.literal.text),
      ];
}

/** What a message's key must not be, or hold. `parts` are the literal parts of a template, which hold no `{0}` of their own (a plural's strings do, so it passes none), and `key` the catalogue key. */
export function messageProblems(
  kind: MessageKind,
  key: string,
  parts: readonly string[],
): string[] {
  const problems: string[] = [];
  if (key !== key.trim())
    problems.push(
      "starts or ends with a space: a sentence glued from fragments can't be translated",
    );
  if (parts.some((part) => /\{\d+\}/.test(part)))
    problems.push("holds a literal {0}, which the catalogue reads as a hole");
  if (kind === "plural" && !key.includes("#"))
    problems.push("a plural's other form holds no # for the count");
  if (kind === "rich" && key.replace(RICH_TAG, "").match(/[<>]/))
    problems.push(
      "holds a tag rich can't consume (nested, unclosed, or a stray < or >)",
    );
  return problems;
}

/**
 * Every message in a source file, with its key. A `plural` whose two forms
 * are not literals has no key to look up, so it is reported with the problem
 * rather than skipped.
 */
export function messagesIn(
  tsModule: unknown,
  fileName: string,
  source: string,
): SourceMessage[] {
  const ts = tsModule as typeof TypeScript;
  const sf = loadFile(ts, fileName, source);
  const found: SourceMessage[] = [];
  const plurals = pluralNames(ts, sf);
  const lineOf = (node: TypeScript.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const visit = (node: TypeScript.Node): void => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      MESSAGE_TAGS.has(node.tag.getText())
    ) {
      const parts = templateParts(ts, node.template);
      const key = templateKey(parts);
      const kind = node.tag.getText() as MessageKind;
      found.push({
        line: lineOf(node),
        kind,
        key,
        problems: messageProblems(kind, key, parts),
      });
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      plurals.has(node.expression.text)
    ) {
      const [, one, other] = node.arguments;
      const literal = (arg?: TypeScript.Expression) =>
        arg && ts.isStringLiteralLike(arg) ? arg.text : undefined;
      const key = literal(other);
      found.push(
        key === undefined || literal(one) === undefined
          ? {
              line: lineOf(node),
              kind: "plural",
              key: other?.getText() ?? "",
              problems: ["its two forms are not string literals"],
            }
          : {
              line: lineOf(node),
              kind: "plural",
              key,
              problems: messageProblems("plural", key, []),
            },
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** JSX attributes whose string is never words: styling, wiring, a link, an id. */
const NOT_COPY_ATTRS =
  /^(?:className|class|style|id|key|ref|testID|nativeID|role|type|name|href|src|to|target|rel|htmlFor|for|value|defaultValue|autoComplete|inputMode|pointerEvents|resizeMode|source|d|viewBox|fill|stroke|transform|data-.*|aria-(?!label).*)$/;

/** Calls whose string arguments are code, a log line or a developer's message, never words a user reads. */
const NOT_COPY_CALLS =
  /^(?:console\.\w+|logger\.\w+|log\.\w+|require|malformed|fault|\w+\.\$(?:query|execute)Raw\w*|Prisma\.sql|matchMedia|\w+\.(?:querySelector\w*|getElementById|setItem|getItem|removeItem|addEventListener|removeEventListener|getAttribute|setAttribute|setHeader|header|set|append))$/;

/** An all-capitals SQL keyword: a string holding one is a query, and so is every part of a template that does. */
const SQL =
  /\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM|RETURNING|PRAGMA|CREATE TABLE|CREATE INDEX|ORDER BY|GROUP BY|LIMIT|FOR UPDATE|FOR SHARE|IS NULL|IS NOT NULL|PRIMARY KEY|NOT NULL|DROP TABLE|ALTER TABLE|ADD COLUMN)\b/;

/** Tagged templates that are code: SQL, CSS, shaders. */
const NOT_COPY_TAGS = /^(?:sql|Prisma\.sql|css|glsl|html)$/;

/** `new X(…)` whose argument is a developer's message. */
const NOT_COPY_NEW = /^(?:\w*Error|RegExp|URL|URLSearchParams|Set|Map)$/;

/** Two words with a space between, or a one-word sentence: what reads as prose. */
const PROSE = /\p{L}{2,}\W*\s\W*\p{L}{2,}|^\p{Lu}\p{Ll}+[.!?…]$/u;

/** A colour such as `#F7F3EC`: it has letters but no words. */
const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * Code that reads as words: a bracket or underscore (a selector, a path), a
 * media query `(hover: none)`, a CSS value, a selector list `input, textarea`,
 * an HTTP header value.
 */
const CODE =
  /[[\]{}_]|^\([^()]*:[^()]*\)$|var\(--|color-mix\(|^[a-z0-9]+(?:, ?[a-z0-9]+)+$|^(?:attachment|inline);|; charset=/;

/** A map style property ("text-font", "icon-image"): its value is a font, an expression or an id. Another hyphenated key ("six-base") names a thing, and its value may be words. */
const MAP_STYLE_KEY =
  /^(?:text|icon|line|circle|symbol|fill|raster|background|heatmap|hillshade|source)-/;

/** The catalogue folder: its keys and values are text by design, read by `messagesIn`'s consumers, never counted as bare. */
const CATALOGUE_FILE = /(?:^|[\\/])i18nCatalogues[\\/]/;

/** Files whose every flagged string is not words a user reads, with why. Paths from the repo root. */
export const EXEMPT_FILES: Readonly<Record<string, string>> = {
  "shared/src/ozUltimate.ts": "canyon names, which are proper nouns",
  "shared/src/copyRules.ts":
    "what a failing copy test tells the developer to write instead",
  "shared/src/i18nSource.ts": "what a failing i18n test tells the developer",
  "shared/src/kit.ts":
    "notes on each kit component, read by the people who build it",
  "shared/src/webTokens.ts": "the CSS generated from the design tokens",
  "api/src/lib/dataExport.ts":
    "notes on why a model is left out of what a user downloads, read by developers",
  "api/src/lib/placeVisibility.ts":
    "notes on why a field is withheld from a sharee, read by developers",
};

export type BareLiteral = {
  line: number;
  text: string;
  /** `copy` stood where today's copy rules read (JSX text, a prop such as `label`, a toast's argument); `prose` is any other literal that reads as a sentence. */
  why: "copy" | "prose";
};

/**
 * The literals a user may read that were not written through `t`, `plural`,
 * `rich` or `say`: any with a letter where `userFacingStrings` reads
 * (`COPY_PROPS`, `COPY_CALLS`, JSX text and child expressions), and any other
 * that reads as prose (`PROSE`) unless it stands in a position that is code:
 * an import, a type, a comparison, a log, `console`, an error's message, SQL,
 * a property's name, a styling or wiring attribute.
 */
export function bareCopyIn(
  tsModule: unknown,
  fileName: string,
  source: string,
): BareLiteral[] {
  const ts = tsModule as typeof TypeScript;
  const sf = loadFile(ts, fileName, source);
  const found: BareLiteral[] = [];
  const plurals = pluralNames(ts, sf);
  const add = (node: TypeScript.Node, text: string, copy: boolean) => {
    if (!/\p{L}/u.test(text) || SQL.test(text) || HEX.test(text)) return;
    if (!copy && (!PROSE.test(text) || CODE.test(text))) return;
    found.push({
      line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      text,
      why: copy ? "copy" : "prose",
    });
  };
  const equality = new Set([
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.InKeyword,
  ]);
  // `copy`: the value is where the net reads. A call or a function body ends
  // it: `friendShareVerb("unshare")` passes an id, not words.
  const visit = (node: TypeScript.Node, copy: boolean): void => {
    const into = (child: TypeScript.Node, c = copy) => visit(child, c);
    const all = (c = copy) => ts.forEachChild(node, (child) => visit(child, c));
    // `"a" + b` and `"a" ${b}`: text built in place.
    const isText = (arg: TypeScript.Node): boolean =>
      ts.isStringLiteralLike(arg) ||
      ts.isTemplateExpression(arg) ||
      (ts.isBinaryExpression(arg) &&
        arg.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        (isText(arg.left) || isText(arg.right)));
    // An argument that is text is code here; any other (a callback) is read.
    const codeArguments = (
      call: TypeScript.CallExpression | TypeScript.NewExpression,
    ) => {
      into(call.expression, false);
      for (const arg of call.arguments ?? [])
        if (!isText(arg)) into(arg, false);
    };
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isExternalModuleReference(node) ||
      ts.isTypeNode(node) ||
      ts.isDecorator(node)
    )
      return;
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag.getText();
      if (MESSAGE_TAGS.has(tag) || NOT_COPY_TAGS.test(tag)) {
        // The text is the message or code; a hole's own strings are bare.
        if (ts.isTemplateExpression(node.template))
          for (const span of node.template.templateSpans)
            into(span.expression, false);
        return;
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      if (NOT_COPY_CALLS.test(callee)) return codeArguments(node);
      if (plurals.has(callee)) {
        node.arguments.forEach((arg, i) => {
          if (i !== 1 && i !== 2) into(arg, false);
        });
        return;
      }
      into(node.expression, false);
      const asCopy = COPY_CALLS.test(callee);
      const count = callee === "Alert.alert" ? 2 : 1;
      node.arguments.forEach((arg, i) => into(arg, asCopy && i < count));
      return;
    }
    if (
      ts.isNewExpression(node) &&
      NOT_COPY_NEW.test(node.expression.getText())
    )
      return codeArguments(node);
    if (ts.isFunctionLike(node) && !ts.isArrowFunction(node)) return all(false);
    if (ts.isArrowFunction(node)) {
      // A concise body is an expression the caller may show; a block is code.
      into(node.body, ts.isBlock(node.body) ? false : copy);
      return;
    }
    if (ts.isBinaryExpression(node) && equality.has(node.operatorToken.kind)) {
      // `x === "a"` compares; the other side may hold strings of its own.
      for (const side of [node.left, node.right])
        if (!ts.isStringLiteralLike(side)) into(side, false);
      return;
    }
    if (ts.isCaseClause(node)) {
      node.statements.forEach((s) => into(s, false));
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      into(node.expression, false);
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
      const init = node.initializer;
      if (!init) return;
      const value =
        ts.isJsxExpression(init) && init.expression ? init.expression : init;
      if (COPY_PROPS.has(name)) into(value, true);
      else if (!NOT_COPY_ATTRS.test(name)) into(value, false);
      return;
    }
    if (ts.isJsxText(node)) return add(node, node.text.trim(), true);
    if (ts.isJsxExpression(node)) {
      // A child expression is on screen; an attribute's value is `into` above.
      const child =
        ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent);
      return all(child);
    }
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText().replace(/["']/g, "");
      if (MAP_STYLE_KEY.test(key)) return;
      into(node.initializer, COPY_PROPS.has(key));
      return;
    }
    if (ts.isStringLiteralLike(node)) return add(node, node.text, copy);
    if (ts.isTemplateExpression(node)) {
      const parts = [
        node.head.text,
        ...node.templateSpans.map((s) => s.literal.text),
      ];
      if (parts.some((part) => SQL.test(part))) {
        for (const span of node.templateSpans) into(span.expression, false);
        return;
      }
      add(node.head, node.head.text, copy);
      for (const span of node.templateSpans) {
        into(span.expression, copy);
        add(span.literal, span.literal.text, copy);
      }
      return;
    }
    all();
  };
  visit(sf, false);
  return found;
}

/** The folder a source file sits in, relative to the package's `src`: the key of a ceiling. `.` for a file at the root. */
export function directoryOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash < 0 ? "." : relativePath.slice(0, slash);
}

/**
 * What a ratchet ceiling map says is wrong with `counts` (bare literals per
 * directory): a count above its ceiling is new copy outside the catalogue; one
 * below is a ceiling left higher than the code needs, which would let new copy
 * in. An empty list means the map is exactly the code's. A directory above its
 * ceiling lists where its literals are (`found`), a file to a line, so the new
 * one can be found.
 */
export function ceilingFailures(
  counts: Readonly<Record<string, number>>,
  ceilings: Readonly<Record<string, number>>,
  found: readonly { file: string; line: number; dir: string }[] = [],
): string[] {
  const failures: string[] = [];
  for (const dir of new Set([
    ...Object.keys(counts),
    ...Object.keys(ceilings),
  ])) {
    const count = counts[dir] ?? 0;
    const ceiling = ceilings[dir] ?? 0;
    if (count > ceiling) {
      const lines = new Map<string, number[]>();
      for (const hit of found)
        if (hit.dir === dir)
          lines.set(hit.file, [...(lines.get(hit.file) ?? []), hit.line]);
      failures.push(
        [
          `${dir}: ${count} bare literals, ceiling ${ceiling}. Write the text through t, plural, rich or say, never raise the ceiling (${I18N_ADR}). Where they are:`,
          ...[...lines].map(([file, at]) => `  ${file}: ${at.join(", ")}`),
        ].join("\n"),
      );
    } else if (count < ceiling)
      failures.push(
        `${dir}: ${count} bare literals, ceiling ${ceiling}. Lower the ceiling to ${count}${count === 0 ? " (delete the entry)" : ""}.`,
      );
  }
  return failures.sort();
}

export type SourceScan = {
  /** Every message in the package, each with its file (relative to `src`). */
  messages: (SourceMessage & { file: string })[];
  /** Every bare literal outside `EXEMPT_FILES`, with its file and directory. */
  bare: (BareLiteral & { file: string; dir: string })[];
  /** Bare literals per directory: what a ceiling map is held to. */
  counts: Record<string, number>;
};

/** Scan one package's source. `files` are paths relative to its `src`; `pkg` is its folder at the repo root. */
export function scanSources(
  tsModule: unknown,
  pkg: string,
  files: readonly { path: string; source: string }[],
): SourceScan {
  const scan: SourceScan = { messages: [], bare: [], counts: {} };
  for (const { path, source } of files) {
    for (const message of messagesIn(tsModule, path, source))
      scan.messages.push({ ...message, file: path });
    if (`${pkg}/src/${path}` in EXEMPT_FILES || CATALOGUE_FILE.test(path))
      continue;
    const dir = directoryOf(path);
    for (const bare of bareCopyIn(tsModule, path, source)) {
      scan.bare.push({ ...bare, file: path, dir });
      scan.counts[dir] = (scan.counts[dir] ?? 0) + 1;
    }
  }
  return scan;
}

/** The catalogue's keys that no message in `keys` has: a message reworded, or removed, leaves its entry behind. */
export function orphanKeys(
  catalogue: Catalogue,
  keys: ReadonlySet<string>,
): string[] {
  return Object.keys(catalogue).filter((key) => !keys.has(key));
}

/** The messages in `keys` that hold one of `words` but have no catalogue entry: a spelling the language writes differently, left as the source has it. */
export function missingEntries(
  catalogue: Catalogue,
  keys: ReadonlySet<string>,
  words: readonly string[],
): string[] {
  const wanted = words.map((word) => new RegExp(`\\b${word}`, "i"));
  return [...keys].filter(
    (key) =>
      wanted.some((re) => re.test(key)) &&
      !Object.prototype.hasOwnProperty.call(catalogue, key),
  );
}
