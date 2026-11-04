import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  Animated,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { snapTarget } from "./heroCollapseRule";
import { useReduceMotionRef } from "./useReduceMotion";

/** A scroll that has been quiet this long, with no finger down, has stopped. */
const IDLE_MS = 100;

/** What `CollapsingHeader` and `CollapsingHero` measure and the snap decides. */
export type HeroMetrics = {
  /** The full hero's height, and the compact row's. */
  full: number;
  compact: number;
  /** The whole header block's: hero and the pinned rows under it. */
  header: number;
  /** The list has come to rest with the hero folded (not a per-frame value). */
  collapsed: boolean;
};

/** Whatever a list instance exposes of its scroll view. */
type ListHandle = {
  getScrollResponder?: () => unknown;
};
type Scrollable = {
  scrollTo?: (options: { y: number; animated: boolean }) => void;
};

/**
 * The pinned hero of a list that collapses as the list scrolls. The scroll
 * offset drives the hero on the UI thread (`Animated.event`, native driver), so
 * the collapse follows the finger frame by frame and costs the JS thread
 * nothing. Nothing in it changes layout: the header floats over the list, the
 * list leaves it `headerHeight` of room at its top, and the hero slides and
 * fades (`collapseRanges` has the numbers, `snapTarget` the rest).
 *
 * The JS side only watches for the list to stop, to settle a half-folded hero
 * to the nearer end; a ref and a timer, no state, until the hero comes to rest.
 *
 * On the screen: `CollapsingHeader` around the hero (`CollapsingHero`) and
 * the rows pinned under it; the list is a `HeroFlatList` / `HeroSectionList` /
 * `HeroScrollView` with `{...scrollProps}`, `heroCollapse.inset()` in its
 * `contentContainerStyle`, and `progressViewOffset={headerHeight}` on its
 * `RefreshControl`.
 */
export function useHeroCollapse() {
  const scrollY = useMemo(() => new Animated.Value(0), []);
  const reduceMotion = useReduceMotionRef();

  const metrics = useRef<HeroMetrics>({
    full: 0,
    compact: 0,
    header: 0,
    collapsed: false,
  });
  const listeners = useRef(new Set<() => void>());
  const patch = useCallback((change: Partial<HeroMetrics>) => {
    const next = { ...metrics.current, ...change };
    if (
      next.full === metrics.current.full &&
      next.compact === metrics.current.compact &&
      next.header === metrics.current.header &&
      next.collapsed === metrics.current.collapsed
    )
      return;
    metrics.current = next;
    listeners.current.forEach((listener) => listener());
  }, []);
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const getMetrics = useCallback(() => metrics.current, []);

  const list = useRef<ListHandle | null>(null);
  const scroll = useRef({
    y: 0,
    contentHeight: 0,
    viewHeight: 0,
    dragging: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });

  const scrollTo = useCallback((y: number, animated: boolean) => {
    const handle = list.current;
    const target = (handle?.getScrollResponder?.() ?? handle) as
      | Scrollable
      | null
      | undefined;
    target?.scrollTo?.({ y, animated });
  }, []);

  /** Brings the row at `contentY` (in the list's content, header room
   *  included) to just under the folded header. */
  const scrollToRow = useCallback(
    (contentY: number, gap: number) => {
      const { full, compact, header } = metrics.current;
      const folded = header - Math.max(0, full - compact);
      scrollTo(Math.max(0, contentY - folded - gap), true);
    },
    [scrollTo],
  );

  const settle = useCallback(() => {
    const s = scroll.current;
    const distance = Math.max(
      0,
      metrics.current.full - metrics.current.compact,
    );
    const target = snapTarget({
      y: s.y,
      distance,
      range: Math.max(0, s.contentHeight - s.viewHeight),
    });
    if (target !== s.y) scrollTo(target, !reduceMotion.current);
    patch({ collapsed: distance > 0 && target >= distance });
  }, [patch, reduceMotion, scrollTo]);

  const arm = useCallback(() => {
    const s = scroll.current;
    clearTimeout(s.timer);
    if (!s.dragging) s.timer = setTimeout(settle, IDLE_MS);
  }, [settle]);
  useEffect(() => () => clearTimeout(scroll.current.timer), []);

  const onScrollEvent = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- the listener reads refs on a scroll event, never during render
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
          const { contentOffset, contentSize, layoutMeasurement } =
            e.nativeEvent;
          Object.assign(scroll.current, {
            y: contentOffset.y,
            contentHeight: contentSize.height,
            viewHeight: layoutMeasurement.height,
          });
          arm();
        },
      }),
    [arm, scrollY],
  );

  const onScrollBeginDrag = useCallback(() => {
    scroll.current.dragging = true;
    clearTimeout(scroll.current.timer);
  }, []);
  const onScrollEndDrag = useCallback(() => {
    scroll.current.dragging = false;
    arm();
  }, [arm]);

  // A search or a filter can shorten the list, or a layout change resize it,
  // without a finger on it.
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      scroll.current.contentHeight = height;
      arm();
    },
    [arm],
  );
  const onListLayout = useCallback(
    (e: LayoutChangeEvent) => {
      scroll.current.viewHeight = e.nativeEvent.layout.height;
      arm();
    },
    [arm],
  );

  const setList = useCallback((instance: ListHandle | null) => {
    list.current = instance;
  }, []);

  // The one value a screen reads, so the screen re-renders when the header's
  // height changes (a selection bar, a note) and never for the collapse.
  const headerHeight = useSyncExternalStore(
    subscribe,
    () => metrics.current.header,
  );

  const measure = useMemo(
    () => ({
      full: (e: LayoutChangeEvent) =>
        patch({ full: e.nativeEvent.layout.height }),
      compact: (e: LayoutChangeEvent) =>
        patch({ compact: e.nativeEvent.layout.height }),
      header: (e: LayoutChangeEvent) =>
        patch({ header: e.nativeEvent.layout.height }),
    }),
    [patch],
  );

  return {
    scrollY,
    subscribe,
    getMetrics,
    measure,
    headerHeight,
    /** The list's top padding: room for the header, plus the gap the screen wants. */
    inset: (gap = 0) => ({ paddingTop: headerHeight + gap }),
    scrollToRow,
    scrollProps: {
      ref: setList,
      onScroll: onScrollEvent,
      // One event a frame, for the idle timer and the snap.
      scrollEventThrottle: 16,
      onScrollBeginDrag,
      onScrollEndDrag,
      onContentSizeChange,
      onLayout: onListLayout,
    },
  };
}
