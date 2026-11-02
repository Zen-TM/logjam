import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MAP_LABEL_SIZE } from "@logjam/shared";

import { PIN_LABEL_TEXT, topoLabelText } from "./mapLabelText";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("the map's marks and chrome", () => {
  // Mutation: type 13 into `PIN_LABEL_TEXT` or the topo ramp, and Logjam GPS's
  // labels stop matching Logjam Web's.
  it("sizes labels from MAP_LABEL_SIZE", () => {
    // Plain node has a text scale of 1.
    expect(PIN_LABEL_TEXT.textSize).toBe(MAP_LABEL_SIZE.pin);
    expect(topoLabelText(1).textSize).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      MAP_LABEL_SIZE.rampFrom[0],
      MAP_LABEL_SIZE.rampFrom[1] * 1.75,
      MAP_LABEL_SIZE.rampTo[0],
      MAP_LABEL_SIZE.rampTo[1] * 1.75,
    ]);
  });

  // Mutation: set `backgroundColor: scrim.heavy` back in MapBackButton, and
  // the pickers' back arrow stops looking like the map's other buttons.
  it("draws every map control as a card with a hairline edge", () => {
    expect(read("MapBackButton.tsx")).not.toMatch(/scrim\.|ON_SCRIM/);
    for (const file of [
      "MapBackButton.tsx",
      "MapToolGroup.tsx",
      "MapSearchBar.tsx",
    ]) {
      expect(read(file), file).toMatch(
        /backgroundColor: theme\.card,\s+borderWidth: 1,\s+borderColor: theme\.line/,
      );
    }
    const screen = read("MapScreen.tsx");
    expect(screen.match(/borderColor: theme\.line/g)).toHaveLength(2);
  });

  // Mutation: delete the `statusScrim` View from MapScreen, and the clock
  // and icons sit straight on the basemap again.
  it("veils the status bar", () => {
    expect(read("MapScreen.tsx")).toContain("styles.statusScrim");
  });
});
