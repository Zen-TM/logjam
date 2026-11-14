import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  changedFiles,
  extractMessages,
  importFor,
  pieceChanges,
  textPieces,
} from "./i18nCodemod.js";

// The codemod that moves bare copy into the catalogue and the check that the
// English stayed as it was. Each fixture is one position it must rewrite or one
// it must leave to a person; every rewrite is also held to the check, so what
// the codemod writes and what the check reads cannot drift apart.

const IMPORT = 'import { t } from "@logjam/shared";\n';

const run = (source: string, options: { words?: boolean } = {}) =>
  extractMessages(ts, "x.tsx", source, options);

/** The English a rewrite changed: nothing, when it only moved the copy. */
const changed = (before: string, after: string) =>
  pieceChanges(textPieces(ts, "x.tsx", before), textPieces(ts, "x.tsx", after));

/** `source` rewritten, which must also leave its pieces of text as they were. */
function rewritten(source: string, options: { words?: boolean } = {}): string {
  const { source: out } = run(source, options);
  expect(changed(source, out)).toEqual({ removed: [], added: [] });
  return out;
}

describe("extractMessages: what it rewrites", () => {
  // Mutation: change `ts.isJsxElement(node) || ts.isJsxFragment(node)` in `visit` to `false`.
  it("writes JSX text as a message, and adds the import", () => {
    expect(rewritten("const a = <p>Hello world</p>;")).toBe(
      `${IMPORT}const a = <p>{t\`Hello world\`}</p>;`,
    );
  });

  // Mutation: in `jsxText`, set `text = line` and delete the two `replace` lines that trim it.
  it.each([
    ["lines join with one space", "<p>\n    Save   your\n    work\n  </p>"],
    ["a tab at an end goes", "<p>\n\t\tSave it now\t\n</p>"],
    ["entities decode", "<p>Fish &amp; chips &nbsp;&#39;n&#x27; more</p>"],
    ["a blank line goes", "<p>\n  First line\n\n  Second line\n</p>"],
  ])("reads JSX text as React does: %s", (_name, jsx) => {
    const out = rewritten(`const a = ${jsx};`);
    expect(out).toContain("{t`");
  });

  // Mutation: change `inRun` to `ts.isJsxText(child)`.
  it("writes text and its plain expressions as one sentence", () => {
    expect(
      rewritten("const a = <p>Showing {shown} of {total} places</p>;"),
    ).toBe(
      `${IMPORT}const a = <p>{t\`Showing \${shown} of \${total} places\`}</p>;`,
    );
  });

  // Mutation: start the run's edit at `first.pos`, the first text, instead of the run's first child.
  it("writes a sentence that opens with an expression", () => {
    expect(rewritten("const a = <p>{n} places saved</p>;")).toBe(
      `${IMPORT}const a = <p>{t\`\${n} places saved\`}</p>;`,
    );
  });

  // Mutation: set the literal's edit `text` to `message` whatever the parent.
  it("writes a copy prop's string, whatever the quote, and decodes its entities", () => {
    const out = rewritten(
      `const a = <B label="Save it" title={'Cancel it'} hint="Fish &amp; chips" />;`,
    );
    expect(out).toContain("label={t`Save it`}");
    expect(out).toContain("title={t`Cancel it`}");
    expect(out).toContain("hint={t`Fish & chips`}");
  });

  // Mutation: add `&& !ts.isConditionalExpression(node.parent)` to the string-literal branch of `visit`.
  it("writes both branches of a ternary", () => {
    expect(
      rewritten("const a = <B label={ok ? 'Saved it' : 'Not saved'} />;"),
    ).toContain("label={ok ? t`Saved it` : t`Not saved`}");
  });

  // Mutation: change the template branch of `visit` to `false &&`.
  it("writes a template in a copy position by tagging it", () => {
    expect(
      rewritten("const a = <B placeholder={`Name of ${what}`} />;"),
    ).toContain("placeholder={t`Name of ${what}`}");
  });

  // Mutation: pass `words: true` to `bareCopyIn` in `extractMessages`, whatever the caller asked.
  it("writes a toast's sentence and a copy property, and not an id beside it", () => {
    const out = rewritten(
      "toast('Saved your place');\nconst o = { label: 'Save it', kind: 'Delete' };",
    );
    expect(out).toContain("toast(t`Saved your place`)");
    expect(out).toContain("label: t`Save it`, kind: 'Delete'");
  });

  // Mutation: delete the backtick `replace` from `inTemplate`.
  it("keeps a message's text exact when it holds a backtick, ${, a backslash or a line break", () => {
    const out = rewritten(
      'const a = <B label={"Use ` and ${x} \\\\ here\\nnow"} />;',
    );
    expect(out).toContain("t`Use \\` and \\${x} \\\\ here\\nnow`");
  });

  // Mutation: write a run's message as a bare template, without its `t`.
  it("changes nothing the second time", () => {
    const first = run("const a = <p>Hello world</p>;").source;
    expect(run(first)).toEqual({ source: first, converted: 0, skipped: [] });
  });

  // Mutation: delete the `if (!edits.length) return` line.
  it("leaves a file with no copy as it was, without an import", () => {
    expect(run("const a = <p>{x}</p>;")).toEqual({
      source: "const a = <p>{x}</p>;",
      converted: 0,
      skipped: [],
    });
  });

  // Mutation: add `+ skipped.length` to `converted`.
  it("counts the messages it wrote", () => {
    expect(
      run(
        "const a = <p>One two</p>;\nconst b = <B label='Three four' />;\nconst c = <B label='Bad ' />;",
      ).converted,
    ).toBe(2);
  });
});

