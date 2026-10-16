// The font and size of every label drawn by a MapLibre symbol layer, declared
// once. A map label is drawn from the basemap's glyph files at a size MapLibre
// resolves per zoom, so none of the type roles (and none of the text-size
// preference) reaches it. `mobile/eslint.config.js` bans `textSize` and `textFont`
// everywhere else.

const MAP_LABEL_FONT = ["Noto Sans Medium"];

/** A place pin's name, at a fixed size in px. */
export const PIN_LABEL_TEXT = {
  textFont: MAP_LABEL_FONT,
  textSize: 12,
};

// Base label-size bump matching Logjam Web's live map
// (`frontend/src/components/map/Map.tsx`, `WEB_LABEL_BASE_SCALE` — the export
// bakers deliberately diverge with their own larger base).
const TOPO_LABEL_BASE_SCALE = 1.75;

/** A topo overlay's label, growing with the zoom; `scale` is the user's own
 *  label-size setting for the overlay. */
export function topoLabelText(scale: number) {
  const s = scale * TOPO_LABEL_BASE_SCALE;
  return {
    textFont: MAP_LABEL_FONT,
    textSize: ["interpolate", ["linear"], ["zoom"], 14, 9 * s, 18, 12 * s],
  };
}
