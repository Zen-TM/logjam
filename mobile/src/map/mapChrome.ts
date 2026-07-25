// Map-chrome layout constants. The floating-button column width dictates how
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
