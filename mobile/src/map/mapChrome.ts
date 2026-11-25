// Map-chrome layout constants, plus the default camera — geometry shared by
// every screen that mounts a map. The floating-button column width dictates how
// far the scale bar may extend, and the search bar has to clear the status bar,
// so the geometry lives here instead of being duplicated per component.

import { NSW_REGION } from "@logjam/shared";

/**
 * The search pill's height, and therefore its collapsed diameter: the collapsed
 * circle has to be the same size as the bar it becomes for the expansion to
 * read as one shape growing (see MapSearchBar). The record button and every
 * control-column button share it, so the controls read as one set.
 */
export const SEARCH_SIZE = 52;

// Circular floating buttons. The icon scales with the button so the glyph keeps
// its proportion inside the circle.
export const FAB_SIZE = SEARCH_SIZE;
export const FAB_ICON = 24;

// Secondary chrome that must not compete with the primary column: the
// attribution (i) button.
export const MINI_FAB_SIZE = 36;
export const MINI_FAB_ICON = 18;

// Gap between chrome and the screen edge (and between stacked buttons).
export const CHROME_GAP = 16;

/**
 * How far in from the search pill's edge a map banner sits: past the pill and
 * its gap. The top row has nothing in the other corner (the record button lives
 * in the action column), so on that side a banner runs out to `CHROME_GAP`.
 */
export const MAP_BANNER_INSET = SEARCH_SIZE + CHROME_GAP * 2;

/** The banner column's left and right offsets, given the edge the search pill
 *  collapses into. */
export function mapBannerInsets(searchSide: "left" | "right") {
  return searchSide === "left"
    ? { left: MAP_BANNER_INSET, right: CHROME_GAP }
    : { left: CHROME_GAP, right: MAP_BANNER_INSET };
}

/**
 * Bottom of the floating chrome, clearing the scale bar and the native compass
 * that sit along the bottom edge.
 *
 * It is a constant: dynamic lifting on recording HUD height relies on
 * `onLayout` which does not fire when unmounting, leaving chrome displaced.
 * The HUD lives in the top notice stack instead, where it competes with
 * nothing and this number cannot move. The record button joins the action
 * column's own flow, so the column grows upward from here and this number
 * stays put.
 */
export const CHROME_BOTTOM = CHROME_GAP + 32;

/**
 * Opening view: the region's (`NSW_REGION.view`). Shared with the offline
 * download screen, which needs somewhere to start when it is opened from Saved
 * rather than from the map.
 */
export const DEFAULT_CENTER: [number, number] = [...NSW_REGION.view.center];
export const DEFAULT_ZOOM: number = NSW_REGION.view.zoom;
