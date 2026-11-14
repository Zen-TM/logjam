import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NSW_REGION, UNITS_CHOICE, type Region } from "@logjam/shared";

import { unitsSettingRow } from "./unitsChoice";

// Mobile tests run without a renderer, so the Display screen's decision is
// this pure function, and the source checks below hold the screens to it.
const FEET: Region = {
  ...NSW_REGION,
  id: "simutah",
  name: "Simulated Utah",
  units: "imperial",
};
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("the units row of Settings → Display", () => {
  // Mutation: return the row whatever the regions say, and prod, which has
  // NSW alone, shows a choice with nothing to choose.
  it("is not there while every region is metric, and is once one uses feet", () => {
    expect(unitsSettingRow([NSW_REGION])).toBeNull();
    expect(unitsSettingRow()).toBeNull();
    expect(unitsSettingRow([NSW_REGION, FEET])).toBe(UNITS_CHOICE);
  });

  // Mutation: draw the row without `unitsSettingRow`, or leave out the
  // root's `useDisplayUnits()`, and the row shows in prod or a choice never
  // changes a figure.
  it("is drawn from unitsSettingRow, and the shell sets the units the formatters use", () => {
    const screen = read("./settings/DisplaySettingsScreen.tsx");
    expect(screen).toContain("unitsSettingRow()");
    expect(screen).toContain("sendsRegionChoice(accountState)");
    expect(read("../AppShell.tsx")).toContain("useDisplayUnits();");
    expect(read("../AppShell.tsx")).toContain("keepAccountUnits(accountUnits)");
    expect(read("../offline/wipeLocalData.ts")).toContain("forgetUnits();");
  });
});
