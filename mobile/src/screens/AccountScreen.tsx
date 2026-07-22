// Account tab — current user + sign out. Read-only in Stage 1 (preferences
// editing arrives with the settings surface).
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { CLIENT_VERSION } from "../config";
import { fontSize, radius, spacing, theme } from "../theme";
import { Button } from "../ui/Button";
import { ErrorState, LoadingState } from "../ui/ScreenStates";

export function AccountScreen({ onSignOut }: { onSignOut: () => void }) {
  const query = useApiQuery(fetchCurrentUser, "Couldn't load your account.");

  if (query.loading && !query.data) return <LoadingState />;
  if (query.error && !query.data) {
    return <ErrorState message={query.error} onRetry={query.refetch} />;
  }
  const user = query.data;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {user ? (
        <View style={styles.card}>
          <Text style={styles.username}>{user.username}</Text>
          <Text style={styles.meta}>{user.email}</Text>
        </View>
      ) : null}
      <Button label="Sign out" variant="outlineAccent" onPress={onSignOut} />
      <Text style={styles.version}>{CLIENT_VERSION}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  content: { padding: spacing(2), gap: spacing(2) },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radius.md,
    padding: spacing(2),
    gap: spacing(0.5),
  },
  username: { fontSize: fontSize.lg, fontWeight: "600", color: theme.textPrimary },
  meta: { fontSize: fontSize.sm, color: theme.textMuted },
  version: { fontSize: fontSize.xs, color: theme.textMuted, textAlign: "center" },
});
