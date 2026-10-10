import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fontSize, fontWeight, radius, spacing, theme } from "../theme";
import { Icon } from "./Icon";
import { claimsHorizontalDrag, swipeDismisses } from "./toastSwipe";

export type ToastMessage = {
  text: string;
  tone: "info" | "error";
  /** Bump on every new message so a repeat of the same text re-shows + re-times. */
  nonce: number;
};

const VISIBLE_MS = { info: 2600, error: 4200 } as const;

/**
 * Transient status, floating above the screen's content — the outcome of an
 * action the user just took (imported, saved, couldn't reach the server).
 *
 * Toasts, not inline cards: an inline banner reflows the list under the user's
 * thumb and then lingers with no owner. Errors stay up longer than
 * confirmations, and both are announced to screen readers.
 *
 * Render it as the LAST child of the screen root so it stacks above the list.
 * Only the pill takes touches (the dock around it is `box-none`), so it never
 * eats a tap beside itself. It can be cleared early: swipe it sideways (a
 * bottom-docked pill, and vertical belongs to the sheets and the map), or
 * press its × — the visible way out a screen reader and a thumb both reach.
 */
export function Toast({
  message,
  onDismissed,
}: {
  message: ToastMessage | null;
  onDismissed: () => void;
}) {
  const [opacity] = useState(() => new Animated.Value(0));
  const [lift] = useState(() => new Animated.Value(12));
  const [slide] = useState(() => new Animated.Value(0));
  const dismissed = useEffectEvent(onDismissed);
  // The PanResponder below lives for the component's life, so it reads the
  // latest callback through a ref (an Effect Event cannot be called from it).
  const latest = useRef(onDismissed);
  useEffect(() => {
    latest.current = onDismissed;
  });
  // Created once: a rebuilt PanResponder swaps handlers mid-drag.
  // eslint-disable-next-line react-hooks/refs -- `latest` is read only on release, never in render
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => claimsHorizontalDrag(g.dx, g.dy),
      onPanResponderMove: (_e, g) => slide.setValue(g.dx),
      onPanResponderRelease: (_e, g) => {
        if (swipeDismisses(g.dx, g.vx)) {
          Animated.timing(slide, {
            toValue: Math.sign(g.dx || g.vx) * 400,
            duration: 160,
            useNativeDriver: true,
          }).start(() => latest.current());
        } else {
          Animated.spring(slide, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  );

  useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    lift.setValue(12);
    slide.setValue(0);
    const show = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.spring(lift, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }),
    ]);
    show.start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) dismissed();
      });
    }, VISIBLE_MS[message.tone]);
    return () => {
      show.stop();
      clearTimeout(timer);
    };
    // Keyed on nonce so the same text fired twice replays the animation.
  }, [lift, message, opacity, slide]);

  if (!message) return null;
  const error = message.tone === "error";

  return (
    <View style={styles.dock} pointerEvents="box-none">
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        {...pan.panHandlers}
        style={[
          styles.toast,
          error ? styles.toastError : styles.toastInfo,
          { opacity, transform: [{ translateY: lift }, { translateX: slide }] },
        ]}
      >
        <Icon
          idea={error ? "warning" : "success"}
          size={16}
          color={theme.onInverse}
        />
        <Text style={styles.text}>{message.text}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={12}
          onPress={onDismissed}
          style={styles.close}
        >
          <Icon idea="close" size={16} color={theme.onInverse} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: spacing(2),
    right: spacing(2),
    bottom: spacing(2),
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: spacing(1.25),
    paddingHorizontal: spacing(2),
    maxWidth: "100%",
  },
  // The inverted surface, as on Logjam Web: the glyph's SHAPE says error or
  // not, because an intent colour on the inverse fails 3:1 in a dark scheme.
  toastInfo: { backgroundColor: theme.inverse, borderColor: theme.inverse },
  toastError: { backgroundColor: theme.inverse, borderColor: theme.inverse },
  close: { marginLeft: spacing(0.5) },
  text: {
    flexShrink: 1,
    color: theme.onInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});
