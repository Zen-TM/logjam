import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SWITCH_COPY_MAX, switchCopyOverLimit } from "@logjam/shared";

// A switch's label and hint keep to `SWITCH_COPY_MAX` (shared/DESIGN.md),
// including Settings' `PreferenceRow`. The rows over it before the limit
// existed are listed, and the list only shrinks: a row shortened is deleted
// from it.
//
// Mutation that turns it red: lengthen `LEADERBOARD_SETTING.label` in
// shared/src/contracts/leaderboard.ts past 20 characters.
const SRC = __dirname;
const SWITCHES = [
  { tag: "SwitchRow", label: "title", hint: "description" },
  { tag: "PreferenceRow", label: "title", hint: "subtitle" },
];

const OVER: [file: string, text: string][] = [
  [
    "customFields/CustomFieldsEditor.tsx",
    "Values must be between the min and max you set",
  ],
  ["logs/LogsFilterSheet.tsx", "Include trips missing this info"],
  [
    "map/MapLayersSheet.tsx",
    "Scrub density for bushbashing: denser reads darker. Orange crosshatching is ground burnt since the survey.",
  ],
  ["map/MapLayersSheet.tsx", "Use only saved maps, even with signal"],
  ["places/PlaceFilterSheet.tsx", "Include places missing this info"],
  ["places/PlaceFilterSheet.tsx", "Show filtered places on the map"],
  ["screens/settings/MapSettingsScreen.tsx", "Keep the map north-up"],
  [
    "screens/settings/MapSettingsScreen.tsx",
    "Uses more battery while on the map.",
  ],
  ["screens/settings/MapSettingsScreen.tsx", "Log raw sensors while recording"],
  ["screens/settings/OfflineSettingsScreen.tsx", "Finished sharpened areas"],
  ["screens/settings/OfflineSettingsScreen.tsx", "Photos with copied places"],
  [
    "screens/settings/PrivacySettingsScreen.tsx",
    "Asks for your fingerprint or PIN each time Logjam GPS opens.",
  ],
  [
    "screens/settings/PrivacySettingsScreen.tsx",
    "Place names and coordinates are removed before sending. Takes effect next launch.",
  ],
  ["screens/settings/PrivacySettingsScreen.tsx", "Save photos to your gallery"],
  [
    "screens/settings/PrivacySettingsScreen.tsx",
    "A copy of anything you shoot in Logjam GPS goes to your camera roll.",
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
      join(SRC, "..", "tsconfig.json"),
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
