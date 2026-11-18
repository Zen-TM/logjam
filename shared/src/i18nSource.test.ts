import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  bareCopyIn,
  bareCopyFailures,
  messageProblems,
  importProblems,
  messagesIn,
  missingEntries,
  orphanKeys,
  ratchetReads,
  scanSources,
} from "./i18nSource.js";

// The scanner every i18n guard reads. `i18nCoverage.test.ts` in each package
// holds what it finds in that package; this file holds what it must and must not
// find, one fixture per position.

const messages = (source: string, file = "x.tsx") =>
  messagesIn(ts, file, source);
const bare = (source: string, file = "x.tsx") =>
  bareCopyIn(ts, file, source).map(({ text }) => text);
const IMPORT_PLURAL = 'import { plural } from "@logjam/shared";\n';

describe("messagesIn", () => {
  // Mutation: in `templateKey` (i18n.ts), change `{${i - 1}}` to an empty string.
  it("keys a template by its English with the holes written {0}, {1}", () => {
    expect(
      messages("const a = t`Showing ${shown} of ${total}`;").map((m) => m.key),
    ).toEqual(["Showing {0} of {1}"]);
  });

  // Mutation: drop "say" or "rich" from `MESSAGE_TAGS` in copyRules.ts.
  it("finds t, say and rich, and records which", () => {
    const found = messages(
      "t`One`; say`Two ${n}`; rich`Read the <a>${name}</a>.`;",
    );
    expect(found.map((m) => [m.kind, m.key])).toEqual([
      ["t", "One"],
      ["say", "Two {0}"],
      ["rich", "Read the <a>{0}</a>."],
    ]);
  });

  // Mutation: key a plural by its `one` form.
  it("keys a plural by its other form, found only where it is imported from the shared package", () => {
    expect(
      messages(
        `${IMPORT_PLURAL}plural(n, "# place in {0}", "# places in {0}", name);`,
      ).map((m) => [m.kind, m.key]),
    ).toEqual([["plural", "# places in {0}"]]);
    expect(
      messages(
        'import { plural as many } from "./i18n.js";\nmany(n, "# a", "# b");',
      ).map((m) => m.key),
    ).toEqual(["# b"]);
    expect(
      messages(
        'import { plural } from "./other.js";\nplural(n, "# a", "# b");',
      ),
    ).toEqual([]);
  });

  // Mutation: have `pluralNames` accept any file, so a local `plural` helper is read.
  it("leaves a file's own plural helper alone", () => {
    expect(
      messages(
        'function plural(n: number, noun: string) { return noun; }\nplural(2, "place");',
      ),
    ).toEqual([]);
  });

  // Mutation: report no problem for a plural whose forms are not literals.
  it("reports a plural whose forms are not literals", () => {
    const [found] = messages(`${IMPORT_PLURAL}plural(n, one, other);`);
    expect(found.problems).toEqual(["its two forms are not string literals"]);
  });

  // Mutation: drop the `MESSAGE_TAGS.has` test from `messagesIn`, so any tagged template is a message.
  it("finds nothing in a file with no message", () => {
    expect(
      messages('const a = "t"; const b = other`x`; const c = sql`y ${z}`;'),
    ).toEqual([]);
  });
});

