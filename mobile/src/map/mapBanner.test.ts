import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CHROME_GAP, MAP_BANNER_INSET, SEARCH_SIZE } from "./mapChrome";

// A MAP BANNER IS THE KIT'S `MapBanner` (shared/DESIGN.md §15). A mode with a
// way out drawn as a `Notice` with an X in a map file is the old,
// squarer banner back, at the wrong height, colour and place.
//
// Mutations that turn it red: put `action={<IconButton .../>}` back on a `<Notice` in
// MapScreen.tsx; make MAP_BANNER_INSET smaller than the record button's
// reserved width (`SEARCH_SIZE + CHROME_GAP`) plus the gap.
const hasNoticeWithAction = (src: string) =>
  /<Notice\b[^>]*\baction=\{\s*<IconButton/.test(src);

describe("map banners", () => {
  it("recognises the Notice it forbids", () => {
    expect(
      hasNoticeWithAction("<Notice icon='plan' action={ <IconButton />}>"),
    ).toBe(true);
    expect(hasNoticeWithAction("<Notice icon='offline'>")).toBe(false);
  });

  it("no map file draws its own with a Notice action", () => {
    const offenders = readdirSync(__dirname)
      .filter((f) => /\.tsx$/.test(f))
      .filter((f) =>
        hasNoticeWithAction(readFileSync(join(__dirname, f), "utf8")),
      );
    expect(offenders).toEqual([]);
  });

  it("sits inside the footprint an open search bar covers", () => {
    // The bar ends `reservedWidth` (the record button and its gap) short of
    // the far edge, which is a gap further in than the button.
    expect(MAP_BANNER_INSET).toBe(SEARCH_SIZE + CHROME_GAP + CHROME_GAP);
  });
});
