import type { ViewStyle } from "react-native";

/** React Navigation's badge font size at its default size. */
const BADGE_FONT = 14;
/** The badge's own horizontal padding (4 each side) plus slack for the font's width. */
const BADGE_PAD = 10;

/**
 * React Navigation gives its badge a fixed 18 px height, which clips a count
 * once the system font is scaled, and an absolutely positioned one-line width
 * that cuts a two-digit count to "1…". Unsetting the height sizes it from its
 * text; the width is worked out from the label and the font scale, because a
 * measured width is the one thing an absolutely positioned Text cannot be asked
 * for. Guard: fontScale.test.ts.
 */
export function tabBadgeStyle(label: string, fontScale: number): ViewStyle {
  return {
    height: undefined,
    minWidth: undefined,
    width: Math.ceil(label.length * BADGE_FONT * fontScale * 0.65 + BADGE_PAD),
  };
}

/** A count the badge can hold: never more than three characters. */
export const tabBadgeLabel = (count: number): string =>
  count > 99 ? "99+" : String(count);
