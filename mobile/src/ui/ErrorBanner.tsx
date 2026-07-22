import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontSize, radius, spacing, theme } from "../theme";

type ErrorBannerProps = {
  message: string;
  onRetry?: () => void;
};

// Inline error surface for form/submission failures — one banner per form,
// mirroring the web ErrorBanner (never raw err.message; callers pass output
// of messageFromError).
export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button">
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "rgba(245, 166, 147, 0.12)",
    borderWidth: 1,
    borderColor: theme.warning,
    borderRadius: radius.md,
    padding: spacing(1.5),
    gap: spacing(1),
  },
  message: { color: theme.textPrimary, fontSize: fontSize.sm },
  retry: { color: theme.accent, fontSize: fontSize.sm, fontWeight: "600" },
});
