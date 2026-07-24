// Account tab — current user + sync issues + sign out. Read-only in Stage 1
// (preferences editing arrives with the settings surface).
import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { CLIENT_VERSION } from "../config";
import { fontSize, fontWeight, spacing, theme } from "../theme";
import { Button, Card, ErrorState, LoadingState, Row, ScreenScroll, StatusPill } from "../ui";
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
    <ScreenScroll>
      {user ? (
        <Card style={styles.card}>
          <View style={styles.identity}>
            <Feather name="user" size={28} color={theme.accent} />
            <View>
              <Text style={styles.username}>{user.username}</Text>
              <Text style={styles.meta}>{user.email}</Text>
            </View>
          </View>
        </Card>
      ) : null}

      <Row
        title="Friends"
        subtitle="People you share canyons with"
        leading={<Feather name="users" size={20} color={theme.accent} />}
        right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
        onPress={onOpenFriends}
      />

      <Row
        title="Sync issues"
        subtitle="Conflicts that need your attention"
        leading={<Feather name="alert-triangle" size={20} color={theme.accent} />}
        right={
          syncIssueCount > 0 ? (
            <StatusPill label={String(syncIssueCount)} tone="warning" />
          ) : (
            <Feather name="chevron-right" size={20} color={theme.textMuted} />
          )
        }
        onPress={onOpenSyncIssues}
      />

      <Button
        label="Sign out"
        variant="outlineAccent"
        onPress={onSignOut}
      />
      <Text style={styles.version}>{CLIENT_VERSION}</Text>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing(0.5) },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing(1.5) },
  username: { fontSize: fontSize.lg, fontWeight: fontWeight.medium, color: theme.textPrimary },
  meta: { fontSize: fontSize.sm, color: theme.textMuted },
  version: { fontSize: fontSize.xs, color: theme.textMuted, textAlign: "center" },
});