describe("messageProblems", () => {
  it.each([
    // Mutation: delete the trim comparison.
    ["t", " of {0}", [" of ", ""], "starts or ends with a space"],
    ["t", "Showing {0} ", ["Showing ", " "], "starts or ends with a space"],
    // Mutation: test the key instead of the parts, so a hole `{0}` the template made is read as a written one.
    ["t", "Sees {0}", ["Sees {0}"], "holds a literal {0}"],
    // Mutation: drop the `#` rule.
    ["plural", "places", ["place", "places"], "holds no # for the count"],
    // Mutation: change RICH_TAG's `[^<]*` to `.*`, so a nested tag is consumed.
    ["rich", "<a><b>x</b></a>", ["<a><b>x</b></a>"], "holds a tag rich can't"],
    // Mutation: drop the `.match(/[<>]/)` leftover test from the `rich` check.
    ["rich", "<a>x", ["<a>x"], "holds a tag rich can't"],
    ["rich", "Under <5 m", ["Under <5 m"], "holds a tag rich can't"],
  ] as const)("%s %j is refused", (kind, key, parts, problem) => {
    expect(messageProblems(kind, key, parts).join()).toContain(problem);
  });

  // Mutation: push a problem into `messageProblems` for every message.
  it.each([
    ["t", "Showing {0} of {1}", ["Showing ", " of ", ""]],
    ["plural", "# places in {0}", []],
    ["rich", "Read the <a>{0}</a>.", ["Read the <a>", "</a>."]],
    ["rich", "<a>one</a> and <b>{0}</b>", ["<a>one</a> and <b>", "</b>"]],
  ] as const)("%s %j is accepted", (kind, key, parts) => {
    expect(messageProblems(kind, key, parts)).toEqual([]);
  });
});

