import { useState, useSyncExternalStore } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  RefreshControl,
  type RefreshControlProps,
} from "react-native";

import { createRefreshPin } from "./refreshPin";

type Touches = { nativeEvent: { touches: readonly unknown[] } };

/**
 * Spread `scrollProps` on a list's scroll view and draw its refresh as
 * `refreshControl={<pull.Refresh ... />}`. A pull arms the refresh only for a drag
 * that began at the list's top and never left it (`refreshPin.ts`). The pin
 * lives in a ref-like object, so a pin change re-renders the control and
 * nothing else: not the screen, not its rows.
 */
export function useRefreshFromTop() {
  const [pull] = useState(() => {
    const pin = createRefreshPin();
    const scrollProps = {
      onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) =>
        pin.scroll(event.nativeEvent.contentOffset.y),
      onTouchStart: (event: Touches) => {
        // A second finger decides nothing: it would free the first one's drag.
        if (event.nativeEvent.touches.length > 1) return;
        pin.down();
      },
      onTouchEnd: (event: Touches) => {
        if (event.nativeEvent.touches.length > 0) return;
        pin.up();
      },
      onScrollBeginDrag: pin.beginDrag,
      onScrollEndDrag: pin.endDrag,
    };
    // The screen draws the control as `<pull.Refresh>`, a component of this
    // list rather than a kit export, so the kit barrel stays the declared set.
    const Refresh = (props: RefreshControlProps) => (
      <PullRefreshControl pin={pin} {...props} />
    );
    return { scrollProps, Refresh };
  });
  return pull;
}

/**
 * A `RefreshControl` that is disabled while its list's `pin` holds it off.
 * Android's refresh layout takes over a drag the moment its list reaches the
 * top, so disabling it is the only way to stop a drag that began lower from
 * arming it. It is enabled again on lift: a control disabled when a touch
 * lands never takes that touch over. (iOS has no such switch and keeps its
 * bounce.)
 */
function PullRefreshControl({
  pin,
  enabled = true,
  ...rest
}: RefreshControlProps & { pin: ReturnType<typeof createRefreshPin> }) {
  const held = useSyncExternalStore(pin.subscribe, pin.held);
  return <RefreshControl enabled={enabled && !held} {...rest} />;
}

/**
 * Two scroll-prop sets on one list (the hero collapse and the refresh pin both
 * want `onScroll` and the drag events): spreading both would drop the first, so
 * a handler named by both runs for each.
 */
export function mergeScrollProps<A extends object, B extends object>(
  a: A,
  b: B,
): A & B {
  const out: Record<string, unknown> = { ...a, ...b };
  for (const [key, first] of Object.entries(a)) {
    const second = (b as Record<string, unknown>)[key];
    if (typeof first === "function" && typeof second === "function") {
      out[key] = (...args: unknown[]) => {
        first(...args);
        second(...args);
      };
    }
  }
  return out as A & B;
}
