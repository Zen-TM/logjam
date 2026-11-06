import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A list whose empty state offers a button ends with that same button when it
 * has rows (UX §9): adding is where the eye lands after scrolling down. Each
 * panel names the button once and draws it in both places. Friends is the
 * exception, with Place types, Plans and a plan's pages: the hero's add is
 * already there, so a second at the end of the rows would be a duplicate.
 *
 * Mutation that turns it red: delete a panel's `<ListEnd>` line, put a
 * different button in the empty state than at the end, or add a `<ListEnd>`
 * to a page that has its add in the hero.
 */
const DIR = dirname(fileURLToPath(import.meta.url));

const PANELS: [file: string, button: string][] = [
  ["PlacesPanel.tsx", "addPlaceButton"],
  ["TripLogsPanel.tsx", "addTripButtons"],
  ["RoutesPanel.tsx", "addWayButtons"],
];

// Their hero already carries every add, so a button at the end of the rows
// would be a second one.
const HERO_ADD_ONLY = [
  "FriendsPanel.tsx",
  "PlaceTypeSection.tsx",
  "../../plans/PlansPanel.tsx",
  "../../plans/PlanDetailPanel.tsx",
  "../../plans/PlanItems.tsx",
];

describe("a list ends with its empty state's add button", () => {
  it.each(PANELS)("%s", (file, button) => {
    const source = readFileSync(join(DIR, file), "utf8");
    expect(source).toContain(`<ListEnd>{${button}}</ListEnd>`);
    // Defined once and drawn in two places: the empty state (or the hero) and the end.
    const mentions = source.match(new RegExp(`\\b${button}\\b`, "g")) ?? [];
    expect(mentions.length).toBeGreaterThanOrEqual(3);
  });

  it.each(HERO_ADD_ONLY)("%s keeps its add in the hero alone", (file) => {
    expect(readFileSync(join(DIR, file), "utf8")).not.toContain("<ListEnd>");
  });

  it("ends the map's Overlays list with the import entry", () => {
    const source = readFileSync(
      join(DIR, "../../map/LayersPopover.tsx"),
      "utf8",
    );
    expect(source).toContain("copy.importFile}");
    expect(source).toContain("onImportFile()");
  });
});
