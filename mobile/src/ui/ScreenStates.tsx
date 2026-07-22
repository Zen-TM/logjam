import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { fontSize, spacing, theme } from "../theme";
import { Button } from "./Button";

// Full-screen data states (MOBILE_DESIGN_BRIEF §8: loading / empty / error are
// mandatory on every data surface).

export function LoadingState() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={theme.accent} />
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="outlineAccent" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing(3),
    gap: spacing(2),
    backgroundColor: theme.primary,
  },
  title: {
    fontSize: fontSize.base,
    color: theme.textPrimary,
    textAlign: "center",
  },
  hint: { fontSize: fontSize.sm, color: theme.textMuted, textAlign: "center" },
});