describe("bareCopyIn", () => {
  // Mutation: in `bareCopyIn`, return before the JSX text branch.
  it("flags JSX text, and a string prop that carries words", () => {
    expect(bare('const a = <Row title="Open it">Hello there</Row>;')).toEqual([
      "Open it",
      "Hello there",
    ]);
  });

  // Mutation: delete `"en"` from `COPY_PROPS` in copyRules.ts.
  it("flags the English of an en property, which a screen shows as a label", () => {
    expect(bare('const a = { latlon: x, en: "N (northing)" };')).toEqual([
      "N (northing)",
    ]);
  });

  // Mutation: stop treating a JSX child expression as copy.
  it("flags a string in a JSX child expression, even one word", () => {
    expect(bare('const a = <p>{open ? "Hide" : "Show"}</p>;')).toEqual([
      "Hide",
      "Show",
    ]);
  });

  // Mutation: drop `COPY_CALLS` from the call branch.
  it("flags the sentence of a toast, but not a call's other arguments", () => {
    expect(bare('toast.error("Nope"); friendShareVerb("unshare");')).toEqual([
      "Nope",
    ]);
  });

  // Mutation: drop the PROSE test, so every word is flagged.
  it("flags prose outside the net and leaves a single word", () => {
    expect(bare('const a = "Open the file"; const b = "button";')).toEqual([
      "Open the file",
    ]);
  });

  // Mutation: in `bareCopyIn`, change `!!options.words && LABEL.test(text)` to `LABEL.test(text)`.
  it("reports a capitalised word outside the net only when asked, and a lowercase one never", () => {
    const source =
      'const a = "Friends"; const b = "button"; const c = <p>Delete</p>; const d = "Open the file";';
    expect(bare(source)).toEqual(["Delete", "Open the file"]);
    expect(
      bareCopyIn(ts, "x.tsx", source, { words: true }).map(
        ({ text, why }) => `${why}:${text}`,
      ),
    ).toEqual(["word:Friends", "copy:Delete", "prose:Open the file"]);
  });

  // Mutation: in `bareCopyIn`'s `add`, report `start: 0`.
  it("says where each literal starts, which a rewrite finds it by", () => {
    const source = 'const a = "x"; const b = <p>\n  Hello there\n</p>;';
    expect(
      bareCopyIn(ts, "x.tsx", source).map(({ start }) =>
        source.slice(start, start + 5),
      ),
    ).toEqual(["Hello"]);
  });

  // Mutation: take the apostrophe form out of the word pattern (`WORD`).
  it("flags prose whose first word is a contraction, and not a lone one", () => {
    expect(
      bare(
        'const a = "Can\'t undo"; const b = "x\'s"; const c = "You\u2019re in";',
      ),
    ).toEqual(["Can't undo", "You’re in"]);
  });

  // Mutation: in `PROSE`, drop the `ONE_LETTER_WORD` alternatives.
  it("flags prose that holds the one-letter word a or I, and not a lone letter", () => {
    expect(
      bare(
        'const a = "Find a route"; const b = "Can I help"; const c = "A new day"; const d = "x or y"; const e = "a b"; const f = "Plan B";',
      ),
    ).toEqual(["Find a route", "Can I help", "A new day"]);
  });

  // Mutation: in `ONE_LETTER_WORD`, take `<` and `/` out of the lookbehind.
  it("does not read the a of a tag as a word", () => {
    expect(
      bare(
        `const a = '<a href="x">go</a>'; const b = '</a> end'; const c = "Find a route";`,
      ),
    ).toEqual(["Find a route"]);
  });

  // Mutation: in `WORDS_IN`, drop `ONE_LETTER_WORD`.
  it("counts a or I as a word of a pieced sentence", () => {
    expect(bare("const a = `Enter a ${what}`;")).toEqual(["Enter a …"]);
  });

  // Mutation: in `isMarkup`, drop the check for a word outside the tags.
  it("reads the words between tags", () => {
    expect(
      bare(
        'const a = "<b>Open the file</b>"; const b = `<p>Saved ${n} places</p>`;',
      ),
    ).toEqual(["<b>Open the file</b>", "<p>Saved … places</p>"]);
  });

  // Mutation: delete the `isData` test from `add` in `bareCopyIn`.
  it("leaves a listed data literal alone in the file that lists it, in any position", () => {
    expect(
      bareCopyIn(
        ts,
        "regions.tsx",
        'const a = { source: "National Park" }; const b = <p>National Park</p>; const c = "Open the park";',
        { repoPath: "shared/src/regions.ts" },
      ).map((found) => found.text),
    ).toEqual(["Open the park"]);
  });

  // Mutation: in `bareCopyIn`, look the entries up by text alone, whatever the file.
  it("counts the same words in another file", () => {
    expect(
      bareCopyIn(ts, "other.ts", 'const a = { source: "National Park" };', {
        repoPath: "mobile/src/other.ts",
      }).map((found) => found.text),
    ).toEqual(["National Park"]);
  });

  // Mutation: change the template case's `if (!copy) {` to `if (true) {`, so a
  // template in a copy position is judged as one unit too.
  it("flags each part of a template in a copy position", () => {
    expect(bare("const a = <p>{`You shared ${n} places`}</p>;")).toEqual([
      "You shared ",
      " places",
    ]);
  });

  // Mutation: change the template case's `if (!copy) {` to `if (false) {`, so
  // a template outside a copy position is judged a fragment at a time again.
  it("flags a template with substitutions once, as one sentence", () => {
    expect(bare("const a = `Saved ${n} places`;")).toEqual(["Saved … places"]);
    expect(bare("return `${shown} of ${total} places`;")).toEqual([
      "… of … places",
    ]);
  });

  // Mutation: drop the `isPlus` branch.
  it("flags a + chain with a string operand once, as one sentence", () => {
    expect(bare('const a = "Saved " + n + " places";')).toEqual([
      "Saved … places",
    ]);
    expect(bare("const a = b + c;")).toEqual([]);
  });

  // Mutation: drop the two-word minimum from `addJoined`.
  it("does not read a pieced string with fewer than two words of its own", () => {
    expect(
      bare(
        "const a = [`${name}:`, `Bearer ${token}`, `${n} MB`, `${a}, ${b}`, 'x' + y];",
      ),
    ).toEqual([]);
  });

  // Mutation: drop the PROSE test from `addJoined`.
  it("does not read a path or an id built from pieces", () => {
    expect(
      bare(
        "const a = `${dir}/latest.json`; const b = 'users/' + id + '/photos';",
      ),
    ).toEqual([]);
  });

  // Mutation: drop `className` from `NOT_COPY_ATTRS`.
  it("does not read a templated className", () => {
    expect(
      bare("const a = <p className={`flex ${on} items-center`} />;"),
    ).toEqual([]);
  });

  // Mutation: stop skipping the template of a message tag.
  it("leaves the text of t, say, rich and plural alone, and reads a hole's own string", () => {
    expect(
      bare(
        `${IMPORT_PLURAL}const a = [t\`Open the file\`, say\`Not found\`, rich\`Read <a>this</a> now\`, plural(n, "# big thing", "# big things"), t\`Hi \${"you there"}\`];`,
      ),
    ).toEqual(["you there"]);
  });

  // Mutation: have the plural branch skip every argument.
  it("reads a plural's holes, not its two forms", () => {
    expect(
      bare(
        `${IMPORT_PLURAL}plural(n, "# big thing", "# big things", "the one");`,
      ),
    ).toEqual(["the one"]);
  });

  // One position per row, each a string that reads as prose and must not be flagged.
  // Mutation: remove the matching branch of `bareCopyIn` (or the pattern) in
  // turn: `isMarkup` from `add` and from `addJoined`, the `BarBarToken` case of
  // `isText`, the `QuestionQuestionToken` case of `isText`.
  it.each([
    ["an import", 'import x from "some module name";'],
    ["a type", 'type A = "an open file"; const b = c as "an open file";'],
    ["a comparison", 'if (a === "open the file") {}; a !== "close it now";'],
    ["a case clause", 'switch (a) { case "open the file": break; }'],
    ["console", 'console.log("Opened the file");'],
    ["logger", 'logger.warn({ id }, "Opened the file");'],
    ["new Error", 'throw new Error("Could not open the file");'],
    ["an error built with +", 'throw new Error("Could not open " + name);'],
    [
      "an error's default message",
      'throw new Error(m || "Could not open the file");',
    ],
    [
      "a line of XML",
      'const a = `<name>${n}</name>`; const b = "<?xml version=1.0?>";',
    ],
    [
      "an error's default message, written with ??",
      'throw new Error(m ?? "Could not open the file");',
    ],
    [
      "a template of elements",
      "const a = `<?xml version=1.0?>\n<rte>\n<name>${n}</name>\n${rest}\n</rte>`;",
    ],
    [
      "an element with no words",
      'const a = "<a href=x></a>"; const b = `<p class="x">${n}</p>`;',
    ],
    ["a property's name", 'const a = { "open the file": 1 };'],
    ["an element access", 'const a = b["open the file"];'],
    ["a styling attribute", 'const a = <p className="flex items-center" />;'],
    ["a data attribute", 'const a = <p data-testid="open the file" />;'],
    [
      "an href",
      'const a = <a href="https://example.com/open the file">{x}</a>;',
    ],
    ["a map style key", 'const a = { "text-font": "Noto Sans Medium" };'],
    ["SQL", 'db.run("SELECT id FROM places WHERE id = ?");'],
    [
      "a template of SQL",
      "db.run(`UPDATE places SET name = ${name} for the open file`);",
    ],
    ["a sql tag", "const a = sql`open the file ${x}`;"],
    ["a colour", 'const a = { label: "#F7F3EC" };'],
    ["a media query", 'const a = "(prefers-reduced-motion: reduce)";'],
    ["a selector list", 'const a = "input, textarea, select";'],
    ["a header value", 'const a = "attachment; filename=x";'],
  ])("leaves %s alone", (_name, source) => {
    expect(bare(source)).toEqual([]);
  });

  // Mutation: restore the blanket `key.includes("-")` skip in place of `MAP_STYLE_KEY`.
  it("reads the words under an id-keyed map's hyphenated key", () => {
    expect(
      bare(
        'const a = { "six-base": "Base Map", "new-attr": "New custom attribute" };',
      ),
    ).toEqual(["Base Map", "New custom attribute"]);
  });

  // Mutation: stop visiting an arrow's parameters.
  it("reads a string default in an arrow's parameters", () => {
    expect(
      bare('const a = ({ label = "Select the canyon" }) => label;'),
    ).toEqual(["Select the canyon"]);
  });

  // Mutation: have the arrow-function branch pass `copy` into a block body.
  it("ends the net at a block body, and reads a concise arrow's value", () => {
    expect(bare('const a = { label: () => { return "Save"; } };')).toEqual([]);
    expect(bare('const a = { label: () => "Save" };')).toEqual(["Save"]);
  });

  // Mutation: delete the `isErrorSuper` line of `bareCopyIn`'s call branch, or
  // the `CONSOLE` line above it, or the `ConditionalExpression` case of `isErrorText`
  // (or let `isText` take a ternary, which turns the `.set(` control red).
  // Each control is the same sentence in a position that is read, so a rule
  // that stopped matching cannot pass by finding nothing.
  it.each([
    [
      "super in a class that extends an Error",
      'class TimeoutError extends Error { constructor() { super("Timed out asking the provider"); } }',
      'class Timeout extends Base { constructor() { super("Timed out asking the provider"); } }',
    ],
    [
      "a nested fallback in console",
      'console.error(messageFromError(err, "Could not save the file"));',
      'report(messageFromError(err, "Could not save the file"));',
    ],
    [
      "a ternary of two messages in an Error",
      'reject(new Error(stalled ? "Upload stalled" : "Upload cancelled"));',
      'toasts.set(id, stalled ? "Upload stalled" : "Upload cancelled");',
    ],
  ])(
    "leaves %s alone, and reads the same text elsewhere",
    (_name, code, control) => {
      expect(bare(code)).toEqual([]);
      expect(bare(control).length).toBeGreaterThan(0);
    },
  );

  // Mutation: have `codeArguments` read no argument (delete its `into(arg, false)`).
  it("flags a string passed to a callback inside a log call", () => {
    expect(bare('logger.info(() => { notify("Saved the place"); });')).toEqual([
      "Saved the place",
    ]);
  });
});

