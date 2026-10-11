import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A list whose empty state offers a button ends with that same button when it
 * has rows (UX §9): adding is where the eye lands after scrolling down. Each
 * panel names the button once and draws it in both places.
 *
 * Mutation that turns it red: delete a panel's `<ListEnd>` line, or put a
 * different button in the empty state than at the end.
 */
const DIR = dirname(fileURLToPath(import.meta.url));

const PANELS: [file: string, button: string][] = [
  ["PlacesPanel.tsx", "addPlaceButton"],
  ["TripLogsPanel.tsx", "addTripButtons"],
  ["FriendsPanel.tsx", "addFriendButton"],
  ["RoutesPanel.tsx", "addWayButtons"],
  ["GeoPdfsPanel.tsx", "makeGeoPdfButton"],
  ["LidarPanel.tsx", "makeTopoButton"],
  ["PlaceTypeSection.tsx", "addTypeButton"],
];

describe("a list ends with its empty state's add button", () => {
  it.each(PANELS)("%s", (file, button) => {
    const source = readFileSync(join(DIR, file), "utf8");
    expect(source).toContain(`<ListEnd>{${button}}</ListEnd>`);
    // Defined once and drawn in two places: the empty state (or the hero) and the end.
    const mentions = source.match(new RegExp(`\\b${button}\\b`, "g")) ?? [];
    expect(mentions.length).toBeGreaterThanOrEqual(3);
  });

  it("ends the map's Overlays list with the import entry", () => {
    const source = readFileSync(
      join(DIR, "../../map/LayersPopover.tsx"),
      "utf8",
    );
    expect(source).toContain("copy.importFile");
    expect(source).toContain("onImportFile()");
  });
});
