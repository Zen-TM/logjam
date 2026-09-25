// Map-chrome layout constants, plus the default camera — geometry shared by
// every screen that mounts a map. The floating-button column width dictates how
// far the scale bar may extend, and the search bar has to clear the status bar,
// so the geometry lives here instead of being duplicated per component.

// Circular floating buttons. 72 = the original 48 at 1.5x; the icon scales with
// it so the glyph keeps its proportion inside the circle.
export const FAB_SIZE = 72;
export const FAB_ICON = 32;

/**
 * The search pill's height, and therefore its collapsed diameter. Smaller than
 * a control-column button on purpose: search is a thing you go looking for,
 * not one you reach for with a thumb mid-scramble, and the collapsed circle has
 * to be the same size as the bar it becomes for the expansion to read as one
 * shape growing (see MapSearchBar).
 */
export const SEARCH_SIZE = 52;

// Secondary chrome that must not compete with the primary column: the
// attribution (i) button.
export const MINI_FAB_SIZE = 36;
export const MINI_FAB_ICON = 18;

// Gap between chrome and the screen edge (and between stacked buttons).
export const CHROME_GAP = 16;

/**
 * Bottom of the floating chrome, clearing the scale bar and the native compass
 * that sit along the bottom edge.
 *
 * It is a CONSTANT. It used to grow by the recording HUD's measured height so
 * the columns could lift out of its way — but `onLayout` never fires on the way
 * out, so the lift stuck after a recording ended and every button stayed shoved
 * up the screen until the app restarted. The HUD now lives in the top notice
 * stack, where it competes with nothing and this number can't move.
 */
export const CHROME_BOTTOM = CHROME_GAP + 32;

/**
 * Opening view: the Blue Mountains, the app's home turf. Shared with the offline
 * download screen, which needs somewhere to start when it is opened from Saved
 * rather than from the map.
 */
export const DEFAULT_CENTER: [number, number] = [150.31, -33.7];
export const DEFAULT_ZOOM = 9;
