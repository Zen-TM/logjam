import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Logjam Web's Ways list and Logjam GPS's Saved screen import a file under the
// same words, which live in `WAY_IMPORT` (shared/src/contracts/ways.ts).
//
// Mutation that turns it red: replace `WAY_IMPORT.file`, `.menu`, `.saved` or
// `.failed` in either client with a literal.
const read = (path: string) =>
  readFileSync(join(__dirname, "../../../../..", path), "utf8");

const CLIENTS: [file: string, uses: string[]][] = [
  [
    "frontend/src/components/sidebar/panels/RoutesPanel.tsx",
    ["WAY_IMPORT.menu", "WAY_IMPORT.file"],
  ],
  [
    "frontend/src/components/sidebar/panels/useWayImport.tsx",
    ["WAY_IMPORT.saved", "WAY_IMPORT.failed"],
  ],
  [
    "mobile/src/saved/SavedScreen.tsx",
    [
      "WAY_IMPORT.menu",
      "WAY_IMPORT.file",
      "WAY_IMPORT.saved",
      "WAY_IMPORT.failed",
    ],
  ],
];

describe("both clients import a file under WAY_IMPORT's words", () => {
  it.each(CLIENTS)("%s", (file, uses) => {
    const source = read(file);
    for (const use of uses) expect(source).toContain(use);
    // Literals in a label, title or message position; comments may quote them.
    expect(source).not.toMatch(
      /(label|title)[:=] ?\{?["'`]Import (GPX|a file)/,
    );
    expect(source).not.toMatch(/["'`]Couldn't import that file/);
    expect(source).not.toMatch(/`.*is saved under Imports/);
  });
});
