import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_SETTING,
  measureSwitchCopy,
  SWITCH_COPY_MAX,
} from "@logjam/shared";

// A switch's label and hint keep to `SWITCH_COPY_MAX` (shared/DESIGN.md). The
// rows over it before the limit existed are listed, and the list only
// shrinks: a row shortened is deleted from it.
//
// Mutations that turn it red: lengthen `LEADERBOARD_SETTING.label` in
// shared/src/contracts/leaderboard.ts past 20 characters; shorten a row
// listed in OVER without deleting its line.
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
    const measured = measureSwitchCopy(
      ts,
      join(SRC, "..", "tsconfig.app.json"),
      files,
      SWITCHES,
    );

    // Contract copy is read through @logjam/shared's types: unresolved, every
    // such prop would type as `any` and pass unmeasured.
    expect(measured.map((m) => m.text)).toContain(LEADERBOARD_SETTING.label);

    // Arrays, not sets: one text on two rows is two lines of OVER.
    const key = ([file, text]: [string, string]) => `${file}: "${text}"`;
    expect(
      measured
        .filter((m) => m.text.length > SWITCH_COPY_MAX[m.role])
        .map((m) => key([relative(SRC, m.file), m.text]))
        .sort(),
      `over ${SWITCH_COPY_MAX.label}/${SWITCH_COPY_MAX.hint} characters, or listed in OVER and now within them`,
    ).toEqual(OVER.map(key).sort());
  }, 30_000);
});
