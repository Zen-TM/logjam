import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SWITCH_COPY_MAX, switchCopyOverLimit } from "@logjam/shared";

// A switch's label and hint keep to `SWITCH_COPY_MAX` (shared/DESIGN.md). The
// rows over it before the limit existed are listed, and the list only
// shrinks: a row shortened is deleted from it.
//
// Mutation that turns it red: lengthen `LEADERBOARD_SETTING.label` in
// shared/src/contracts/leaderboard.ts past 20 characters.
const SRC = dirname(fileURLToPath(import.meta.url));
const SWITCHES = [{ tag: "SwitchRow", label: "title", hint: "description" }];

const OVER: [file: string, text: string][] = [
  [
    "components/sidebar/panels/PlaceFilterSheet.tsx",
    "Include places missing this info",
  ],
  [
    "components/sidebar/panels/TripLogFilterSheet.tsx",
    "Include trips missing this info",
  ],
];

describe("switch copy", () => {
  it("keeps to the limit, apart from the rows listed", () => {
    const files = readdirSync(SRC, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .map((f) => join(SRC, f))
      .filter((f) =>
        SWITCHES.some((s) => readFileSync(f, "utf8").includes(`<${s.tag}`)),
      );
    const found = switchCopyOverLimit(
      ts,
      join(SRC, "..", "tsconfig.app.json"),
      files,
      SWITCHES,
    ).map((hit): [string, string] => [relative(SRC, hit.file), hit.text]);

    const key = ([file, text]: [string, string]) => `${file}: "${text}"`;
    const listed = new Set(OVER.map(key));
    const seen = new Set(found.map(key));
    expect(
      found.map(key).filter((k) => !listed.has(k)),
      `over ${SWITCH_COPY_MAX.label}/${SWITCH_COPY_MAX.hint} characters`,
    ).toEqual([]);
    expect(
      [...listed].filter((k) => !seen.has(k)),
      "within the limit now: delete from OVER",
    ).toEqual([]);
  }, 30_000);
});
