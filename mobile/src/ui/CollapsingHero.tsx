import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { useTheme } from "../theme";
import { collapseRanges, heroReach, type Ramp } from "./heroCollapseRule";
import type { useHeroCollapse } from "./useHeroCollapse";
import { useReduceMotion } from "./useReduceMotion";

type Collapse = ReturnType<typeof useHeroCollapse>;

function useMetrics(collapse: Collapse) {
  const metrics = useSyncExternalStore(collapse.subscribe, collapse.getMetrics);
  return { ...metrics, distance: Math.max(0, metrics.full - metrics.compact) };
}

/** The scroll offset through a ramp, held at its ends. */
function through(scrollY: Animated.Value, { inputRange, outputRange }: Ramp) {
  return scrollY.interpolate({
    inputRange,
    outputRange,
    extrapolate: "clamp",
  });
}

/** What a layer can be touched and heard as (`heroReach` decides). */
function reach(reachable: boolean) {
  return {
    pointerEvents: reachable ? ("auto" as const) : ("none" as const),
    accessibilityElementsHidden: !reachable,
    importantForAccessibility: reachable
      ? ("auto" as const)
      : ("no-hide-descendants" as const),
  };
}

/**
 * The header of a list that collapses (`useHeroCollapse`): the hero, then the
 * rows that stay pinned under it (the rail, a search bar). It floats over the
 * top of the screen and the list scrolls under it, so put it BEFORE the list in
 * the screen's root view and give the list `heroCollapse.inset()` of top
 * padding. As the list scrolls it slides up by what the hero gives up, taking
 * the pinned rows with it; the compact row stays where it is.
 */
export function CollapsingHeader({
  collapse,
  children,
}: {
  collapse: Collapse;
  children: ReactNode;
}) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const { scrollY } = collapse;
  const { distance } = useMetrics(collapse);
  const slide = useMemo(
    () => through(scrollY, collapseRanges(distance, reduceMotion).slide),
    [scrollY, distance, reduceMotion],
  );
  return (
    <Animated.View
      onLayout={collapse.measure.header}
      style={[
        styles.header,
        { backgroundColor: theme.page, transform: [{ translateY: slide }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The hero inside a `CollapsingHeader`: `children(compact)` draws it in both
 * forms. The full one fades out as it slides away, the compact one fades in
 * over the top; only the form showing can be touched or heard, and only once the list
 * has come to rest (`heroReach`).
 */
export function CollapsingHero({
  collapse,
  children,
}: {
  collapse: Collapse;
  children: (compact: boolean) => ReactNode;
}) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const { scrollY } = collapse;
  const { distance, collapsed, moving } = useMetrics(collapse);
  const can = heroReach({ collapsed, moving });
  const { full, compact, counterSlide } = useMemo(() => {
    const ranges = collapseRanges(distance, reduceMotion);
    return {
      full: through(scrollY, ranges.full),
      compact: through(scrollY, ranges.compact),
      counterSlide: through(scrollY, ranges.counterSlide),
    };
  }, [scrollY, distance, reduceMotion]);
  return (
    <View style={styles.hero}>
      <Animated.View
        onLayout={collapse.measure.full}
        style={{ opacity: full }}
        {...reach(can.full)}
      >
        {children(false)}
      </Animated.View>
      <Animated.View
        onLayout={collapse.measure.compact}
        style={[
          styles.compact,
          {
            backgroundColor: theme.page,
            opacity: compact,
            transform: [{ translateY: counterSlide }],
          },
        ]}
        {...reach(can.compact)}
      >
        {children(true)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the list, which is drawn after it and scrolls underneath.
  header: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 },
  // Over the pinned rows under it, which the compact row never overlaps at rest.
  hero: { zIndex: 1 },
  compact: { position: "absolute", top: 0, left: 0, right: 0 },
});
