import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { fontSize, spacing, theme } from "../theme";
import { Button } from "./Button";

// Full-screen data states (MOBILE_DESIGN_BRIEF §8: loading / empty / error are
// mandatory on every data surface).

// `label` says what is loading ("Loading your places…"), as on Logjam Web: a
// load that names itself is a load a screen reader can announce.
export function LoadingState({ label }: { label?: string }) {
  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? "Loading"}
      accessibilityState={{ busy: true }}
    >
      <ActivityIndicator size="large" color={theme.accent} />
      {label ? <Text style={styles.hint}>{label}</Text> : null}
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

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{message}</Text>
      {onRetry ? (
        <Button label="Try again" variant="outlineAccent" onPress={onRetry} />
      ) : null}
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
    backgroundColor: theme.page,
  },
  title: {
    fontSize: fontSize.base,
    color: theme.text,
    textAlign: "center",
  },
  hint: { fontSize: fontSize.sm, color: theme.textMuted, textAlign: "center" },
});
