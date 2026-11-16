import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as shared from "@logjam/shared";

const {
  COPY_MEDIA_SETTING,
  LEADERBOARD_SETTING,
  measureSwitchCopy,
  NOTIFICATION_PREFERENCES,
  PLACES_FILTER_SHEET,
  SWITCH_COPY_MAX,
  TRIPS_FILTER_SHEET,
} = shared;

// A switch's label and hint keep to `SWITCH_COPY_MAX` (shared/DESIGN.md).
//
// Mutations that turn it red: lengthen `LEADERBOARD_SETTING.label` in
// shared/src/contracts/leaderboard.ts past 20 characters; build a
// notification switch's label at run time instead of reading
// `NOTIFICATION_PREFERENCES`; in `measureSwitchCopy`
// (shared/src/switchCopy.ts) stop `valuesOf` following `const { copy } = X`
// (the `held` line in `bound`), or a callback over an array (`ARRAY_WALKS`).
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
      shared,
    );

    // Contract copy is read from @logjam/shared's exports at run time: if the
    // name stops resolving, a switch drawn from it would pass unmeasured.
    const texts = measured.map((m) => m.text);
    expect(texts).toContain(LEADERBOARD_SETTING.label);
    expect(texts).toContain(LEADERBOARD_SETTING.hint);
    expect(texts).toContain(COPY_MEDIA_SETTING.label);
    expect(texts).toContain(COPY_MEDIA_SETTING.hint);
    // Words read through a destructured `copy`.
    for (const word of [
      PLACES_FILTER_SHEET.copy.includeMissing,
      PLACES_FILTER_SHEET.copy.includeMissingHint,
      PLACES_FILTER_SHEET.copy.sharedByMe,
      TRIPS_FILTER_SHEET.copy.includeMissing,
      TRIPS_FILTER_SHEET.copy.includeMissingHint,
    ])
      expect(texts).toContain(word);
    // Labels drawn from a list.
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
