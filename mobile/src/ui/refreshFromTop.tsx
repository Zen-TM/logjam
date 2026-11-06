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
 * A `RefreshControl` that is disabled while its list's `pin` holds it off: the
 * list is scrolled away from its top, or a drag that has been away is still
 * down. Android's refresh layout takes a touch it was enabled for when the
 * finger landed, so the control has to be off before then; it is on again once
 * the list is at rest at the top. (iOS has no such switch and keeps its
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