describe("extractMessages: the import", () => {
  // Mutation: make `importEdit`'s loop `continue` before it looks at `statement`.
  it("extends the import from the same module", () => {
    expect(
      rewritten(
        'import { a, b } from "@logjam/shared";\nconst x = <p>Hello world</p>;',
      ),
    ).toBe(
      'import { a, b, t } from "@logjam/shared";\nconst x = <p>{t`Hello world`}</p>;',
    );
  });

  // Mutation: delete the `element.name.text === "t"` test in `importEdit`.
  it("leaves an import that already has t", () => {
    const out = rewritten(
      'import { t } from "@logjam/shared";\nconst x = <p>Hello world</p>;',
    );
    expect(out).toBe(
      'import { t } from "@logjam/shared";\nconst x = <p>{t`Hello world`}</p>;',
    );
  });

  // Mutation: take `imports[0]` for `last` in `importEdit`.
  it("adds a new import after the last one", () => {
    expect(
      rewritten(
        'import a from "a";\nimport b from "b";\nconst x = <p>Hello world</p>;',
      ),
    ).toBe(
      'import a from "a";\nimport b from "b";\nimport { t } from "@logjam/shared";\nconst x = <p>{t`Hello world`}</p>;',
    );
  });

  // Mutation: delete `statement.importClause?.isTypeOnly ||` from `importEdit`.
  it("does not add to a type-only import", () => {
    const out = rewritten(
      'import type { A } from "@logjam/shared";\nconst x = <p>Hello world</p>;',
    );
    expect(out).toContain('import type { A } from "@logjam/shared";');
    expect(out).toContain('import { t } from "@logjam/shared";');
  });

  // Mutation: set `importFrom` to "@logjam/shared" whatever the options say.
  it("reads t from where the caller says", () => {
    expect(
      extractMessages(ts, "x.tsx", "const x = <p>Hello world</p>;", {
        importFrom: "./i18n.js",
      }).source,
    ).toContain('import { t } from "./i18n.js";');
  });

  // Mutation: make `importFor` return "@logjam/shared" for every path.
  it.each([
    ["shared/src/a.ts", "./i18n.js"],
    ["shared/src/contracts/plans.ts", "../i18n.js"],
    ["shared/src/a/b/c.ts", "../../i18n.js"],
    ["frontend/src/a.tsx", "@logjam/shared"],
    ["api/src/lib/a.ts", "@logjam/shared"],
  ])("says where %s reads t from", (path, from) => {
    expect(importFor(path)).toBe(from);
  });
});

