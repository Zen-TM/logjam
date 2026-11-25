import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NSW_REGION, REGION_CHOICE, type Region } from "@logjam/shared";

import {
  regionContinueProps,
  regionsSettingsRow,
  regionStepPress,
  regionSwitches,
  sendsRegionChoice,
  showsRegionStep,
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
  });

  // Mutation: add `disabled: regionStepPress(chosen) !== send` (or any
  // `disabled`) to regionContinueProps, and an empty choice greys Continue out
  // with no word on why.
  it("gives Continue no disabled prop, whatever is chosen", () => {
    const onPress = () => {};
    const props = regionContinueProps(false, onPress);
    expect(props).toEqual({
      label: "Continue",
      onPress,
      loading: false,
    });
    expect("disabled" in props).toBe(false);
    expect(regionContinueProps(true, onPress).loading).toBe(true);
  });

  // Mutation: draw Continue by hand in RegionStep (not from
  // regionContinueProps), leave its switches live while a send is in flight,
  // show the step without asking showsRegionStep, or drop the step's Sign out.
  it("is one screen, drawn from the contract's copy and shown by the decisions", () => {
    const read = (path: string) =>
      readFileSync(new URL(path, import.meta.url), "utf8");
    const step = read("./RegionStep.tsx");
    expect(step).toContain("REGION_CHOICE.title");
    expect(step).toContain("REGION_CHOICE.hint");
    expect(step).toContain("<Button {...regionContinueProps(");
    expect(step).toContain("useRegionsSending()");
    expect(step).toContain("disabled={sending}");
    expect(step).toContain("onPress={onSignOut}");
    expect(read("./ConsentGate.tsx")).toContain("<RegionStep");
    expect(read("./ConsentGate.tsx")).toContain(
      "showsRegionStep(newAccount, regions)",
    );
    expect(read("../AppShell.tsx")).toContain("showsRegionStep(newAccount)");
    expect(REGION_CHOICE.title).toBe("Where do you canyon?");
  });
});

describe("the step right after Logjam GPS's own sign-up form", () => {
  // Mutation: drop `newAccount={auth.newAccount}` (AppShell defaults it to
  // false, and the step never shows after the form), or stop the step's done
  // clearing it (a relock remounts AppShell and asks again, over the choice).
  it("is fed and finished from useAuth", () => {
    const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
    expect(app).toContain("newAccount={auth.newAccount}");
    expect(app).toContain("onNewAccountDone={auth.finishNewAccount}");
    const shell = readFileSync(
      new URL("../AppShell.tsx", import.meta.url),
      "utf8",
    );
    expect(shell.match(/onNewAccountDone\?\.\(\)/g)?.length).toBe(2);
  });
});

describe("whether a region choice goes to the account", () => {
  // Mutation: send for a guest (ADR 0007), or never for a linked account.
  it("is no for a guest and yes for a linked account", () => {
    expect(sendsRegionChoice("guest")).toBe(false);
    expect(sendsRegionChoice("linked")).toBe(true);
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

  // Mutation: drop the `keepOne` refusal (regionOffRefusal), and the last
  // region can be turned off, which leaves the account choosing none.
  it("refuses to turn the last region off, with the contract's reason", () => {
    const [nsw, nz] = regionSwitches(["nsw"], TWO, true);
    expect(nsw).toMatchObject({ disabled: true, reason: expect.any(String) });
    expect(nz).toMatchObject({ disabled: false, checked: false });
    expect(
      regionSwitches(["nsw", "nz"], TWO, true).some((s) => s.disabled),
    ).toBe(false);
  });

  // Mutation: drop `|| sending` from the page's switches, or send by
  // `accountState !== "guest"` instead of sendsRegionChoice.
  it("holds its switches while a send is in flight", () => {
    const read = (path: string) =>
      readFileSync(new URL(path, import.meta.url), "utf8");
    const page = read("./settings/RegionsSettingsScreen.tsx");
    expect(page).toContain("useRegionsSending()");
    expect(page).toContain("disabled={offline || sending}");
    expect(page).toContain("sendsRegionChoice(");
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
