import { useCallback, useSyncExternalStore } from "react";

/** Shared narrow-web breakpoint. Keep in sync with the `max-width: 768px`
 *  media queries in the CSS Modules (NavRail, SidebarPanel, Map, index.css). */
export const MOBILE_MAX_WIDTH_PX = 768;

/** Whether a CSS media query matches, live. The browser's own `matchMedia`,
 *  subscribed through React so a resize or a pointer change re-renders. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/** True on phone-sized viewports. Drives JS-only narrow behaviour that CSS
 *  can't express: the BottomSheet instead of the side panel, `fullScreen`
 *  dialogs, and collapsing the sheet during map-pick modes. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`);
}
