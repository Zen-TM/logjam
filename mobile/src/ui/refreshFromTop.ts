import { useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

import { sheetPins } from "./sheetPull";

/**
 * Whether a list's pull-to-refresh is held off after `event`. The same rule as
 * a sheet's pull-down (`sheetPins`): a finger that goes down on a list
 * scrolled away from its top, or scrolls it away mid-drag, never arms the
 * refresh; the drag scrolls and stops at the top. Lifting the finger ends it.
 * Guard: `refreshFromTop.test.ts`.
 */
export function refreshPinAfter(
  event: "down" | "scroll" | "up",
  { pinned, scrolled }: { pinned: boolean; scrolled: number },
): boolean {
  if (event === "up") return false;
  if (event === "down") return sheetPins({ scrolled });
  return pinned || sheetPins({ scrolled });
}

/**
 * Spread `scrollProps` on a list's scroll view and pass `enabled` to its
 * `RefreshControl`. Android's refresh layout takes over a drag the moment the
 * list reaches its top, so the only way to stop a drag that began lower from
 * arming it is to disable the control while that finger is down. It is enabled
 * again on lift: a control disabled when a touch lands never takes that touch
 * over. (iOS has no such switch and keeps its bounce.)
 */
export function useRefreshFromTop() {
  const [enabled, setEnabled] = useState(true);
  const state = useRef({ scrolled: 0, touching: false, pinned: false });
  const apply = (event: "down" | "scroll" | "up") => {
    const s = state.current;
    const pinned = refreshPinAfter(event, s);
    if (pinned === s.pinned) return;
    s.pinned = pinned;
    setEnabled(!pinned);
  };
  const scrollProps = {
    scrollEventThrottle: 16,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      state.current.scrolled = event.nativeEvent.contentOffset.y;
      // Momentum after the finger is up decides nothing.
      if (state.current.touching) apply("scroll");
    },
    onTouchStart: (event: { nativeEvent: { touches: readonly unknown[] } }) => {
      // A second finger decides nothing: it would free the first one's drag.
      if (event.nativeEvent.touches.length > 1) return;
      state.current.touching = true;
      apply("down");
    },
    onTouchEnd: () => {
      state.current.touching = false;
      apply("up");
    },
    onTouchCancel: () => {
      state.current.touching = false;
      apply("up");
    },
  };
  return { enabled, scrollProps };
}
