import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_SETTING,
  measureSwitchCopy,
  SWITCH_COPY_MAX,
} from "@logjam/shared";

// A switch's label and hint keep to `SWITCH_COPY_MAX` (shared/DESIGN.md),
// including Settings' `PreferenceRow`.
//
// Mutation that turns it red: lengthen `LEADERBOARD_SETTING.label` in
// shared/src/contracts/leaderboard.ts past 20 characters.
const SRC = __dirname;
const SWITCHES = [
  { tag: "SwitchRow", label: "title", hint: "description" },
  { tag: "PreferenceRow", label: "title", hint: "subtitle" },
];

describe("switch copy", () => {
  it("keeps to the limit", () => {
    const files = readdirSync(SRC, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .map((f) => join(SRC, f))
      .filter((f) =>
        SWITCHES.some((s) => readFileSync(f, "utf8").includes(`<${s.tag}`)),
      );
    const measured = measureSwitchCopy(
      ts,
      join(SRC, "..", "tsconfig.json"),
      files,
      SWITCHES,
    );

    // Contract copy is read through @logjam/shared's types: unresolved, every
    // such prop would type as `any` and pass unmeasured.
    expect(measured.map((m) => m.text)).toContain(LEADERBOARD_SETTING.label);

    expect(
      measured
        .filter((m) => m.text.length > SWITCH_COPY_MAX[m.role])
        .map((m) => `${relative(SRC, m.file)}:${m.line}: "${m.text}"`),
      `over ${SWITCH_COPY_MAX.label}/${SWITCH_COPY_MAX.hint} characters`,
    ).toEqual([]);
  }, 30_000);
});
