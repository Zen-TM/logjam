import { describe, expect, it } from "vitest";

import { BASEMAP_ASSETS_REMOTE_BASE, buildShellStyle } from "./shellStyle";

describe("buildShellStyle", () => {
  it("uses bundled file:// URLs when the local assets base is available", () => {
    const style = buildShellStyle(
      "file:///data/user/0/com.logjamnsw.mobile/files/basemap-assets/",
      "light",
    );
    expect(style.glyphs).toBe(
      "file:///data/user/0/com.logjamnsw.mobile/files/basemap-assets/fonts/{fontstack}/{range}.pbf",
    );
    expect(style.sprite).toBe(
      "file:///data/user/0/com.logjamnsw.mobile/files/basemap-assets/sprites/v4/light",
    );
  });

  it("falls back to the remote asset host when install failed", () => {
    const style = buildShellStyle(null, "light");
    expect(style.glyphs).toBe(
      `${BASEMAP_ASSETS_REMOTE_BASE}/fonts/{fontstack}/{range}.pbf`,
    );
    expect(style.sprite).toBe(`${BASEMAP_ASSETS_REMOTE_BASE}/sprites/v4/light`);
  });

  it("selects the sprite flavor", () => {
    expect(buildShellStyle(null, "dark").sprite).toMatch(/\/sprites\/v4\/dark$/);
  });

  it("is a style OBJECT with a background layer (never an empty style)", () => {
    const style = buildShellStyle(null, "light");
    expect(style.version).toBe(8);
    expect(style.layers[0]?.type).toBe("background");
  });
});
