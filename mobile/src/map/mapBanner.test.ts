import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CHROME_GAP,
  MAP_BANNER_INSET,
  SEARCH_SIZE,
  mapBannerInsets,
} from "./mapChrome";

// A MAP BANNER IS THE KIT'S `MapBanner` (shared/DESIGN.md §15). A mode with a
// way out drawn as a `Notice` with an X in a map file is the old,
// squarer banner back, at the wrong height, colour and place.
//
// Mutations that turn it red: put `action={<IconButton .../>}` back on a `<Notice` in
// MapScreen.tsx; make MAP_BANNER_INSET smaller than the search pill plus two
// gaps; give `mapBannerInsets` the inset on the wrong side (the banner would
// cover the pill, or leave the freed corner empty); pass `mapBannerInsets` or
// `<MapSearchBar side=` anything but the one `searchSide` in MapScreen.tsx.
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

  it("clears the search pill's side and runs to the gap on the other", () => {
    expect(MAP_BANNER_INSET).toBe(SEARCH_SIZE + CHROME_GAP * 2);
    expect(mapBannerInsets("left")).toEqual({
      left: MAP_BANNER_INSET,
      right: CHROME_GAP,
    });
    expect(mapBannerInsets("right")).toEqual({
      left: CHROME_GAP,
      right: MAP_BANNER_INSET,
    });
  });

  it("gives the banner and the search pill the same side", () => {
    const src = readFileSync(join(__dirname, "MapScreen.tsx"), "utf8");
    expect(src).toContain("...mapBannerInsets(searchSide)");
    expect(src).toContain("side={searchSide}");
    expect(src).toContain(
      'const searchSide = controlsOnLeft ? "right" : "left"',
    );
  });
});
