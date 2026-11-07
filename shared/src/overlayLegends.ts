// What each statewide overlay's row says and what the legend behind its help
// button holds, on both clients: one declaration, so the two legends never
// drift, and each client draws any overlay's row and legend the same way
// (Logjam Web `OverlayLegendRow`; Logjam GPS `overlayRow` and
// `OverlayLegendSheet` in `MapLayersSheet.tsx`).
import { MAP_TERRAIN } from "./contracts/mapTerrain.js";
import { MAP_INK } from "./designTokens.js";
import {
  CARRIERS,
  COVERAGE_HATCH_URIS,
  COVERAGE_LEVELS,
  NSW_COVERAGE,
} from "./nswCoverage.js";
import { FIRE_RAMP, fireLegendRows, NSW_FIRE } from "./nswFire.js";
import { LAND_CLASSES, NSW_LAND } from "./nswLand.js";
import type { OverlayTerrainKey } from "./terrain.js";

export type OverlayLegend = {
  /** The row's label and the legend's title. */
  title: string;
  /** The help button's label. */
  about: string;
  /** The row's glyph tile. */
  hue: string;
  /** What the colours mean, first in the legend. */
  intro: string;
  /**
   * The key, a swatch per row, in the order the legend lists them: the
   * colour, with `pattern` (an image drawn at `COVERAGE_HATCH_PIXEL_RATIO`)
   * over it at the map's scale.
   */
  rows: readonly { label: string; colour: string; pattern?: string }[];
  /**
   * A setting of what the overlay draws, picked at the top of its legend and
   * named under its row: Coverage's carrier. The value is the client's.
   */
  choice?: {
    label: string;
    options: readonly { value: string; label: string }[];
  };
  /** What the source gets wrong, said beside the key it qualifies. */
  caveat: string;
  /** The data's licence credit, which the legend shows in full. */
  credit: string;
};

const copy = MAP_TERRAIN.copy;

export const OVERLAY_LEGENDS: Readonly<
  Record<OverlayTerrainKey, OverlayLegend>
> = {
  land: {
    title: copy.land,
    about: copy.landAbout,
    hue: LAND_CLASSES[0].colour,
    intro: copy.landLegend,
    rows: LAND_CLASSES.map(({ name, colour }) => ({ label: name, colour })),
    caveat: copy.landCaveat,
    credit: NSW_LAND.credit,
  },
  fire: {
    title: copy.fire,
    about: copy.fireAbout,
    hue: FIRE_RAMP[0].colour,
    intro: copy.fireLegend,
    rows: fireLegendRows(),
    caveat: copy.fireCaveat,
    credit: NSW_FIRE.credit,
  },
  coverage: {
    title: copy.coverage,
    about: copy.coverageAbout,
    hue: MAP_INK.casing,
    intro: copy.coverageLegend,
    // Over the light land of a basemap, as the hatch is drawn on the map.
    rows: COVERAGE_LEVELS.flatMap(({ name, hatch }) =>
      hatch
        ? [
            {
              label: name[0]!.toUpperCase() + name.slice(1),
              colour: MAP_INK.label,
              pattern: COVERAGE_HATCH_URIS[hatch],
            },
          ]
        : [],
    ),
    choice: {
      label: copy.coverageCarrier,
      options: CARRIERS.map(({ id, name }) => ({ value: id, label: name })),
    },
    caveat: copy.coverageCaveat,
    credit: NSW_COVERAGE.credit,
  },
};

/** The label of the option `value` names in `legend`'s choice, if it has one. */
export function overlayChoiceLabel(
  legend: OverlayLegend,
  value: string | undefined,
): string | undefined {
  return legend.choice?.options.find((o) => o.value === value)?.label;
}
