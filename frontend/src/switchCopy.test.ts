import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_SETTING,
  measureSwitchCopy,
  NOTIFICATION_PREFERENCES,
  SWITCH_COPY_MAX,
} from "@logjam/shared";

// A switch's label and hint keep to `SWITCH_COPY_MAX` (shared/DESIGN.md).
//
// Mutations that turn it red: lengthen `LEADERBOARD_SETTING.label` in
// shared/src/contracts/leaderboard.ts past 20 characters; build a
// notification switch's label at run time again, or widen
// `NOTIFICATION_PREFERENCES`' `label` to `string`.
const SRC = dirname(fileURLToPath(import.meta.url));
const SWITCHES = [{ tag: "SwitchRow", label: "title", hint: "description" }];

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
      join(SRC, "..", "tsconfig.app.json"),
      files,
      SWITCHES,
    );

    // Contract copy is read through @logjam/shared's types: unresolved, every
    // such prop would type as `any` and pass unmeasured.
    const texts = measured.map((m) => m.text);
    expect(texts).toContain(LEADERBOARD_SETTING.label);
    // Labels drawn from a list: measured only while the list stays `as const`.
    for (const { label } of NOTIFICATION_PREFERENCES)
      expect(texts).toContain(label);

    expect(
      measured
        .filter((m) => m.text.length > SWITCH_COPY_MAX[m.role])
        .map((m) => `${relative(SRC, m.file)}:${m.line}: "${m.text}"`),
      `over ${SWITCH_COPY_MAX.label}/${SWITCH_COPY_MAX.hint} characters`,
    ).toEqual([]);
  }, 30_000);
});
