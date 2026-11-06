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

import { spacing } from "../theme";
import { roomBelow, rowTarget, snapTarget } from "./heroCollapseRule";
import { useReducedMotionRef } from "./useReducedMotion";

/** Slower than this (dp/ms) a released finger leaves no fling behind it:
 *  Android starts one at 50 dp/s. */
const FLING_VELOCITY = 0.05;

/** A scroll the code asked for that never reports arriving (a target it could
 *  not reach) frees the header after this long. */
const ARRIVAL_MS = 600;

/** The end padding every list under a header already has. */
const LIST_END = spacing(4);

/** What `CollapsingHeader` and `CollapsingHero` measure and the snap decides. */
export type HeroMetrics = {
  /** The full hero's height, and the compact row's. */
  full: number;
  compact: number;
  /** The whole header block's: hero and the pinned rows under it. */
  header: number;
  /** The list has come to rest with the hero folded (not a per-frame value). */
  collapsed: boolean;
  /** The list is moving (a drag, a fling, a scroll the code asked for) and
   *  has not settled: neither form of the hero takes touch. */
  moving: boolean;
  /** End room a short list needs to scroll the whole collapse (`roomBelow`). */
  extra: number;
};

/** What the hero gives up to the compact row. */
function distanceOf(m: HeroMetrics) {
  return Math.max(0, m.full - m.compact);
}

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
 * the collapse follows the finger frame by frame. Nothing in it changes
 * layout: the header floats over the list, the list leaves it `headerHeight`
 * of room at its top, and the hero slides and fades (`collapseRanges` has the
 * numbers).
 *
 * The JS side keeps the scroll offset in a ref (a listener that does nothing
 * else) and settles when the list stops: at the end of a momentum scroll, or
 * when the finger lifts and leaves no fling. A half-folded hero goes to the
 * nearer end (`snapTarget`). State changes once per gesture, not per frame.
 *
 * On the screen: `CollapsingHeader` around the hero (`CollapsingHero`) and
 * the rows pinned under it; the list is a `HeroFlatList` / `HeroSectionList` /
 * `HeroScrollView` with `{...scrollProps}`, `heroCollapse.inset()` in its
 * `contentContainerStyle`, and `progressViewOffset={headerHeight}` on its
 * `RefreshControl`.
 */
