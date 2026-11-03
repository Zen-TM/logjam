import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  LayoutAnimation,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

/** Scrolled this far, the full hero gives way; back at the top, it returns. */
export const COLLAPSE_AT = 32;
const EXPAND_AT = 4;
const COMPACT_ROW = 56;

/**
 * Whether a list's pinned hero is full or compact, from the list's own scroll.
 *
 * `compact` flips past `COLLAPSE_AT` and back at the top. It collapses only
 * when the list would still scroll afterwards: the compact hero hands its
 * height to the list, and a list that no longer overflowed would scroll back to
 * the top and expand again, over and over. The swap eases unless the user asked
 * for reduced motion. Guard: `heroCollapse.test.ts`.
 *
 * Spread `scrollProps` on the list and `heroProps` on a `View` around the hero.
 */
export function useHeroCollapse() {
  const [compact, setCompact] = useState(false);
  const fullHeight = useRef(0);
  const compactHeight = useRef(COMPACT_ROW);
  const state = useRef(false);
  const reduceMotion = useRef(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) reduceMotion.current = on;
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (on) => {
        reduceMotion.current = on;
      },
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const set = useCallback((next: boolean) => {
    if (state.current === next) return;
    state.current = next;
    if (!reduceMotion.current)
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCompact(next);
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const y = contentOffset.y;
      if (state.current) {
        if (y <= EXPAND_AT) set(false);
        return;
      }
      const gives = Math.max(0, fullHeight.current - compactHeight.current);
      const overflow = contentSize.height - layoutMeasurement.height;
      if (y > COLLAPSE_AT && overflow > gives + COLLAPSE_AT) set(true);
    },
    [set],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    if (state.current) compactHeight.current = height;
    else fullHeight.current = height;
  }, []);

  return {
    compact,
    scrollProps: { onScroll, scrollEventThrottle: 32 },
    heroProps: { onLayout },
  };
}
