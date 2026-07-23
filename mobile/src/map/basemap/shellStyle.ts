// Shell style builder (stage 4a §8.3). Same shell approach as web Map.tsx:
// empty style + glyphs/sprite only; every source and layer is declarative on
// top. Must be an OBJECT — a JSON string is treated as a style URL by the
// native side, which drops the glyphs entry and silently kills every
// SymbolLayer's text.
//
// Glyphs + sprite resolve to the bundled copy under file:// ALWAYS (online
// too) once the first-launch install completes (basemapAssets.ts): zero glyph
// fetches, and offline regions render labels with zero network — the Stage 4a
// requirement. The remote host is only the fallback while installing on first
// launch or if the install fails. No user data rides these requests either way.
export const BASEMAP_ASSETS_REMOTE_BASE =
  "https://protomaps.github.io/basemaps-assets";

export type ProtomapsFlavor = "light" | "dark";

export function buildShellStyle(
  localAssetsBaseUrl: string | null,
  flavor: ProtomapsFlavor,
) {
  const base = (localAssetsBaseUrl ?? BASEMAP_ASSETS_REMOTE_BASE).replace(
    /\/+$/,
    "",
  );
  return {
    version: 8,
    sources: {},
    layers: [
      // A background layer so the style is never empty — matches the primary
      // surface colour while tiles load.
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#4E4944" },
      },
    ],
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}/sprites/v4/${flavor}`,
  };
}