export function useHeroCollapse() {
  const scrollY = useMemo(() => new Animated.Value(0), []);
  const reduceMotion = useReducedMotionRef();

  const metrics = useRef<HeroMetrics>({
    full: 0,
    compact: 0,
    header: 0,
    collapsed: false,
    moving: false,
    extra: 0,
  });
  const listeners = useRef(new Set<() => void>());
  const patch = useCallback((change: Partial<HeroMetrics>) => {
    const was = metrics.current;
    const next = { ...was, ...change };
    if (
      next.full === was.full &&
      next.compact === was.compact &&
      next.header === was.header &&
      next.collapsed === was.collapsed &&
      next.moving === was.moving &&
      next.extra === was.extra
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
    /** `contentHeight` less the end room it was reported with: the list's own. */
    ownHeight: 0,
    viewHeight: 0,
    dragging: false,
    /** From the finger lifting with a fling behind it to the list at rest. */
    flinging: false,
    /** Where a scroll the code asked for is headed. */
    arriving: null as number | null,
    arrival: undefined as ReturnType<typeof setTimeout> | undefined,
    /** The header height the screen last rendered its list padding for. */
    paddedFor: 0,
    /** The end room the screen last rendered, which the content sizes the
     *  list reports since include. */
    paddedExtra: 0,
  });
  const settleRef = useRef<() => void>(() => undefined);

  const scrollTo = useCallback(
    (y: number) => {
      const handle = list.current;
      const target = (handle?.getScrollResponder?.() ?? handle) as
        | Scrollable
        | null
        | undefined;
      const s = scroll.current;
      s.arriving = y;
      clearTimeout(s.arrival);
      s.arrival = setTimeout(() => {
        s.arriving = null;
        settleRef.current();
      }, ARRIVAL_MS);
      patch({ moving: true });
      target?.scrollTo?.({ y, animated: !reduceMotion.current });
    },
    [patch, reduceMotion],
  );

  const settle = useCallback(() => {
    const s = scroll.current;
    if (s.dragging || s.flinging || s.arriving != null) return;
    const distance = distanceOf(metrics.current);
    const target = snapTarget({ y: s.y, distance });
    if (target !== s.y) {
      scrollTo(target);
      return;
    }
    patch({ collapsed: distance > 0 && s.y >= distance, moving: false });
  }, [patch, scrollTo]);
  useEffect(() => {
    settleRef.current = settle;
  }, [settle]);

  /** Brings the row at `contentY` to just under the folded header. False when
   *  the header is not measured, or the list not yet padded for it: ask again
   *  on the row's next layout. */
  const scrollToRow = useCallback(
    (contentY: number, gap: number) => {
      const s = scroll.current;
      const target = rowTarget({
        contentY,
        header: metrics.current.header,
        distance: distanceOf(metrics.current),
        paddedFor: s.paddedFor,
        gap,
        range: Math.max(0, s.contentHeight - s.viewHeight),
      });
      if (target == null) return false;
      scrollTo(target);
      return true;
    },
    [scrollTo],
  );

  /** A short list gets the end room it needs to scroll the whole collapse. */
  const makeRoom = useCallback(() => {
    const s = scroll.current;
    patch({
      extra: roomBelow({
        contentHeight: s.ownHeight,
        viewHeight: s.viewHeight,
        distance: distanceOf(metrics.current),
      }),
    });
  }, [patch]);

  const onScrollEvent = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- the listener reads refs on a scroll event, never during render
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
          const { contentOffset, contentSize, layoutMeasurement } =
            e.nativeEvent;
          const s = scroll.current;
          Object.assign(s, {
            y: contentOffset.y,
            contentHeight: contentSize.height,
            ownHeight: contentSize.height - s.paddedExtra,
            viewHeight: layoutMeasurement.height,
          });
          if (
            s.arriving != null &&
            Math.abs(contentOffset.y - s.arriving) < 1.5
          ) {
            s.arriving = null;
            clearTimeout(s.arrival);
            settleRef.current();
          }
        },
      }),
    [scrollY],
  );

  const onScrollBeginDrag = useCallback(() => {
    const s = scroll.current;
    s.dragging = true;
    s.flinging = false;
    s.arriving = null;
    clearTimeout(s.arrival);
    patch({ moving: true });
  }, [patch]);
  const onScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const s = scroll.current;
      s.dragging = false;
      s.flinging = Math.abs(e.nativeEvent.velocity?.y ?? 0) >= FLING_VELOCITY;
      settle();
    },
    [settle],
  );
  const onMomentumScrollEnd = useCallback(() => {
    scroll.current.flinging = false;
    settle();
  }, [settle]);

  // A search or a filter can shorten the list, or a layout change resize it,
  // without a finger on it.
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      const s = scroll.current;
      s.contentHeight = height;
      s.ownHeight = height - s.paddedExtra;
      makeRoom();
      settle();
    },
    [makeRoom, settle],
  );
  const onListLayout = useCallback(
    (e: LayoutChangeEvent) => {
      scroll.current.viewHeight = e.nativeEvent.layout.height;
      makeRoom();
    },
    [makeRoom],
  );

  // A list that mounts again (Plans swaps its list for a loading state and
  // back) starts at the top, whatever the old one had reached.
  const setList = useCallback(
    (instance: ListHandle | null) => {
      list.current = instance;
      if (!instance) return;
      scrollY.setValue(0);
      Object.assign(scroll.current, {
        y: 0,
        dragging: false,
        flinging: false,
        arriving: null,
      });
      patch({ collapsed: false, moving: false });
    },
    [patch, scrollY],
  );
  useEffect(() => () => clearTimeout(scroll.current.arrival), []);

  // What a screen reads, so it re-renders when the header's height or the end
  // room changes (a selection bar, a note, a search) and never for the collapse.
  const headerHeight = useSyncExternalStore(
    subscribe,
    () => metrics.current.header,
  );
  const extra = useSyncExternalStore(subscribe, () => metrics.current.extra);
  useEffect(() => {
    scroll.current.paddedFor = headerHeight;
  }, [headerHeight]);
  useEffect(() => {
    scroll.current.paddedExtra = extra > 0 ? extra : 0;
  }, [extra]);

  const measure = useMemo(
    () => ({
      full: (e: LayoutChangeEvent) => {
        patch({ full: e.nativeEvent.layout.height });
        makeRoom();
      },
      compact: (e: LayoutChangeEvent) => {
        patch({ compact: e.nativeEvent.layout.height });
        makeRoom();
      },
      header: (e: LayoutChangeEvent) =>
        patch({ header: e.nativeEvent.layout.height }),
    }),
    [makeRoom, patch],
  );

  return {
    scrollY,
    subscribe,
    getMetrics,
    measure,
    headerHeight,
    /** The list's content padding: room for the header at the top, plus the
     *  gap the screen wants, and a short list's end room. */
    inset: (gap = 0) => ({
      paddingTop: headerHeight + gap,
      ...(extra > 0 ? { paddingBottom: LIST_END + extra } : {}),
    }),
    scrollToRow,
    scrollProps: {
      ref: setList,
      onScroll: onScrollEvent,
      // One event a frame, for the arrival check and the offset a settle reads.
      scrollEventThrottle: 16,
      onScrollBeginDrag,
      onScrollEndDrag,
      onMomentumScrollEnd,
      onContentSizeChange,
      onLayout: onListLayout,
    },
  };
}
