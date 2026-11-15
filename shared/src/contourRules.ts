// The statewide contour lines (`NSW_REGION.terrain.contours`, regions.ts), and
// when a map draws them.
import { BASEMAP_CATALOG } from "./geoPdfBaseLayers.js";
import {
  VECTOR_STYLE_DEFAULTS,
  type VectorStyleSettings,
} from "./topoSettings.js";

/**
 * Whether the statewide contours are drawn over a basemap: when the Terrain
 * group's Contours switch is on, over the vector basemap, which has none of its
 * own, and over imagery. The topographic sheets already print theirs.
 */
export function drawsNswContours(basemapId: string, on: boolean): boolean {
  return on && takesContours(basemapId);
}

const entryOf = (basemapId: string) =>
  BASEMAP_CATALOG.find((entry) => entry.id === basemapId);

/**
 * Whether a basemap has room for the statewide contours: a catalogue entry that
 * prints none of its own. An id the catalogue does not hold takes none.
 */
export function takesContours(basemapId: string): boolean {
  const entry = entryOf(basemapId);
  return entry !== undefined && entry.printsContours !== true;
}

/**
 * Whether the hillshade is drawn over a basemap: when its switch is on, except
 * over photographs, which already carry their own shadows.
 */
export function drawsNswHillshade(basemapId: string, on: boolean): boolean {
  return on && takesHillshade(basemapId);
}

/** Whether a basemap has room for the hillshade: every one but photographs. */
export function takesHillshade(basemapId: string): boolean {
  return entryOf(basemapId)?.photo !== true;
}

/** Imagery is dark, and the brown a paper map prints its contours in is lost on it. */
const OVER_IMAGERY = { majorColour: "#ffffffe6", minorColour: "#ffffff8c" };

/**
 * The style the statewide contours are drawn in: a fixed look, the brown of a
 * paper map, with light lines over imagery. Deliberately NOT the user's topo
 * style: that belongs to the LiDAR contours of a topo area, a different thing,
 * and restyling one should not restyle the other.
 */
export function nswContourStyle(basemapId: string): VectorStyleSettings {
  return entryOf(basemapId)?.photo
    ? {
        ...VECTOR_STYLE_DEFAULTS,
        contours: { ...VECTOR_STYLE_DEFAULTS.contours, ...OVER_IMAGERY },
      }
    : VECTOR_STYLE_DEFAULTS;
}

/**
 * The halo behind a contour label, which is drawn in the major line's colour
 * (`#RRGGBBAA`): dark behind a light label, light behind a dark one.
 */
export function contourLabelHalo(majorColour: string): string {
  const [r, g, b] = [1, 3, 5].map((i) =>
    parseInt(majorColour.slice(i, i + 2), 16),
  );
  const light = 0.299 * r! + 0.587 * g! + 0.114 * b! > 150;
  return light ? "rgba(0, 0, 0, 0.7)" : "rgba(255, 255, 255, 0.8)";
}
