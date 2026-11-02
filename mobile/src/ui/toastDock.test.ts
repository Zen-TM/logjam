import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The map's toast sat over the Record button and the speed/elevation chip, the
// two things a recording needs in view.
describe("the map's toast", () => {
  // Mutation: drop the `clear={{ … }}` prop from the map's <Toast>, and it
  // docks at the screen edge again, over the action column and the instruments.
  it("docks clear of the action column and the instruments", () => {
    const map = readFileSync(
      new URL("../map/MapScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(map).toMatch(
      /<Toast\s+message=\{toast\}[\s\S]*?clear=\{\{\s*bottom: ornamentMarginY,\s*\[controlsOnLeft \? "left" : "right"\]: FAB_SIZE \+ CHROME_GAP/,
    );
  });
});
