// Canyon detail — read-only field view (GET /canyons/:id). The API's
// 404-not-403 anti-oracle is surfaced as-is: an inaccessible canyon renders
// the same "not found" state as a nonexistent one, never "exists but hidden".
import { useCallback } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { formatCanyonGrade } from "@logjam/shared";

import { getCanyonDetail, useApiQuery } from "../api/queries";
import type { TCanyon } from "../api/types";
import { fontSize, radius, spacing, theme } from "../theme";
import { ErrorState, LoadingState } from "../ui/ScreenStates";

export function CanyonDetailScreen({ canyonId }: { canyonId: string }) {
  const fetcher = useCallback(() => getCanyonDetail(canyonId), [canyonId]);
  const query = useApiQuery(fetcher, "Couldn't load canyon.");

  if (query.loading && !query.data) return <LoadingState />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.refetch} />;
  if (!query.data) return <LoadingState />;

  return <CanyonDetailView canyon={query.data} />;
}

function CanyonDetailView({ canyon }: { canyon: TCanyon }) {
  const grade = formatCanyonGrade(canyon);
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{canyon.name}</Text>
      {canyon.altNames.length > 0 ? (
        <Text style={styles.altNames}>Also known as {canyon.altNames.join(", ")}</Text>
      ) : null}

      <View style={styles.fieldGrid}>
        {grade ? <Field label="Grade" value={grade} /> : null}
        {canyon.quality != null ? <Field label="Quality" value={`${canyon.quality}/5`} /> : null}
        {canyon.numAbseils != null ? <Field label="Abseils" value={String(canyon.numAbseils)} /> : null}
        {canyon.longestAbseil != null ? (
          <Field label="Longest abseil" value={`${canyon.longestAbseil} m`} />
        ) : null}
        {canyon.hours != null ? <Field label="Hours" value={String(canyon.hours)} /> : null}
        <Field
          label="Location"
          value={`${canyon.latitude.toFixed(5)}, ${canyon.longitude.toFixed(5)}`}
        />
      </View>

      {canyon.notes ? (
        <View style={styles.notesBlock}>
          <Text style={styles.sectionLabel}>Notes</Text>
          <Text style={styles.notes}>{canyon.notes}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  content: { padding: spacing(2), gap: spacing(2) },
  name: { fontSize: fontSize.xl, fontWeight: "700", color: theme.textPrimary },
  altNames: { fontSize: fontSize.sm, color: theme.textMuted },
  fieldGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  field: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radius.md,
    padding: spacing(1.5),
    minWidth: "45%",
    flexGrow: 1,
    gap: spacing(0.25),
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: theme.textMuted,
  },
  fieldValue: { fontSize: fontSize.base, color: theme.textPrimary },
  notesBlock: { gap: spacing(0.5) },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: theme.textMuted,
  },
  notes: { fontSize: fontSize.base, color: theme.textPrimary, lineHeight: 22 },
});
