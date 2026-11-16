import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { measureSwitchCopy } from "./switchCopy.js";

// The clients' `switchCopy.test.ts` measure their own source; these hold the
// reader itself on small files written here.

const dir = mkdtempSync(join(tmpdir(), "switch-copy-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(
  join(dir, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      jsx: "preserve",
      noEmit: true,
      module: "esnext",
      moduleResolution: "bundler",
      skipLibCheck: true,
      types: [],
    },
  }),
);

const PRELUDE = `import { LIST } from "@logjam/shared";
declare const t: (s: TemplateStringsArray, ...h: string[]) => string;
declare const SwitchRow: (p: { title: string }) => unknown;
declare namespace JSX { interface IntrinsicElements { [k: string]: unknown } interface ElementChildrenAttribute { children: unknown } }
`;

let n = 0;
/** The words `measureSwitchCopy` reads from `body`, with `LIST` exported by the package at run time. */
function measure(body: string): string[] {
  const file = join(dir, `case${n++}.tsx`);
  writeFileSync(file, PRELUDE + body);
  return measureSwitchCopy(
    ts,
    join(dir, "tsconfig.json"),
    [file],
    [{ tag: "SwitchRow", label: "title", hint: "description" }],
    { LIST: [{ label: "Alpha" }, { label: "Beta" }] },
  ).map((found) => found.text);
}

describe("measureSwitchCopy", () => {
  // Mutation: delete the `t` tagged-template branch from `texts`.
  it("reads a t message with no holes", () => {
    expect(measure("const a = <SwitchRow title={t`Hello`} />;")).toEqual([
      "Hello",
    ]);
  });

  // Mutation: in the `t` tagged-template branch of `texts`, return `[expr.template.getText()]` where the template has holes.
  it("skips a t message with a hole, which has no fixed length", () => {
    expect(
      measure("const a = (x: string) => <SwitchRow title={t`Hello ${x}`} />;"),
    ).toEqual([]);
  });

  // Mutation: remove "filter" from `KEEPS_ITEMS`.
  it("reads the items of an exported array through a filter", () => {
    expect(
      measure(
        "const a = LIST.filter((row) => row).map(({ label }) => <SwitchRow title={label} />);",
      ),
    ).toEqual(["Alpha", "Beta"]);
  });

  // Mutation: add "map" to `KEEPS_ITEMS`.
  it("does not read through a map, whose result is not the array's items", () => {
    expect(
      measure(
        "const a = LIST.map((row) => ({ ...row })).map(({ label }) => <SwitchRow title={label} />);",
      ),
    ).toEqual([]);
  });
});
