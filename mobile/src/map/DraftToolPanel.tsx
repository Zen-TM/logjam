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
// The route tool also carries the two properties of the LINE it is making —
// direction and colour. They live here rather than in the route's options sheet
// because both of them edit the route, and one "Edit" that lands you on the map
// beats three sheet rows that each do a different thing to a line you cannot
// see. They act on the DRAFT: a reverse or a colour written straight to the
// stored route would disagree with the open editor until Save, and a discard
// would silently keep it. Measure has neither — its points are not a line
// anyone keeps, and a shared panel that grows a tool's private controls is how
// the shared 90 % rots. Both are absent props for measure, exactly as Save is.
//
// The colour palette is a DISCLOSURE, not a permanent strip: ten swatches is a
// third of a phone's map, and this is a toolbar over the thing being worked in.
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
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  formatDistanceM,
  routeLengthM,
  MAX_ROUTE_POINTS,
  TRACK_COLORS,
  type SnapMode,
} from "@logjam/shared";

import { fontSize, fontWeight, hitSlop, radius, spacing, theme, withAlpha } from "../theme";
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
  onReverse,
  color,
  onColorChange,
  snapMode,
  onSnapModeChange,
  allowNetwork = true,
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
  /** Route only — flip the draft's direction. */
  onReverse?: () => void;
  /** The draft's colour, once picked. Null draws in the default accent. */
  color?: string | null;
  /** Route only — set the colour the draft saves with. */
  onColorChange?: (color: string) => void;
  snapMode: SnapMode;
  onSnapModeChange: (mode: SnapMode) => void;
  /**
   * False in "Simulating offline mode": elevation then comes only from tiles
   * already on the phone, and nothing goes out.
   */
  allowNetwork?: boolean;
}) {
  const { profile, loading } = useElevationProfile(points, { allowNetwork });
  const hasLine = points.length >= 2;
  const [pickingColor, setPickingColor] = useState(false);

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

      {/* Two groups in one row: what you do to the line on the left, what the
          line is and how you leave it on the right. The picked point's delete
          verb is NOT here — it rides next to the point itself on the map
          (RouteDraftLayer), where the thumb already is. */}
      <View style={styles.actions}>
        <View style={styles.group}>
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
        </View>
        <View style={styles.group}>
          {onReverse ? (
            <IconButton
              icon="repeat"
              accessibilityLabel="Reverse the direction of this route"
              disabled={!hasLine || saving}
              onPress={onReverse}
            />
          ) : null}
          {/* THE SWATCH IS THE CONTROL, not a glyph tinted with the colour: a
              droplet asks the user to decode a metaphor before they can see
              what it is set to, while a filled square IS the answer. Same
              shape the route sheet used before this moved onto the toolbar.
              It keeps an IconButton's 40pt box so it lines up with the buttons
              either side of it and stays a real tap target. */}
          {onColorChange ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose the colour of this route"
              accessibilityState={{ expanded: pickingColor, disabled: saving }}
              disabled={saving}
              onPress={() => setPickingColor((open) => !open)}
              hitSlop={hitSlop}
              style={({ pressed }) => [
                styles.colorButton,
                pressed && styles.colorButtonPressed,
                saving && styles.colorButtonDisabled,
              ]}
            >
              <View
                style={[styles.currentSwatch, { backgroundColor: color ?? theme.accent }]}
              />
            </Pressable>
          ) : null}
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

      {onColorChange && pickingColor ? (
        <View style={styles.palette}>
          {TRACK_COLORS.map((swatch) => (
            <Pressable
              key={swatch}
              accessibilityRole="button"
              accessibilityLabel={`Colour ${swatch}`}
              accessibilityState={{ selected: swatch === color }}
              disabled={saving}
              onPress={() => {
                setPickingColor(false);
                onColorChange(swatch);
              }}
              style={[
                styles.swatch,
                { backgroundColor: swatch },
                swatch === color ? styles.swatchSelected : null,
              ]}
            >
              {swatch === color ? <Text style={styles.swatchTick}>✓</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
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
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing(0.75),
  },
  group: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
  spacer: { flex: 1 },
  palette: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing(1),
    paddingBottom: spacing(0.25),
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchSelected: { borderWidth: 2, borderColor: theme.textPrimary },
  // An IconButton's box, so the swatch sits on the same baseline as the
  // buttons beside it and keeps a full-size tap target around a small square.
  colorButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  colorButtonPressed: { opacity: 0.6 },
  colorButtonDisabled: { opacity: 0.4 },
  // The current colour, shown rather than symbolised.
  currentSwatch: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: withAlpha(theme.textPrimary, 0.35),
  },
  swatchTick: { color: theme.primary, fontWeight: "700" },
});
