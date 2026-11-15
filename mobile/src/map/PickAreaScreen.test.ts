import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The screen draws with no renderer in this suite, so the basemap it opens on
// is read from source. Mutation: read `readBasemapPreference()` in the screen
// (or take `home` out of the view), and a cold start into the Saved tab with a
// home outside NSW draws a blank SIX sheet for an NSW pick.
describe("PickAreaScreen's basemap", () => {
  it("is the last camera's, else the stored pick as drawn over home", () => {
    const source = readFileSync(
      new URL("./PickAreaScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "lastCamera?.basemapId ?? readEffectiveBasemap(pointBox(...home.center))",
    );
    expect(source).not.toContain("readBasemapPreference");
  });
});
