import { useSyncExternalStore, type ReactNode } from "react";
import { View } from "react-native";

import type { useHeroCollapse } from "./useHeroCollapse";

/**
 * The pinned hero of a list that collapses (`useHeroCollapse`). It reads the
 * flag itself, so the screen around it does not re-render when the list
 * crosses the threshold; `children` draws the hero for the current form.
 */
export function CollapsingHero({
  collapse,
  children,
}: {
  collapse: ReturnType<typeof useHeroCollapse>;
  children: (compact: boolean) => ReactNode;
}) {
  const compact = useSyncExternalStore(collapse.subscribe, collapse.getCompact);
  return <View {...collapse.heroProps}>{children(compact)}</View>;
}