describe("extractMessages: what it leaves to a person, and says why", () => {
  const left = (source: string, options: { words?: boolean } = {}) => {
    const out = run(source, options);
    return {
      source: out.source,
      skipped: out.skipped.map((s) => s.reason),
      text: out.skipped.map((s) => s.text),
    };
  };

  // Mutation: drop `messageProblems` from the reasons `literal` gives.
  it("leaves a fragment with a space at an end", () => {
    const out = left("const a = <B label='Hello ' />;\nconst b = 'x';");
    expect(out.source).toContain("label='Hello '");
    expect(out.skipped).toEqual([
      "starts or ends with a space: a sentence glued from fragments can't be translated",
    ]);
  });

  // Mutation: delete the `+` check from `placement`.
  it("leaves a + chain, each piece listed", () => {
    const out = left("toast('Saved ' + name + ' for later');");
    expect(out.skipped).toEqual([
      expect.stringContaining("joined with +"),
      expect.stringContaining("joined with +"),
    ]);
    expect(out.source).not.toContain("t`");
  });

  // Mutation: change `COUNTS` to `/$^/`.
  it.each([
    "toast(n === 1 ? 'One place' : 'Many places');",
    "const a = <p>{n > 1 ? 'places' : 'place'}</p>;",
    "toast(n !== 1 ? `${n} places` : '1 place');",
  ])("leaves a plural ternary: %s", (source) => {
    const out = left(source);
    expect(out.skipped.length).toBeGreaterThan(0);
    expect(out.skipped.every((r) => r.includes("plural"))).toBe(true);
    expect(out.source).not.toContain("t`");
  });

  // Mutation: delete the `as const` check from `placement`.
  it("leaves a literal typed as const", () => {
    const out = left("const a = { label: 'Save it' as const };");
    expect(out.skipped).toEqual([expect.stringContaining("as const")]);
    expect(out.source).not.toContain("t`");
  });

  // Mutation: delete the literal-`{0}` test from `messageProblems` (i18nSource.ts).
  it("leaves a literal {0}", () => {
    expect(left("toast('Costs {0} here');").skipped).toEqual([
      expect.stringContaining("literal {0}"),
    ]);
  });

  // Mutation: replace `hasWords(span.expression)` in `template` with `false`.
  it("leaves a template whose hole holds words of its own, and still writes the words", () => {
    const out = left("toast(`Saved ${ok ? 'fine' : 'badly'} now`);");
    expect(out.skipped).toEqual([expect.stringContaining("hole holds words")]);
    expect(out.source).toContain("ok ? t`fine` : t`badly`");
  });

  // Mutation: delete `if (found === undefined) unknown = true;` from `decodeEntities`.
  it("leaves an entity it cannot decode", () => {
    const out = left("const a = <p>Fish &frac12; done</p>;");
    expect(out.skipped).toEqual([expect.stringContaining("entity")]);
    expect(out.source).toContain("&frac12;");
  });

  // Mutation: delete the tab test from the end of `jsxText`.
  it("leaves a tab inside a line, which compilers read differently", () => {
    const out = left("const a = <p>Save\tit now</p>;");
    expect(out.skipped).toEqual([expect.stringContaining("tab")]);
    expect(out.source).toContain("Save\tit now");
  });

  // Mutation: make `hidden` return `false`.
  it("writes nothing where the file's own t is in scope, and writes elsewhere", () => {
    const out = left(
      "const f = (t) => <p>Hello world</p>;\nconst g = <p>Other words</p>;",
    );
    expect(out.skipped).toEqual([expect.stringContaining("`t` of its own")]);
    expect(out.source).toContain("<p>Hello world</p>");
    expect(out.source).toContain("{t`Other words`}");
  });

  // Mutation: delete the `(before && …) || (after && …)` condition from `children`.
  it("leaves a sentence with an element in it, listing each fragment", () => {
    const out = left(
      "const a = <p>Read the <a href='x'>terms</a>, then agree.</p>;",
    );
    expect(out.skipped).toEqual([
      expect.stringContaining("write the sentence whole with rich"),
      expect.stringContaining("write the sentence whole with rich"),
    ]);
    expect(out.source).toContain("Read the <a");
    expect(out.source).toContain(", then agree.</p>");
  });

  // Mutation: change `!LEADING_NEWLINE.test(firstRaw)` to `false`.
  it("leaves text that runs straight on from an element", () => {
    const out = left("const a = <p><b>x</b>words here</p>;");
    expect(out.skipped).toEqual([
      expect.stringContaining("touches an element"),
    ]);
  });

  // Mutation: change `LEADING_NEWLINE` to `/$^/`.
  it("writes a label beside an element when a line break parts them", () => {
    const out = rewritten("const a = <p>\n  <Icon />\n  Save it\n</p>;");
    expect(out).toContain("{t`Save it`}");
  });

  // Mutation: delete `!ts.isStringLiteralLike(child.expression)` from `plainHole`.
  it("ends a sentence at a string expression, and leaves the fragment", () => {
    const out = left("const a = <p>Read the{' '}<a>terms</a></p>;");
    expect(out.text).toEqual(["Read the"]);
    expect(out.source).toContain("Read the{' '}");
  });
});

