// "Sync issues" surface (stage8-sync.md §8.4/§8.5): parked ops the server
// rejected or that lost an edit↔delete race, plus shelved conflict values.
// The fail-loudly rule made visible — every entry has an explicit action;
// nothing is silently dropped.
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { fontSize, radius, spacing, theme } from "../theme";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/ScreenStates";
import { onMirrorChanged } from "../sync/syncDb";
import {
  discardParkedOp,
  dismissShelfEntry,
  listParkedOps,
  listShelfEntries,
  recreateFromDeadRemote,
  retryParkedOp,
  type ParkedOp,
  type ShelfEntry,
} from "../sync/syncIssues";

const ENTITY_LABEL: Record<string, string> = {
  canyon: "Canyon",
  tripLog: "Trip",
  waypoint: "Waypoint",
  notification: "Notification",
};

const OP_LABEL: Record<string, string> = {
  create: "create",
  update: "edit",
  delete: "delete",
  markRead: "mark read",
};

function opTitle(op: ParkedOp): string {
  const entity = ENTITY_LABEL[op.entity] ?? op.entity;
  const name = typeof op.fields?.name === "string" ? ` “${op.fields.name}”` : "";
  return `${entity}${name} — ${OP_LABEL[op.op] ?? op.op}`;
}

function previewValue(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function SyncIssuesScreen() {
  const [parked, setParked] = useState<ParkedOp[]>([]);
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);

  const load = useCallback(() => {
    Promise.all([listParkedOps(), listShelfEntries()])
      .then(([parkedOps, shelfEntries]) => {
        setParked(parkedOps);
        setShelf(shelfEntries);
      })
      .catch((err: unknown) => console.error(err));
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = onMirrorChanged(load);
    return unsubscribe;
  }, [load]);

  const confirmDiscard = useCallback(
    (op: ParkedOp) => {
      Alert.alert(
        "Discard this change?",
        "Your field data is kept in the conflict shelf below.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => void discardParkedOp(op.seq).then(load),
          },
        ],
      );
    },
    [load],
  );

  if (parked.length === 0 && shelf.length === 0) {
    return (
      <EmptyState
        title="No sync issues"
        hint="Changes that can't be synced would appear here."
      />
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {parked.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Parked changes</Text>
          {parked.map((op) => (
            <View key={op.seq} style={styles.card}>
              <Text style={styles.cardTitle}>{opTitle(op)}</Text>
              <Text style={styles.cardCause}>
                {op.state === "deadRemote"
                  ? "The item was deleted elsewhere while you were editing it."
                  : (op.error?.message ?? "Rejected by the server.")}
              </Text>
              <View style={styles.actionRow}>
                {op.state === "deadRemote" ? (
                  <Button
                    label="Recreate"
                    variant="outlineAccent"
                    onPress={() => void recreateFromDeadRemote(op.seq).then(load)}
                  />
                ) : (
                  <Button
                    label="Retry"
                    variant="outlineAccent"
                    onPress={() => void retryParkedOp(op.seq).then(load)}
                  />
                )}
                <Button
                  label="Discard"
                  variant="ghost"
                  onPress={() => confirmDiscard(op)}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {shelf.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Conflict shelf</Text>
          <Text style={styles.sectionHint}>
            Values overwritten by a change made elsewhere. Auto-cleared after 30
            days.
          </Text>
          {shelf.map((entry) => (
            <View key={entry.id} style={styles.card}>
              <Text style={styles.cardTitle}>
                {(ENTITY_LABEL[entry.entity] ?? entry.entity)} · {entry.field}
              </Text>
              <Text style={styles.cardCause}>
                Server value: {previewValue(entry.serverValue)}
              </Text>
              {entry.shelvedValue !== null ? (
                <Text style={styles.cardCause}>
                  Your value: {previewValue(entry.shelvedValue)}
                </Text>
              ) : null}
              <View style={styles.actionRow}>
                <Button
                  label="Dismiss"
                  variant="ghost"
                  onPress={() => void dismissShelfEntry(entry.id).then(load)}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  content: { padding: spacing(2), gap: spacing(2) },
  section: { gap: spacing(1) },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: theme.textMuted,
  },
  sectionHint: { fontSize: fontSize.xs, color: theme.textMuted },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.md,
    padding: spacing(1.5),
    gap: spacing(0.5),
  },
  cardTitle: { color: theme.textPrimary, fontSize: fontSize.base, fontWeight: "600" },
  cardCause: { color: theme.textMuted, fontSize: fontSize.sm },
  actionRow: { flexDirection: "row", gap: spacing(1), paddingTop: spacing(0.5) },
});
