import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { allStrings } from "@logjam/shared";

// A sentence about who can see or do something is declared in
// `contracts/share.ts` and read by both clients, so the two can't promise
// different things (shared/DESIGN.md §12). Mutation that turns it red: type
// a share sentence into a component again: JSX text, a const, or the
// argument of a call ("Recipients can copy them while the share is active.").
const SRC = dirname(fileURLToPath(import.meta.url));
const SHARE_WORDS = /can see|visible to|while the share|recipients/i;
const ALLOWED: { file: string; text: string; reason: string }[] = [
  {
    file: "components/dialogs/SelectedPlacesDialog.tsx",
    text: "Recipients can copy or export them",
    reason: "the bulk-share dialog is being rewritten to read sharePromise",
  },
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
      ? [path]
      : [];
  });
}

describe("share sentences on Logjam Web", () => {
  it("writes none of its own", () => {
    const offenders = sources(SRC).flatMap((path) =>
      allStrings(ts, path, readFileSync(path, "utf8"))
        .filter(({ text }) => SHARE_WORDS.test(text))
        .filter(
          ({ text }) =>
            !ALLOWED.some(
              (each) =>
                relative(SRC, path) === each.file && text.includes(each.text),
            ),
        )
        .map(({ line, text }) => `${relative(SRC, path)}:${line} "${text}"`),
    );
    expect(offenders).toEqual([]);
  });

  // Mutation: read only JSX text and `COPY_PROPS`, as `userFacingStrings` does,
  // and a const or a call's argument stops being seen.
  it("sees a sentence it forbids, wherever it is typed", () => {
    for (const source of [
      "export const a = <p>Friends can see this.</p>;",
      'export const b = "Anyone you share it with can see it.";',
      'notify("Friends can see this.", "info");',
      "const c = `Visible to ${n} friends`;",
    ]) {
      const [first] = allStrings(ts, "x.tsx", source);
      expect(SHARE_WORDS.test(first.text), source).toBe(true);
    }
  });
});
