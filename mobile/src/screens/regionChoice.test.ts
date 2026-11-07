import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NSW_REGION, REGION_CHOICE, type Region } from "@logjam/shared";

import {
  regionsSettingsRow,
  regionStepPress,
  regionSwitches,
  showsRegionStep,
  toggledRegions,
} from "./regionChoice";

// Mobile tests run without a renderer, so the screens' decisions are these
// pure functions, and the source checks below hold the screens to them.
const NZ: Region = {
  ...NSW_REGION,
  id: "nz",
  name: "New Zealand",
  basemaps: [],
  defaultBasemap: "osm-topo",
};
const TWO = [NSW_REGION, NZ];
const ONE = [NSW_REGION];

describe("the region step of the first-login gate", () => {
  // Mutation: return false for two regions, or true for one, or for an
  // existing account.
  it("is for a new account with two regions, and with one it is not there", () => {
    expect(showsRegionStep(true, TWO)).toBe(true);
    expect(showsRegionStep(false, TWO)).toBe(false);
    expect(showsRegionStep(true, ONE)).toBe(false);
  });

  // Mutation: start with a region on, and a new account that taps Continue
  // has chosen without choosing.
  it("draws one switch per region, none on at first", () => {
    expect(regionSwitches([], TWO).map((s) => [s.title, s.checked])).toEqual([
      ["NSW", false],
      ["New Zealand", false],
    ]);
  });

  // Mutation: send on an empty choice, or disable Continue instead of
  // explaining (shared/DESIGN.md §5; the screen passes no `disabled`).
  it("explains an empty choice when Continue is pressed, and sends otherwise", () => {
    expect(regionStepPress([])).toEqual({
      explain: "Choose at least one region.",
    });
    expect(regionStepPress(["nz"])).toEqual({ send: true });
    const source = readFileSync(
      new URL("./ConsentGate.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/disabled=\{regionProblem/);
  });

  it("is built from the contract's copy, and shown by showsRegionStep", () => {
    const source = readFileSync(
      new URL("./ConsentGate.tsx", import.meta.url),
      "utf8",
    );
    // Mutation: type the title back into the screen, or show the step without
    // asking showsRegionStep.
    expect(source).toContain("REGION_CHOICE.title");
    expect(source).toContain("REGION_CHOICE.hint");
    expect(source).toContain("REGION_CHOICE.continue");
    expect(source).toContain("showsRegionStep(newAccount, regions)");
    expect(REGION_CHOICE.title).toBe("Where do you canyon?");
  });
});

describe("the Regions row and page of Settings", () => {
  // Mutation: return null for two regions, or the row for one.
  it("is found with two regions, saying what is chosen, and not with one", () => {
    expect(regionsSettingsRow(["nsw"], TWO)).toEqual({ subtitle: "NSW" });
    expect(regionsSettingsRow(["nsw", "nz"], TWO)).toEqual({
      subtitle: "NSW, New Zealand",
    });
    expect(regionsSettingsRow(["nsw"], ONE)).toBeNull();
  });

  // Mutation: drop the `keepOne` refusal, and the last region can be turned
  // off, which leaves the account choosing none.
  it("refuses to turn the last region off, with the contract's reason", () => {
    const [nsw, nz] = regionSwitches(["nsw"], TWO, true);
    expect(nsw).toMatchObject({ disabled: true, reason: expect.any(String) });
    expect(nz).toMatchObject({ disabled: false, checked: false });
    expect(
      regionSwitches(["nsw", "nz"], TWO, true).some((s) => s.disabled),
    ).toBe(false);
  });

  it("moves one switch and keeps the regions' order", () => {
    expect(toggledRegions(["nz"], "nsw", true, TWO)).toEqual(["nsw", "nz"]);
    expect(toggledRegions(["nsw", "nz"], "nz", false, TWO)).toEqual(["nsw"]);
  });

  // Mutation: draw the row unconditionally, or leave `regions` out of the
  // sections record.
  it("is drawn from regionsSettingsRow and routed to its own page", () => {
    const read = (path: string) =>
      readFileSync(new URL(path, import.meta.url), "utf8");
    expect(read("./SettingsScreen.tsx")).toContain("regionsSettingsRow(");
    expect(read("../AppShell.tsx")).toContain("<RegionsSettingsScreen />");
    expect(read("./settings/RegionsSettingsScreen.tsx")).toContain("keepOne");
  });
});
