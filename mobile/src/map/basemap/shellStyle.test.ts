import { DEFAULT_THEME_SCHEME_ID, THEME_SCHEMES } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import {
  BASEMAP_ASSETS_REMOTE_BASE,
  buildShellStyle,
  TERRAIN_SOURCE_ID,
} from "./shellStyle";

const theme = THEME_SCHEMES[DEFAULT_THEME_SCHEME_ID].tokens;

describe("buildShellStyle", () => {
  it("uses bundled file:// URLs when the local assets base is available", () => {
    const style = buildShellStyle(
      "file:///data/user/0/com.logjamnsw.mobile/files/basemap-assets/",
      "light",
      theme,
    );
    expect(style.glyphs).toBe(
      "file:///data/user/0/com.logjamnsw.mobile/files/basemap-assets/fonts/{fontstack}/{range}.pbf",
    );
    expect(style.sprite).toBe(
      "file:///data/user/0/com.logjamnsw.mobile/files/basemap-assets/sprites/v4/light",
    );
  });

  it("falls back to the remote asset host when install failed", () => {
    const style = buildShellStyle(null, "light", theme);
    expect(style.glyphs).toBe(
      `${BASEMAP_ASSETS_REMOTE_BASE}/fonts/{fontstack}/{range}.pbf`,
    );
    expect(style.sprite).toBe(`${BASEMAP_ASSETS_REMOTE_BASE}/sprites/v4/light`);
  });

  it("selects the sprite flavor", () => {
    expect(buildShellStyle(null, "dark", theme).sprite).toMatch(
      /\/sprites\/v4\/dark$/,
    );
  });

  it("is a style OBJECT with a background layer (never an empty style)", () => {
    const style = buildShellStyle(null, "light", theme);
    expect(style.version).toBe(8);
    expect(style.layers[0]?.type).toBe("background");
  });

  // Mutation: drop the `sources` entry, or the `terrain` spread, in buildShellStyle.
  it("has a root terrain only when on, naming a raster-dem source of its own", () => {
    expect(buildShellStyle(null, "light", theme)).not.toHaveProperty("terrain");
    const style = buildShellStyle(null, "light", theme, {
      url: "pmtiles://https://cdn.example/dem.pmtiles",
    });
    expect(style.terrain?.source).toBe(TERRAIN_SOURCE_ID);
    expect(style.sources[style.terrain!.source]?.type).toBe("raster-dem");
  });
});