describe("importProblems", () => {
  const found = (source: string) =>
    importProblems(ts, "x.tsx", source).map(({ problem }) => problem);

  // Mutation: drop the `element.propertyName` test.
  it("refuses a message function imported under another name", () => {
    expect(
      found('import { t as tr, say, plural as p } from "@logjam/shared";'),
    ).toHaveLength(2);
    expect(found('import { t, say, rich, plural } from "./i18n.js";')).toEqual(
      [],
    );
  });

  // Mutation: drop the namespace branch.
  it("refuses a message function reached through a namespace", () => {
    expect(
      found(
        'import * as i18n from "@logjam/shared";\ni18n.plural(n, "a", "b"); i18n.t`x`; i18n.other();',
      ),
    ).toHaveLength(2);
  });

  // Mutation: drop the `MESSAGE_MODULE` test.
  it("leaves another module's t alone", () => {
    expect(found('import { t as tr } from "i18next";')).toEqual([]);
  });
});

describe("scanSources", () => {
  const found = (scan: ReturnType<typeof scanSources>) =>
    scan.bare.map((b) => b.file);

  // Mutation: drop the backslash replacement at the top of `scanSources`.
  it("keys a path from any platform the same way", () => {
    const source = 'export const a = "Open the file";';
    expect(
      found(
        scanSources(ts, "shared", [
          { path: "sub\\b.ts", source },
          { path: "i18nCatalogues\\en-US.ts", source },
        ]),
      ),
    ).toEqual(["sub/b.ts"]);
  });

  // Mutation: drop the `in EXEMPT_FILES` test from `scanSources`.
  it("finds bare literals in every file and skips an exempt one", () => {
    const scan = scanSources(ts, "shared", [
      { path: "a.ts", source: 'export const a = "Open the file";' },
      { path: "sub/b.ts", source: 'export const b = "Open the file";' },
      { path: "sub/c.ts", source: 'export const c = "Close the file";' },
      { path: "ozUltimate.ts", source: 'export const d = "Pipeline Canyon";' },
    ]);
    expect(found(scan)).toEqual(["a.ts", "sub/b.ts", "sub/c.ts"]);
  });
});

