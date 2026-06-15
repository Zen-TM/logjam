import { useMediaQuery } from "@mui/material";

/** Shared mobile breakpoint. Keep in sync with the `max-width: 768px` media
 *  queries in the CSS Modules (NavRail, SidebarPanel, Map, index.css). */
export const MOBILE_MAX_WIDTH_PX = 768;

/** True on phone-sized viewports. Drives JS-only mobile behaviour that CSS
 *  can't express: rendering the BottomSheet instead of the flyout panel,
 *  `fullScreen` dialogs, and collapsing the sheet during map-pick modes. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width:${MOBILE_MAX_WIDTH_PX}px)`);
}
