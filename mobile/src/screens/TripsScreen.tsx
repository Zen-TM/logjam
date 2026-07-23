// Trip log list + detail — read-only in Stage 1. Titles derive from
// tripTitle() (root CLAUDE.md convention); trip dates are UTC-midnight
// date-only values and MUST format with timeZone: "UTC" (CH-001) or AEST
// renders the previous calendar day.
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { tripTitle } from "../api/tripTitle";
import type { TTripLog } from "../api/types";
import { fontSize, radius, spacing, theme } from "../theme";
import { useMirrorTrips, useSyncStatus } from "../sync/useSyncQueries";
import { EmptyState, ErrorState, LoadingState } from "../ui/ScreenStates";

export function formatTripDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function TripsScreen({ onOpenTrip }: { onOpenTrip: (trip: TTripLog) => void }) {
  // Stage 8 mirror read: the full trip list, offline. No list cap — delta
  // sync delivers everything, so the old "Showing N of TOTAL" caption died.
  const query = useMirrorTrips();
  const syncStatus = useSyncStatus();

  const trips = query.data ?? [];
  if (query.loading && trips.length === 0) return <LoadingState />;
  if (query.error && trips.length === 0) {
    return <ErrorState message={query.error} onRetry={query.refresh} />;
  }
  if (trips.length === 0) {
    return <EmptyState title="No trips yet" hint="Trips you log appear here." />;
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={trips}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={syncStatus.state === "syncing"}
          onRefresh={query.refresh}
          tintColor={theme.accent}
        />
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenTrip(item)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <Text style={styles.rowTitle} numberOfLines={1}>
            {tripTitle(item)}
          </Text>
          <Text style={styles.rowMeta}>{formatTripDate(item.date)}</Text>
        </Pressable>
      )}
    />
  );
}

export function TripDetailScreen({ trip }: { trip: TTripLog }) {
  return (
    <ScrollView style={styles.detailRoot} contentContainerStyle={styles.detailContent}>
      <Text style={styles.detailTitle}>{tripTitle(trip)}</Text>
      <Text style={styles.rowMeta}>{formatTripDate(trip.date)}</Text>

      {trip.canyons.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.sectionLabel}>Canyons</Text>
          <Text style={styles.bodyText}>{trip.canyons.map((c) => c.name).join(", ")}</Text>
        </View>
      ) : null}

      {trip.types.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.sectionLabel}>Type</Text>
          <Text style={styles.bodyText}>{trip.types.join(", ")}</Text>
        </View>
      ) : null}

      {trip.notes ? (
        <View style={styles.block}>
          <Text style={styles.sectionLabel}>Notes</Text>
          <Text style={styles.bodyText}>{trip.notes}</Text>
        </View>
      ) : null}

      {Object.keys(trip.customFields).length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.sectionLabel}>Custom fields</Text>
          {Object.entries(trip.customFields).map(([key, value]) => (
            <Text key={key} style={styles.bodyText}>
              {key}: {String(value)}
            </Text>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.primary },
  listContent: { padding: spacing(2), gap: spacing(1) },
  row: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.md,
    padding: spacing(1.5),
    gap: spacing(0.25),
  },
  rowPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  rowTitle: { color: theme.textPrimary, fontSize: fontSize.base, fontWeight: "600" },
  rowMeta: { color: theme.textMuted, fontSize: fontSize.sm },
  detailRoot: { flex: 1, backgroundColor: theme.primary },
  detailContent: { padding: spacing(2), gap: spacing(2) },
  detailTitle: { fontSize: fontSize.xl, fontWeight: "700", color: theme.textPrimary },
  block: { gap: spacing(0.5) },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: theme.textMuted,
  },
  bodyText: { fontSize: fontSize.base, color: theme.textPrimary, lineHeight: 22 },
});
