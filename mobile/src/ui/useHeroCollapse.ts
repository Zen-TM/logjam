import { useCallback, useRef } from "react";
import {
  LayoutAnimation,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { COMPACT_ROW, nextCompact } from "./heroCollapseRule";
import { useReduceMotionRef } from "./useReduceMotion";

/** How long the swap between the full and the compact hero eases. */
const SWAP_MS = 100;

/**
 * Whether a list's pinned hero is full or compact, from the list's own scroll,
 * size and layout (`nextCompact` holds the rule; guard: `heroCollapse.test.ts`).
 *
 * The flag is NOT React state on the screen: it sits in a ref and only the
 * `CollapsingHero` that reads it re-renders, so crossing the threshold costs
 * one hero's render, not the list's (it was a whole-screen render under a 300 ms
 * ease, which in a dev build read as lag). The swap eases for `SWAP_MS` unless
 * the user asked for reduced motion.
 *
 * Spread `scrollProps` on the list and give `CollapsingHero` the rest.
 */
export function useHeroCollapse() {
  const state = useRef(false);
  const listeners = useRef(new Set<() => void>());
  const reduceMotion = useReduceMotionRef();
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
      LayoutAnimation.configureNext(
        LayoutAnimation.create(SWAP_MS, "easeOut", "opacity"),
      );
    listeners.current.forEach((listener) => listener());
  }, [reduceMotion]);

  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const getCompact = useCallback(() => state.current, []);

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
    subscribe,
    getCompact,
    scrollProps: {
      onScroll,
      // One event a frame: the swap lands on the frame that crossed it.
      scrollEventThrottle: 16,
      onContentSizeChange,
      onLayout: onListLayout,
    },
    heroProps: { onLayout: onHeroLayout },
  };
}
