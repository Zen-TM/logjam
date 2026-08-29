import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontSize, radius, spacing, theme } from "../theme";

type ErrorBannerProps = {
  message: string;
  /** Optional heading, for a banner whose message needs one (MAPP-002). */
  title?: string;
  onRetry?: () => void;
  /** Relabels the single action slot when the remedy is not a retry. */
  actionLabel?: string;
};

// Inline error surface for form/submission failures — one banner per form,
// mirroring the web ErrorBanner (never raw err.message; callers pass output
// of messageFromError).
export function ErrorBanner({ message, title, onRetry, actionLabel }: ErrorBannerProps) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button">
          <Text style={styles.retry}>{actionLabel ?? "Retry"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    // Warning hue at ~12% — 8-digit hex so it tracks the active scheme.
    backgroundColor: `${theme.warning}1F`,
    borderWidth: 1,
    borderColor: theme.warning,
    borderRadius: radius.md,
    padding: spacing(1.5),
    gap: spacing(1),
  },
  title: { color: theme.textPrimary, fontSize: fontSize.base, fontWeight: "600" },
  message: { color: theme.textPrimary, fontSize: fontSize.sm },
  retry: { color: theme.accent, fontSize: fontSize.sm, fontWeight: "600" },
});