describe("scanSources and the catalogue folder", () => {
  const source = 'export const enUS = { "Abseil rope": "Rappel rope" };';

  // Mutation: drop the `CATALOGUE_FILE` test from `scanSources`.
  it("does not count a catalogue's entries as bare copy, anywhere else it does", () => {
    expect(
      scanSources(ts, "shared", [{ path: "i18nCatalogues/en-US.ts", source }])
        .bare,
    ).toEqual([]);
    expect(
      scanSources(ts, "shared", [{ path: "other/en-US.ts", source }]).bare,
    ).toHaveLength(1);
  });
});

describe("ratchetReads", () => {
  // Mutation: change the directory test to `true`.
  it.each([
    ["lib", true],
    ["__tests__", false],
    ["__fixtures__", false],
  ])("walks into %s: %s", (name, walked) => {
    expect(ratchetReads(name, true)).toBe(walked);
  });

  // Mutation: change `/\.(test|d)\./` to `/\.test\./`.
  it.each([
    ["a.ts", true],
    ["a.tsx", true],
    ["a.test.ts", false],
    ["a.unit.test.ts", false],
    ["a.d.ts", false],
    ["a.json", false],
    ["a.js", false],
  ])("reads the file %s: %s", (name, read) => {
    expect(ratchetReads(name, false)).toBe(read);
  });
});