describe("extractMessages: what is not text for t", () => {
  // Mutation: delete the tagged-template test from `placement`.
  it.each([
    ["no substitutions", "const a = <B label={dedent`Hello world`} />;"],
    ["a hole", "const a = <B label={dedent`Hello ${who} there`} />;"],
  ])("leaves the text of another tag, and says so: %s", (_name, source) => {
    const out = run(source);
    expect(out.source).toBe(source);
    expect(out.skipped).toEqual([
      expect.objectContaining({
        reason: expect.stringContaining("dedent tag"),
      }),
    ]);
  });

  // Mutation: delete `!e.propertyName` from the `ours` test in `extractMessages`.
  it.each([
    ["from another module", 'import { t } from "other";'],
    ["under another name", 'import { x as t } from "@logjam/shared";'],
    ["by default", 'import t from "@logjam/shared";'],
    ["as a namespace", 'import * as t from "@logjam/shared";'],
    ["as a type", 'import type { t } from "@logjam/shared";'],
  ])(
    "lists, and does not write, in a file that imports its own t %s",
    (_n, line) => {
      const source = `${line}\nconst a = <p>Hello world</p>;`;
      const out = run(source);
      expect(out.source).toBe(source);
      expect(out.skipped).toEqual([
        expect.objectContaining({
          reason: expect.stringContaining("`t` of its own"),
        }),
      ]);
    },
  );

  // Mutation: change `statement.moduleSpecifier.text === importFrom` to `true`.
  it("takes a t from another module as its own even when it is unaliased", () => {
    const source =
      'import { t } from "./elsewhere.js";\nconst a = <p>Hello world</p>;';
    expect(
      extractMessages(ts, "x.tsx", source, { importFrom: "./i18n.js" })
        .converted,
    ).toBe(0);
  });
});

describe("extractMessages: one-word labels", () => {
  // Mutation: set `words: true` where `extractMessages` calls `bareCopyIn`.
  it("converts a capitalised word outside a copy position only when asked", () => {
    const source = "const label = 'Friends';\nreturn 'Delete';";
    expect(run(source).converted).toBe(0);
    expect(run(source, { words: true }).source).toContain("t`Friends`");
    expect(run(source, { words: true }).converted).toBe(2);
  });

  // Mutation: delete the `.filter((found) => found.why !== "prose")` in `extractMessages`.
  it("leaves prose outside the net alone, with words or without", () => {
    const source = "const m = 'Try again later';";
    expect(run(source, { words: true }).converted).toBe(0);
  });
});

