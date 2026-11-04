import { describe, expect, it } from "vitest";

import { isOutsideToolsTouch } from "./toolsTouch";

// Mutation: drop the `!` (a touch on the + or a pill closes the tray it just
// opened, so the + can never open it), or drop `trayOpen &&` (every touch on
// the map is ignored with the tray shut).
describe("isOutsideToolsTouch", () => {
  it("is true only for a touch that did not start on the tools, tray open", () => {
    expect(isOutsideToolsTouch(true, false)).toBe(true);
    expect(isOutsideToolsTouch(true, true)).toBe(false);
    expect(isOutsideToolsTouch(false, false)).toBe(false);
    expect(isOutsideToolsTouch(false, true)).toBe(false);
  });
});
