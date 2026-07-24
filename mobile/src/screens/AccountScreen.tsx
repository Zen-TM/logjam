// Account tab — current user + sync issues + sign out. Read-only in Stage 1
// (preferences editing arrives with the settings surface).
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { CLIENT_VERSION } from "../config";
import { fontSize, radius, spacing, theme } from "../theme";
import { Button } from "../ui/Button";
import { ErrorState, LoadingState } from "../ui/ScreenStates";
import { useSyncIssueCount } from "../sync/useSyncQueries";

export function AccountScreen({
  onSignOut,
  onOpenSyncIssues,
  onOpenFriends,
}: {
  onSignOut: () => void;
  onOpenSyncIssues: () => void;
  onOpenFriends: () => void;
}) {
  const query = useApiQuery(fetchCurrentUser, "Couldn't load your account.");
  const syncIssueCount = useSyncIssueCount();

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

      <Pressable
        accessibilityRole="button"
        onPress={onOpenFriends}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <Text style={styles.rowLabel}>Friends</Text>
        <Text style={styles.rowValue}>Manage</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={onOpenSyncIssues}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <Text style={styles.rowLabel}>Sync issues</Text>
        {syncIssueCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{syncIssueCount}</Text>
          </View>
        ) : (
          <Text style={styles.rowValue}>None</Text>
        )}
      </Pressable>

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
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.md,
    padding: spacing(1.5),
  },
  rowPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  rowLabel: { color: theme.textPrimary, fontSize: fontSize.base },
  rowValue: { color: theme.textMuted, fontSize: fontSize.sm },
  badge: {
    minWidth: 24,
    alignItems: "center",
    backgroundColor: theme.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.25),
  },
  badgeText: { color: theme.primary, fontSize: fontSize.sm, fontWeight: "700" },
});
