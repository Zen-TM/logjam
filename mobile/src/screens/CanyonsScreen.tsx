// Canyon list — owned + shared-with-me in one list, shared rows badged
// (MOBILE_DESIGN_BRIEF: shared distinct from owned). Read-only in Stage 1.
import { useMemo } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { formatCanyonGrade } from "@logjam/shared";

import { getCanyons, getSharedCanyons, useApiQuery } from "../api/queries";
import type { TCanyon } from "../api/types";
import { fontSize, radius, spacing, theme } from "../theme";
import { EmptyState, ErrorState, LoadingState } from "../ui/ScreenStates";

type CanyonRow = TCanyon & { shared: boolean };

export function CanyonsScreen({
  onOpenCanyon,
}: {
  onOpenCanyon: (canyon: CanyonRow) => void;
}) {
  const owned = useApiQuery(getCanyons, "Couldn't load canyons.");
  const shared = useApiQuery(getSharedCanyons, "Couldn't load shared canyons.");

  const rows: CanyonRow[] = useMemo(() => {
    const ownedRows = (owned.data?.data ?? []).map((c) => ({ ...c, shared: false }));
    const sharedRows = (shared.data ?? []).map((c) => ({ ...c, shared: true }));
    return [...ownedRows, ...sharedRows].sort((a, b) => a.name.localeCompare(b.name));
  }, [owned.data, shared.data]);

  const refetchAll = () => {
    owned.refetch();
    shared.refetch();
  };

  const loading = owned.loading || shared.loading;
  if (loading && rows.length === 0) return <LoadingState />;
  // Surface an error only when it cost us the whole list; a partial failure
  // (e.g. shared list down) still renders what loaded, with the error text
  // available on pull-to-refresh.
  if (owned.error && rows.length === 0) {
    return <ErrorState message={owned.error} onRetry={refetchAll} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No canyons yet"
        hint="Canyons you create or that friends share with you appear here."
      />
    );
  }

  const total = owned.data?.total;
  const truncated =
    total != null && owned.data != null && total > owned.data.data.length;

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={rows}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={refetchAll} tintColor={theme.accent} />
      }
      ListHeaderComponent={
        truncated ? (
          <Text style={styles.truncation}>
            Showing {owned.data!.data.length} of {total} owned canyons
          </Text>
        ) : null
      }
      renderItem={({ item }) => <CanyonRowView canyon={item} onPress={() => onOpenCanyon(item)} />}
    />
  );
}

function CanyonRowView({ canyon, onPress }: { canyon: CanyonRow; onPress: () => void }) {
  const grade = formatCanyonGrade(canyon);
  // _count is absent (not zero) on shared canyons by design — owner-private
  // aggregate. Only render a trip tally for owned rows.
  const tripCount = !canyon.shared ? canyon._count?.tripLogLinks : undefined;
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
      {canyon.shared ? (
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
  truncation: {
    fontSize: fontSize.xs,
    color: theme.textMuted,
    paddingBottom: spacing(1),
  },
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
