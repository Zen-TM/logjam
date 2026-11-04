import { useSafeAreaInsets } from "react-native-safe-area-context";

import { spacing } from "../theme";

/** `@react-navigation/bottom-tabs`' own TABBAR_HEIGHT_UIKIT, which it does not export. */
export const TAB_BAR_BASE_HEIGHT = 49;
export const TAB_BAR_TOP_PAD = spacing(0.5);

/** The tab bar's height: what the navigator is given, and what a toast docks above. */
export function useTabBarHeight(): number {
  return TAB_BAR_BASE_HEIGHT + TAB_BAR_TOP_PAD + useSafeAreaInsets().bottom;
}
