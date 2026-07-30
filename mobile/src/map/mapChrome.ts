// Map-chrome layout constants, plus the default camera — geometry shared by
// every screen that mounts a map. The floating-button column width dictates how
// far the scale bar may extend, and the search bar has to clear the status bar,
// so the geometry lives here instead of being duplicated per component.

// Circular floating buttons. 72 = the original 48 at 1.5x; the icon scales with
// it so the glyph keeps its proportion inside the circle.
export const FAB_SIZE = 72;
export const FAB_ICON = 32;

// Secondary chrome that must not compete with the primary column: the
// attribution (i) button.
export const MINI_FAB_SIZE = 36;
export const MINI_FAB_ICON = 18;

// Gap between chrome and the screen edge (and between stacked buttons).
export const CHROME_GAP = 16;

/**
 * Bottom of the floating chrome, clearing the scale bar that runs along the very
 * bottom edge. Both control columns share it, and both lift by the recording
 * HUD's measured height when one is up — chrome that stacks on other chrome was
 * the recording panel's old bug, so the offsets live here rather than per
 * component.
 */
export const CHROME_BOTTOM = CHROME_GAP + 32;

/**
 * Opening view: the Blue Mountains, the app's home turf. Shared with the offline
 * download screen, which needs somewhere to start when it is opened from Saved
 * rather than from the map.
 */
export const DEFAULT_CENTER: [number, number] = [150.31, -33.7];
export const DEFAULT_ZOOM = 9;
