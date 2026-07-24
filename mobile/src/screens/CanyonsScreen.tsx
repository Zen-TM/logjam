// Canyon list — owned + shared-with-me in one list, shared rows badged
// (MOBILE_DESIGN_BRIEF: shared distinct from owned). Reads the Stage 8
// offline mirror: instant, complete (delta-synced, no list cap), and alive
// in airplane mode. Pull-to-refresh triggers a sync cycle.
import { useMemo } from "react";
import { Feather } from "@expo/vector-icons";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { formatCanyonGrade } from "@logjam/shared";

import { spacing, theme } from "../theme";
import { useMirrorCanyons, useMirrorTrips, useSyncStatus } from "../sync/useSyncQueries";
import type { MirrorCanyon } from "../sync/mirrorStore";
import { EmptyState, ErrorState, LoadingState } from "../ui/ScreenStates";
import { Row } from "../ui/Row";
import { SectionHeader } from "../ui/SectionHeader";
import { StatusPill } from "../ui/StatusPill";

type ListItem =
  | { kind: "header"; key: string; label: string }
  | { kind: "canyon"; key: string; canyon: MirrorCanyon; tripCount: number | undefined };

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

  // Owned first, shared-with-me grouped under its own header — matches the
  // design mockup without changing what data is fetched or how it's synced.
  const listItems = useMemo<ListItem[]>(() => {
    const data = canyons.data ?? [];
    const owned = data.filter((canyon) => canyon.syncRole !== "shared");
    const shared = data.filter((canyon) => canyon.syncRole === "shared");
    const items: ListItem[] = owned.map((canyon) => ({
      kind: "canyon",
      key: canyon.id,
      canyon,
      tripCount: tripCounts.get(canyon.id),
    }));
    if (shared.length > 0) {
      items.push({ kind: "header", key: "shared-header", label: "SHARED WITH ME" });
      for (const canyon of shared) {
        items.push({ kind: "canyon", key: canyon.id, canyon, tripCount: undefined });
      }
    }
    return items;
  }, [canyons.data, tripCounts]);

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
      data={listItems}
      keyExtractor={(item) => item.key}
      refreshControl={
        <RefreshControl
          refreshing={syncStatus.state === "syncing"}
          onRefresh={canyons.refresh}
          tintColor={theme.accent}
        />
      }
      renderItem={({ item }) =>
        item.kind === "header" ? (
          <SectionHeader label={item.label} />
        ) : (
          <CanyonRowView
            canyon={item.canyon}
            tripCount={item.tripCount}
            onPress={() => onOpenCanyon(item.canyon)}
          />
        )
      }
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
  const subtitle = [grade, tripCount != null ? `${tripCount} trip${tripCount === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Row
      title={canyon.name}
      subtitle={subtitle || undefined}
      leading={<Feather name="map-pin" size={20} color={theme.accent} />}
      right={
        <View style={styles.trailing}>
          {canyon.syncRole === "shared" ? <StatusPill label="Shared" tone="outline" /> : null}
          <Feather name="chevron-right" size={20} color={theme.textMuted} />
        </View>
      }
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.primary },
  listContent: { padding: spacing(2), gap: spacing(1) },
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
});
