import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";

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
 * Render it as the LAST child of the screen root so it stacks above the list;
 * it is `pointerEvents="none"`, so it never eats a tap.
 */
export function Toast({
  message,
  onDismissed,
}: {
  message: ToastMessage | null;
  onDismissed: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(12)).current;
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;

  useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    lift.setValue(12);
    const show = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.spring(lift, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
    ]);
    show.start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onDismissedRef.current();
      });
    }, VISIBLE_MS[message.tone]);
    return () => {
      show.stop();
      clearTimeout(timer);
    };
    // Keyed on nonce so the same text fired twice replays the animation.
  }, [lift, message, opacity]);

  if (!message) return null;
  const error = message.tone === "error";

  return (
    <View style={styles.dock} pointerEvents="none">
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.toast,
          error ? styles.toastError : styles.toastInfo,
          { opacity, transform: [{ translateY: lift }] },
        ]}
      >
        <Feather
          name={error ? "alert-circle" : "check-circle"}
          size={16}
          color={error ? theme.warning : theme.accent}
        />
        <Text style={styles.text}>{message.text}</Text>
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
  toastInfo: { backgroundColor: theme.bonus2, borderColor: withAlpha(theme.accent, 0.45) },
  toastError: { backgroundColor: theme.bonus2, borderColor: theme.warning },
  text: {
    flexShrink: 1,
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});
