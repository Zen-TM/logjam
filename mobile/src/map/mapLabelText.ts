// The font and size of every label drawn by a MapLibre symbol layer, declared
// once. A map label is drawn from the basemap's glyph files at a size MapLibre
// resolves per zoom, so none of the type roles (and none of the text-size
// preference) reaches it. `mobile/eslint.config.js` bans `textSize` and `textFont`
// everywhere else.

import { MAP_LABEL_SIZE } from "@logjam/shared";

import { textScale } from "../theme";

const MAP_LABEL_FONT = ["Noto Sans Medium"];

/** A pin's name follows the text-size setting, but stops at 1.5x: past that a
 *  name is wider than the pin spacing it was placed for. */
const PIN_LABEL_MAX_SCALE = 1.5;

/** A place pin's name. */
export const PIN_LABEL_TEXT = {
  textFont: MAP_LABEL_FONT,
  textSize: MAP_LABEL_SIZE.pin * Math.min(textScale, PIN_LABEL_MAX_SCALE),
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
    textSize: [
      "interpolate",
      ["linear"],
      ["zoom"],
      MAP_LABEL_SIZE.rampFrom[0],
      MAP_LABEL_SIZE.rampFrom[1] * s,
      MAP_LABEL_SIZE.rampTo[0],
      MAP_LABEL_SIZE.rampTo[1] * s,
    ],
  };
}
