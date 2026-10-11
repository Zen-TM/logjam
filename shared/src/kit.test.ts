import { describe, expect, it } from "vitest";
import {
  barrelComponents,
  isKitComponentName,
  KIT_COMPONENTS,
  kitComponentsFor,
  type KitEntry,
} from "./kit.js";

describe("KIT_COMPONENTS", () => {
  it("gives every platform-only component a reason", () => {
    for (const [name, entry] of Object.entries(
      KIT_COMPONENTS as Record<string, KitEntry>,
    )) {
      if (entry.platform === "both") continue;
      expect(entry.reason.length, `${name} needs a reason`).toBeGreaterThan(8);
    }
  });

  it("splits into a web set and a gps set that share every `both`", () => {
    const both = Object.entries(KIT_COMPONENTS as Record<string, KitEntry>)
      .filter(([, entry]) => entry.platform === "both")
      .map(([name]) => name);
    for (const name of both) {
      expect(kitComponentsFor("web")).toContain(name);
      expect(kitComponentsFor("gps")).toContain(name);
    }
  });
});

describe("barrelComponents", () => {
  it("counts PascalCase values, not types, hooks, constants or comments", () => {
    const source = `
      // export { Commented } from "./Commented";
      export { Button, type ButtonProps } from "./Button";
      export { useEscape } from "./useEscape";
      export { CHIP_HEIGHT, Chip as RailChip } from "./Chip";
      export * from "./everything";
    `;
    expect(barrelComponents(source)).toEqual(["Button", "RailChip"]);
  });

  it("tells a component from a constant by its lower-case letter", () => {
    expect(isKitComponentName("Row")).toBe(true);
    expect(isKitComponentName("SEGMENTED_CONTROL_HEIGHT")).toBe(false);
    expect(isKitComponentName("toDateKey")).toBe(false);
  });
});
