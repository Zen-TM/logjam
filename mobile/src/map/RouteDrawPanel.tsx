// Route draw HUD — running distance for the tapped points, plus undo/clear and
// the save that turns them into an asset.
//
// LAYOUT-FREE like MeasurePanel: the map owns where it sits (the top notice
// stack), same surface treatment, so the chrome over the map reads as one
// family.
//
// This is the tool DESIGN.md §8 carves out: "a tool that produces something the
// user would want to keep is a different thing and belongs in Saved". So unlike
// measure, closing it does NOT silently bin the work — Save is the primary
// action and Discard asks first (in the caller).
//
// Distance only, for the same reason as MeasurePanel: heights need a DEM.
import { StyleSheet, Text, View } from "react-native";
import { formatDistanceM, routeLengthM, MAX_ROUTE_POINTS } from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";
import { Button, IconButton } from "../ui";

export function RouteDrawPanel({
  points,
  editingName,
  saving,
  onUndo,
  onClear,
  onSave,
  onCancel,
}: {
  points: readonly [number, number][];
  /** Set when editing a saved route, so the HUD says which. */
  editingName: string | null;
  saving: boolean;
  onUndo: () => void;
  onClear: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const atCap = points.length >= MAX_ROUTE_POINTS;
  return (
    <View style={styles.panel}>
      <View style={styles.readout}>
        <View style={styles.headline}>
          <Text style={styles.label} numberOfLines={1}>
            {editingName ?? "New route"}
          </Text>
          <Text style={styles.distance}>
            {points.length >= 2
              ? formatDistanceM(routeLengthM(points as [number, number][]))
              : "—"}
          </Text>
        </View>
        <Text style={styles.hint}>
          {points.length === 0
            ? "Tap the map to start"
            : `${points.length} point${points.length === 1 ? "" : "s"}`}
        </Text>
      </View>

      {atCap ? (
        <Text style={styles.note}>
          Maximum of {MAX_ROUTE_POINTS} points reached.
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          label="Undo"
          icon="corner-up-left"
          variant="outlineAccent"
          compact
          disabled={points.length === 0 || saving}
          onPress={onUndo}
        />
        <Button
          label={saving ? "Saving…" : "Save"}
          icon="check"
          compact
          disabled={points.length < 2 || saving}
          onPress={onSave}
        />
        <Button
          label="Cancel"
          variant="outlineAccent"
          compact
          disabled={saving}
          onPress={onCancel}
        />
        <View style={styles.spacer} />
        <IconButton
          icon="trash-2"
          color={theme.warning}
          accessibilityLabel="Clear the route"
          disabled={points.length === 0 || saving}
          onPress={onClear}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: withAlpha(theme.primary, 0.94),
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: withAlpha(theme.accent, 0.4),
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1.25),
    gap: spacing(1),
  },
  readout: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing(1),
  },
  headline: { gap: spacing(0.25), flexShrink: 1 },
  label: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  distance: {
    color: theme.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    fontVariant: ["tabular-nums"],
  },
  hint: { color: theme.textMuted, fontSize: fontSize.xs },
  note: { color: theme.warning, fontSize: fontSize.xs },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  spacer: { flex: 1 },
});
