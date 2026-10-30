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
// including Settings' `PreferenceRow`. The rows over it before the limit
// existed are listed, and the list only shrinks: a row shortened is deleted
// from it.
//
// Mutations that turn it red: lengthen `LEADERBOARD_SETTING.label` in
// shared/src/contracts/leaderboard.ts past 20 characters; shorten a row
// listed in OVER without deleting its line.
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
    const measured = measureSwitchCopy(
      ts,
      join(SRC, "..", "tsconfig.json"),
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
