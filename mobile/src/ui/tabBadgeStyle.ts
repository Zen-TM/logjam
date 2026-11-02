import type { ViewStyle } from "react-native";

/**
 * React Navigation gives its badge a fixed 18 px height, which clips a count
 * once the system font is scaled. Unsetting it sizes the badge from its text.
 */
export const TAB_BADGE_STYLE: ViewStyle = { height: undefined };
