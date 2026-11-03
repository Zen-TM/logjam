import { useCallback, useRef, useState } from "react";
import {
  LayoutAnimation,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { COMPACT_ROW, nextCompact } from "./heroCollapseRule";
import { useReducedMotionRef } from "./useReducedMotion";

/**
 * Whether a list's pinned hero is full or compact, from the list's own scroll,
 * size and layout (`nextCompact` holds the rule; guard: `heroCollapse.test.ts`).
 * The swap eases unless the user asked for reduced motion.
 *
 * Spread `scrollProps` on the list and `heroProps` on a `View` around the hero.
 */
export function useHeroCollapse() {
  const [compact, setCompact] = useState(false);
  const state = useRef(false);
  const reduceMotion = useReducedMotionRef();
  const metrics = useRef({
    y: 0,
    contentHeight: 0,
    viewHeight: 0,
    fullHeight: 0,
    compactHeight: COMPACT_ROW,
  });

  const evaluate = useCallback(() => {
    const next = nextCompact({ compact: state.current, ...metrics.current });
    if (next === state.current) return;
    state.current = next;
    if (!reduceMotion.current)
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCompact(next);
  }, [reduceMotion]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      Object.assign(metrics.current, {
        y: contentOffset.y,
        contentHeight: contentSize.height,
        viewHeight: layoutMeasurement.height,
      });
      evaluate();
    },
    [evaluate],
  );

  // A search or a filter can shorten the list without a scroll event.
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      metrics.current.contentHeight = height;
      evaluate();
    },
    [evaluate],
  );

  const onListLayout = useCallback(
    (e: LayoutChangeEvent) => {
      metrics.current.viewHeight = e.nativeEvent.layout.height;
      evaluate();
    },
    [evaluate],
  );

  const onHeroLayout = useCallback((e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    if (state.current) metrics.current.compactHeight = height;
    else metrics.current.fullHeight = height;
  }, []);

  return {
    compact,
    scrollProps: {
      onScroll,
      scrollEventThrottle: 32,
      onContentSizeChange,
      onLayout: onListLayout,
    },
    heroProps: { onLayout: onHeroLayout },
  };
}
