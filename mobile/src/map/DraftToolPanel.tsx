// HUD for both point-drawing map tools — route draw and measure.
//
// ONE panel, because the two tools are one interaction: the same anchors, the
// same drag/delete handles, the same snapping. They differ at the EXIT and in
// the ink (DESIGN.md §8) — measure has no Save and draws dotted — and a second
// component would have been a second place for the shared 90 % to rot.
//
// A TOOLBAR, not a card. While a tool is armed it takes the SEARCH PILL'S SLOT
// at the top of the screen — search is not reachable mid-draw anyway, and on a
// phone the map is the thing being worked in, so the chrome should not eat a
// third of it. Compact rows: what you have drawn, then what you can do about it.
//
// The two destructive controls are deliberately different verbs:
//   Clear  — empty the points, stay in the tool. Start the line again.
//   Trash  — discard and leave. Route draw confirms first (in the caller);
//            measure does not, because a measurement is a question asked once.
// They used to be the other way round, which read as "cancel throws my work
// away" and left the trash looking like the safer of the two.
//
// Gain/loss come from the DEM on demand and are simply absent offline — which
// is the case these tools are built for.
import { StyleSheet, Text, View } from "react-native";
import {
  formatDistanceM,
  routeLengthM,
  MAX_ROUTE_POINTS,
  type SnapMode,
} from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";
import { Button, IconButton } from "../ui";
import { ElevationReadout } from "./ElevationReadout";
import { SnapPicker } from "./SnapPicker";
import { useElevationProfile } from "./useElevationProfile";

export function DraftToolPanel({
  tool,
  points,
  anchorCount,
  canUndo,
  atCap,
  editingName,
  saving,
  onUndo,
  onClear,
  onSave,
  onDiscard,
  snapMode,
  onSnapModeChange,
}: {
  /** Which tool owns the taps — the only thing that varies in this panel. */
  tool: "route" | "measure";
  points: readonly [number, number][];
  /** User-placed vertices — what the count reports, never snapped filler. */
  anchorCount: number;
  canUndo: boolean;
  atCap: boolean;
  /** Set when editing a saved route, so the HUD says which. */
  editingName: string | null;
  saving: boolean;
  onUndo: () => void;
  onClear: () => void;
  /** Absent for measure: its points are a question, not an asset. */
  onSave?: () => void;
  onDiscard: () => void;
  snapMode: SnapMode;
  onSnapModeChange: (mode: SnapMode) => void;
}) {
  const { profile, loading } = useElevationProfile(points);
  const hasLine = points.length >= 2;

  return (
    <View style={styles.bar}>
      <View style={styles.readoutRow}>
        <Text style={styles.distance}>
          {hasLine
            ? formatDistanceM(routeLengthM(points as [number, number][]))
            : "—"}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {anchorCount === 0
            ? tool === "measure"
              ? "Tap the map to measure"
              : "Tap the map to start"
            : `${anchorCount} point${anchorCount === 1 ? "" : "s"}`}
        </Text>
        <View style={styles.spacer} />
        <ElevationReadout profile={profile} loading={loading} />
      </View>

      {editingName ? (
        <Text style={styles.editing} numberOfLines={1}>
          Editing “{editingName}”
        </Text>
      ) : null}

      {atCap ? (
        <Text style={styles.note}>
          Maximum of {MAX_ROUTE_POINTS} points reached.
        </Text>
      ) : null}

      <SnapPicker mode={snapMode} onChange={onSnapModeChange} disabled={saving} />

      <View style={styles.actions}>
        <IconButton
          icon="corner-up-left"
          accessibilityLabel="Undo the last change"
          disabled={!canUndo || saving}
          onPress={onUndo}
        />
        <Button
          label="Clear"
          variant="outlineAccent"
          compact
          disabled={points.length === 0 || saving}
          onPress={onClear}
        />
        <View style={styles.spacer} />
        <IconButton
          icon="trash-2"
          color={theme.warning}
          accessibilityLabel={
            tool === "measure"
              ? "Clear the measurement and close the tool"
              : "Discard this route and close the tool"
          }
          disabled={saving}
          onPress={onDiscard}
        />
        {onSave ? (
          <Button
            label={saving ? "Saving…" : "Save"}
            icon="check"
            compact
            disabled={!hasLine || saving}
            onPress={onSave}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: withAlpha(theme.primary, 0.94),
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: withAlpha(theme.accent, 0.4),
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
    gap: spacing(0.75),
  },
  readoutRow: { flexDirection: "row", alignItems: "baseline", gap: spacing(1) },
  distance: {
    color: theme.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    fontVariant: ["tabular-nums"],
  },
  meta: { color: theme.textMuted, fontSize: fontSize.xs, flexShrink: 1 },
  editing: { color: theme.textMuted, fontSize: fontSize.xs },
  note: { color: theme.warning, fontSize: fontSize.xs },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
  spacer: { flex: 1 },
});