describe("bareCopyFailures", () => {
  // Mutation: return an empty list always, or drop the `found.length === 0` test.
  it("is empty when there is no bare text, and otherwise says so", () => {
    expect(bareCopyFailures([])).toEqual([]);
    expect(bareCopyFailures([{ file: "a.ts", line: 3 }])).toHaveLength(1);
  });

  // Mutation: delete the codemod's two commands or the `through t, plural, rich or say` advice from the message.
  it("tells whoever wrote bare text to write it through t, and names the codemod for a whole directory", () => {
    const [failure] = bareCopyFailures([{ file: "a.ts", line: 3 }]);
    expect(failure).toContain("1 bare literals");
    expect(failure).toContain("Write the text through t, plural, rich or say");
    expect(failure).toContain("node scripts/i18n-extract.mjs");
    expect(failure).toContain("node scripts/i18n-identity-check.mjs");
  });

  // Mutation: list each hit on its own line, or drop the file grouping.
  it("lists each file once, with its lines", () => {
    const [failure] = bareCopyFailures([
      { file: "a.ts", line: 3 },
      { file: "sub/b.ts", line: 1 },
      { file: "a.ts", line: 9 },
    ]);
    expect(failure).toContain("3 bare literals");
    expect(failure).toContain("  a.ts: 3, 9\n  sub/b.ts: 1");
  });
});

describe("the catalogue against the messages", () => {
  const keys = new Set(["Abseil down {0}", "Open the file"]);

  // Mutation: have `orphanKeys` return nothing.
  it("finds an entry whose message is gone", () => {
    expect(orphanKeys({ "Abseil down {0}": "Rappel down {0}" }, keys)).toEqual(
      [],
    );
    expect(orphanKeys({ "Abseil dwn {0}": "Rappel down {0}" }, keys)).toEqual([
      "Abseil dwn {0}",
    ]);
  });

  // Mutation: drop the `!has(catalogue, key)` clause of `missingEntries`.
  it("finds a message with a listed word and no entry", () => {
    expect(missingEntries({}, keys, ["abseil"])).toEqual(["Abseil down {0}"]);
    expect(
      missingEntries({ "Abseil down {0}": "Rappel down {0}" }, keys, [
        "abseil",
      ]),
    ).toEqual([]);
    expect(missingEntries({}, keys, [])).toEqual([]);
  });

  // Mutation: drop the `!has(leftAsWritten, key)` clause of `missingEntries`, or
  // make `has` look at `catalogue` alone.
  it("lets a message with a listed word stay as written when its reason is given", () => {
    expect(
      missingEntries({}, keys, ["abseil"], {
        "Abseil down {0}": "a rope brand",
      }),
    ).toEqual([]);
    expect(
      missingEntries({}, keys, ["abseil"], { "Open the file": "not it" }),
    ).toEqual(["Abseil down {0}"]);
  });

  // Mutation: drop the `\\b` before `${word}` in `missingEntries`.
  it("matches a listed word from the start of a word, in any case", () => {
    const some = new Set(["The Rabseil", "ABSEILING down", "Open the file"]);
    expect(missingEntries({}, some, ["abseil"])).toEqual(["ABSEILING down"]);
    // A word is a regular expression.
    expect(missingEntries({}, some, ["absei(?:l|ling)\\b"])).toEqual([
      "ABSEILING down",
    ]);
  });
});
