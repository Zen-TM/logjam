// Canyon list — owned + shared-with-me in one list, shared rows badged
// (MOBILE_DESIGN_BRIEF: shared distinct from owned). Reads the Stage 8
// offline mirror: instant, complete (delta-synced, no list cap), and alive
// in airplane mode. Pull-to-refresh triggers a sync cycle.
import { useMemo } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { formatCanyonGrade } from "@logjam/shared";

import { fontSize, radius, spacing, theme } from "../theme";
import { useMirrorCanyons, useMirrorTrips, useSyncStatus } from "../sync/useSyncQueries";
import type { MirrorCanyon } from "../sync/mirrorStore";
import { EmptyState, ErrorState, LoadingState } from "../ui/ScreenStates";

export function CanyonsScreen({
  onOpenCanyon,
}: {
  onOpenCanyon: (canyon: MirrorCanyon) => void;
}) {
  const canyons = useMirrorCanyons();
  const trips = useMirrorTrips();
  const syncStatus = useSyncStatus();

  // Trip tally per canyon, derived locally from the mirrored trip logs (own
  // data only — trips of others never reach the mirror, so a shared canyon
  // naturally shows the caller's own count: none).
  const tripCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const trip of trips.data ?? []) {
      for (const linked of trip.canyons) {
        counts.set(linked.id, (counts.get(linked.id) ?? 0) + 1);
      }
    }
    return counts;
  }, [trips.data]);

  const rows = canyons.data ?? [];
  if (canyons.loading && rows.length === 0) return <LoadingState />;
  if (canyons.error && rows.length === 0) {
    return <ErrorState message={canyons.error} onRetry={canyons.refresh} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No canyons yet"
        hint="Canyons you create or that friends share with you appear here."
      />
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={rows}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={syncStatus.state === "syncing"}
          onRefresh={canyons.refresh}
          tintColor={theme.accent}
        />
      }
      renderItem={({ item }) => (
        <CanyonRowView
          canyon={item}
          tripCount={item.syncRole === "owner" ? tripCounts.get(item.id) : undefined}
          onPress={() => onOpenCanyon(item)}
        />
      )}
    />
  );
}

function CanyonRowView({
  canyon,
  tripCount,
  onPress,
}: {
  canyon: MirrorCanyon;
  tripCount: number | undefined;
  onPress: () => void;
}) {
  const grade = formatCanyonGrade(canyon);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {canyon.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[grade, tripCount != null ? `${tripCount} trip${tripCount === 1 ? "" : "s"}` : null]
            .filter(Boolean)
            .join(" · ") || " "}
        </Text>
      </View>
      {canyon.syncRole === "shared" ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Shared</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.primary },
  listContent: { padding: spacing(2), gap: spacing(1) },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.md,
    padding: spacing(1.5),
    gap: spacing(1),
  },
  rowPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  rowMain: { flex: 1, gap: spacing(0.25) },
  rowTitle: { color: theme.textPrimary, fontSize: fontSize.base, fontWeight: "600" },
  rowMeta: { color: theme.textMuted, fontSize: fontSize.sm },
  badge: {
    borderWidth: 1,
    borderColor: theme.bonus1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.25),
  },
  badgeText: { color: theme.bonus1, fontSize: fontSize.xs, fontWeight: "600" },
});
