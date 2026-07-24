// Trip log list + detail — read-only in Stage 1. Titles derive from
// tripTitle() (root CLAUDE.md convention); trip dates are UTC-midnight
// date-only values and MUST format with timeZone: "UTC" (CH-001) or AEST
// renders the previous calendar day.
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { tripTitle } from "../api/tripTitle";
import type { TTripLog } from "../api/types";
import { fontSize, fontWeight, hitSlop, lineHeight, radius, spacing, theme } from "../theme";
import { updateTripLocal } from "../sync/outbox";
import { useMirrorTrip, useMirrorTrips, useSyncStatus } from "../sync/useSyncQueries";
import {
  Card,
  EmptyState,
  EntityEditForm,
  ErrorState,
  LoadingState,
  Row,
  ScreenScroll,
  SectionHeader,
  type EditFieldSpec,
} from "../ui";

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
        <Row
          title={tripTitle(item)}
          subtitle={formatTripDate(item.date)}
          leading={<Feather name="book-open" size={20} color={theme.accent} />}
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
          onPress={() => onOpenTrip(item)}
        />
      )}
    />
  );
}

export function TripDetailScreen({ trip }: { trip: TTripLog }) {
  // Read live from the mirror so optimistic edits reflect immediately; fall
  // back to the navigation snapshot before the first mirror read resolves.
  const live = useMirrorTrip(trip.id);
  const current = live.data ?? trip;
  const [editing, setEditing] = useState(false);

  // Trips only ever reach the mirror for their owner (others' trips never
  // sync), so the edit affordance needs no ownership gate.
  const fields: EditFieldSpec[] = [
    { key: "displayName", label: "Title", kind: "text", value: current.displayName ?? null },
    { key: "notes", label: "Notes", kind: "multiline", value: current.notes ?? null },
  ];

  return (
    <ScreenScroll>
      <View style={styles.detailHeader}>
        <Text style={[styles.detailTitle, styles.detailHeaderTitle]} numberOfLines={2}>
          {tripTitle(current)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit trip"
          onPress={() => setEditing(true)}
          hitSlop={hitSlop}
          style={({ pressed }) => [styles.editButton, pressed && styles.editButtonPressed]}
        >
          <Feather name="edit-2" size={18} color={theme.accent} />
        </Pressable>
      </View>
      <Text style={styles.dateText}>{formatTripDate(current.date)}</Text>

      <EntityEditForm
        visible={editing}
        title="Edit trip"
        fields={fields}
        onCancel={() => setEditing(false)}
        onSave={(changed) => updateTripLocal(current.id, changed)}
      />

      <TripDetailBody trip={current} />
    </ScreenScroll>
  );
}

function TripDetailBody({ trip }: { trip: TTripLog }) {
  return (
    <>
      {trip.canyons.length > 0 ? (
        <View>
          <SectionHeader label="Canyons" />
          <Card>
            <Text style={styles.bodyText}>{trip.canyons.map((c) => c.name).join(", ")}</Text>
          </Card>
        </View>
      ) : null}

      {trip.types.length > 0 ? (
        <View>
          <SectionHeader label="Type" />
          <Card>
            <Text style={styles.bodyText}>{trip.types.join(", ")}</Text>
          </Card>
        </View>
      ) : null}

      {trip.notes ? (
        <View>
          <SectionHeader label="Notes" />
          <Card>
            <Text style={styles.bodyText}>{trip.notes}</Text>
          </Card>
        </View>
      ) : null}

      {Object.keys(trip.customFields).length > 0 ? (
        <View>
          <SectionHeader label="Custom fields" />
          <Card style={styles.customFieldsCard}>
            {Object.entries(trip.customFields).map(([key, value]) => (
              <Text key={key} style={styles.bodyText}>
                {key}: {String(value)}
              </Text>
            ))}
          </Card>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.primary },
  listContent: { padding: spacing(2), gap: spacing(1) },
  detailHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing(1) },
  detailHeaderTitle: { flex: 1 },
  detailTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: theme.textPrimary },
  editButton: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: radius.sm,
    padding: spacing(1),
  },
  editButtonPressed: { backgroundColor: theme.bonus2 },
  dateText: { color: theme.textMuted, fontSize: fontSize.sm },
  customFieldsCard: { gap: spacing(0.5) },
  bodyText: { fontSize: fontSize.base, color: theme.textPrimary, lineHeight: lineHeight.body },
});