describe("the identity check", () => {
  // Mutation: compile JSX with `ts.JsxEmit.Preserve`, so no JSX text is a string.
  it("reads JSX text as the compiler does", () => {
    expect(
      textPieces(ts, "x.tsx", "const a = <p>\n  Hello\n  world\n</p>;"),
    ).toEqual(["p", "Hello world"]);
  });

  // Mutation: drop the `templateSpans` pieces from `textPieces`.
  it("reads a template's literal parts, tagged or not", () => {
    expect(
      textPieces(ts, "x.ts", "a(`One ${x} two`); t`Three ${y} four`;"),
    ).toEqual(["One ", " two", "Three ", " four"]);
  });

  // Mutation: delete the import and export test from `textPieces`.
  it("does not read a module specifier", () => {
    expect(textPieces(ts, "x.ts", 'import { a } from "x";\na();')).toEqual([]);
  });

  // Mutation: in `pieceChanges`, `delete` the counted piece instead of lowering its count.
  it("reports a piece added, removed or reworded, as many times as it differs", () => {
    expect(pieceChanges(["a", "b", "b"], ["b", "c"])).toEqual({
      removed: ["a", "b"],
      added: ["c"],
    });
  });

  // Mutation: make `textPieces` read `NoSubstitutionTemplateLiteral` as no text.
  it("reports nothing for a rewrite that reworded nothing", () => {
    expect(changed("a(<p>Hello</p>);", "a(<p>{t`Hello`}</p>);")).toEqual({
      removed: [],
      added: [],
    });
  });

  // Mutation: make `pieceChanges` return empty arrays.
  it("catches a rewrite that changed a word", () => {
    expect(changed("a(<p>Hello</p>);", "a(<p>{t`Helo`}</p>);")).toEqual({
      removed: ["Hello"],
      added: ["Helo"],
    });
  });
});

describe("changedFiles", () => {
  // Mutation: in `changedFiles`, give `from: path`, so a rename is read at its new path.
  it("lists what was added, modified or renamed, with the path it had at the base", () => {
    expect(
      changedFiles(
        [
          "M\tsrc/a.tsx",
          "A\tsrc/b.ts",
          "R087\tsrc/old.ts\tsrc/new.ts",
          "D\tsrc/gone.ts",
          "M\tsrc/c.d.ts",
          "M\tREADME.md",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { path: "src/a.tsx", from: "src/a.tsx" },
      { path: "src/b.ts", from: "src/b.ts" },
      { path: "src/new.ts", from: "src/old.ts" },
    ]);
  });
});

describe("the scripts", () => {
  const scripts = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../scripts",
  );

  // Mutation: rename `ratchetReads` in i18nSource.ts to `ratchetRead`.
  it("import only names the shared build exports", async () => {
    const imports = ["i18n-extract.mjs", "i18n-identity-check.mjs"].flatMap(
      (script) =>
        [
          ...readFileSync(join(scripts, script), "utf8").matchAll(
            /const \{([^}]+)\} = await import\(`\$\{dist\}\/(\w+)\.js`\)/g,
          ),
        ].map(([, names, module]) => ({
          script,
          module,
          names: names.split(",").map((name) => name.trim()),
        })),
    );
    expect(imports.flatMap((i) => i.names).length).toBeGreaterThanOrEqual(6);
    for (const { script, module, names } of imports) {
      const exported = await import(`./${module}.js`);
      for (const name of names)
        expect(
          exported,
          `${script} imports ${name} from ${module}`,
        ).toHaveProperty(name);
    }
  });
});
