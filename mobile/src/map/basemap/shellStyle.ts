// Shell style builder (stage 4a §8.3). Same shell approach as web Map.tsx:
// empty style + glyphs/sprite only; every source and layer is declarative on
// top. Must be an OBJECT — a JSON string is treated as a style URL by the
// native side, which drops the glyphs entry and silently kills every
// symbol layer's text.
//
// Glyphs + sprite resolve to the bundled copy under file:// ALWAYS (online
// too) once the first-launch install completes (basemapAssets.ts): zero glyph
// fetches, and offline regions render labels with zero network — the Stage 4a
// requirement. The remote host is only the fallback while installing on first
// launch or if the install fails. No user data rides these requests either way.
import type { StyleSpecification } from "@maplibre/maplibre-react-native";

import { theme } from "../../theme";

export const BASEMAP_ASSETS_REMOTE_BASE =
  "https://protomaps.github.io/basemaps-assets";

export type ProtomapsFlavor = "light" | "dark";

export function buildShellStyle(
  localAssetsBaseUrl: string | null,
  flavor: ProtomapsFlavor,
): StyleSpecification {
  const base = (localAssetsBaseUrl ?? BASEMAP_ASSETS_REMOTE_BASE).replace(
    /\/+$/,
    "",
  );
  return {
    version: 8,
    sources: {},
    layers: [
      // A background layer so the style is never empty. It is the PAGE colour,
      // and it has to be the same colour the offline mask paints with: zoomed
      // out past the mask's extent the background is what shows, and two
      // different "nothing here" colours reads as a rendering fault.
      {
        id: "background",
        type: "background",
        paint: { "background-color": theme.primary },
      },
    ],
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}/sprites/v4/${flavor}`,
  };
}
