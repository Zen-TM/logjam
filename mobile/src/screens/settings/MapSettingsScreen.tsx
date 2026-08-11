// Settings → Map: how the map screen behaves on THIS phone.
//
// Every preference here is device-scoped and stored in `prefsDb`, so the whole
// page works as a guest, works with no signal, and reads synchronously — there
// is no loading state on this screen and no row that can be blocked (§10's
// reason-in-subtitle has nothing to say here).
//
// The map reads these on FOCUS, not only at mount (`MapScreen`'s
// `useFocusEffect`), so a change made here is in place by the time the user
// swipes back to the map. The one exception is the marker colour, which is a
// layer style and re-renders immediately.
//
// WHY NO SNAP PICKER: snapping governs what the NEXT TAP of a drafting tool
// does, so it belongs in that tool's HUD where it already lives (DESIGN.md §2 —
// tool behaviour goes with the tool, not in a settings page).
//
// PRIVACY: sides, colours, enums and two sampling numbers. Nothing positional.
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { isCompassEnabled, setCompassEnabled } from "../../map/compassPreference";
import { ensureForegroundLocationPermission } from "../../map/locationPermission";
import {
  MARKER_COLORS,
  MARKER_COLOR_ORDER,
  isNorthUpLocked,
  isScaleBarEnabled,
  readKeepAwakeMode,
  readLongPressAction,
  readMapControlSide,
  readMarkerColorId,
  readNorthReference,
  writeKeepAwakeMode,
  writeLongPressAction,
  writeMapControlSide,
  writeMarkerColorId,
  writeNorthReference,
  writeNorthUpLocked,
  writeScaleBarEnabled,
  type KeepAwakeMode,
  type LongPressAction,
  type MapControlSide,
  type MarkerColorId,
  type NorthReference,
} from "../../map/mapPreferences";
import {
  ACCURACY_LIMITS,
  readAccuracyLimitM,
  readFixRate,
  writeAccuracyLimitM,
  writeFixRate,
  type AccuracyLimitM,
  type FixRate,
} from "../../tracks/recordingPreferences";
import { radius, spacing, surface, theme, withAlpha } from "../../theme";
import { ScreenScroll, SectionHeader, Toast, type ToastMessage } from "../../ui";
import { ChoiceGroup, Hint, PreferenceRow } from "./settingsKit";

const LONG_PRESS_LABELS: Record<LongPressAction, string> = {
  ask: "Ask",
  waypoint: "Waypoint",
  navigate: "Navigate",
  route: "Draw route",
  measure: "Measure",
  canyon: "Add canyon",
};

/**
 * Nothing for `true` — it is the default and agrees with everything else on the
 * screen. `magnetic` gets a line because it is the one that makes two things on
 * the same screen disagree, and the user has to know which one moved.
 */
const NORTH_REFERENCE_HINTS: Partial<Record<NorthReference, string>> = {
  magnetic: "Applies only to the compass — the map is always oriented true north.",
};

const KEEP_AWAKE_LABELS: Record<KeepAwakeMode, string> = {
  off: "Never",
  recording: "While recording",
  map: "On the map",
};

const FIX_RATE_LABELS: Record<FixRate, string> = {
  high: "Detailed",
  balanced: "Balanced",
  battery: "Battery saver",
};

/** The actual rate: three words the labels can only gesture at. */
const FIX_RATE_HINTS: Record<FixRate, string> = {
  high: "A position every 3 seconds.",
  balanced: "A position every 10 seconds.",
  battery: "A position every 30 seconds. Longest battery life.",
};

function accuracyLabel(limit: AccuracyLimitM): string {
  return limit === 0 ? "Keep all" : `${limit} m`;
}

export function MapSettingsScreen() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "error") => {
    setToast({ text, tone, nonce: Date.now() });
  }, []);
  // Every write can fail (a full or unavailable store), and a switch that
  // silently reverts on the next launch is the failure this must not have.
  const stored = useCallback(
    (ok: boolean) => {
      if (!ok) notify("This phone wouldn't store that setting.");
      return ok;
    },
    [notify],
  );

  const [controlSide, setControlSide] = useState<MapControlSide>(readMapControlSide);
  const [markerColorId, setMarkerColorId] = useState<MarkerColorId>(readMarkerColorId);
  const [keepAwake, setKeepAwake] = useState<KeepAwakeMode>(readKeepAwakeMode);
  const [northUp, setNorthUp] = useState(isNorthUpLocked);
  const [longPress, setLongPress] = useState<LongPressAction>(readLongPressAction);
  const [compassEnabled, setCompassEnabledState] = useState(isCompassEnabled);
  const [northReference, setNorthReference] = useState<NorthReference>(readNorthReference);
  const [scaleBar, setScaleBar] = useState(isScaleBarEnabled);
  const [accuracyLimit, setAccuracyLimit] = useState<AccuracyLimitM>(readAccuracyLimitM);
  const [fixRate, setFixRate] = useState<FixRate>(readFixRate);

  // Turning the compass ON is where the location permission gets asked for — it
  // needs one, and a switch that goes on and shows nothing is the failure mode
  // worth one prompt to avoid.
  const toggleCompass = useCallback(async () => {
    const next = !compassEnabled;
    if (next && !(await ensureForegroundLocationPermission())) return;
    if (!stored(setCompassEnabled(next))) return;
    setCompassEnabledState(next);
  }, [compassEnabled, stored]);

  return (
    <>
      <ScreenScroll>
        {/* ── Layout ────────────────────────────────────────────────────── */}
        <ChoiceGroup
          label="Buttons on the"
          options={[
            { value: "right", label: "Right" },
            { value: "left", label: "Left" },
          ]}
          value={controlSide}
          onChange={(next) => {
            const side = next as MapControlSide;
            if (!stored(writeMapControlSide(side))) return;
            setControlSide(side);
          }}
          // Says the compass and scale bar move too, because that is the part
          // a one-word chip can't: they swap with the buttons rather than
          // staying put. Search is the exception and is not worth a sentence.
          hint="The compass and scale bar move to the other side."
        />

        <SectionHeader label="Your location marker" />
        <View style={styles.swatches}>
          {MARKER_COLOR_ORDER.map((id) => (
            <ColorSwatch
              key={id}
              colorId={id}
              selected={id === markerColorId}
              onPress={() => {
                if (!stored(writeMarkerColorId(id))) return;
                setMarkerColorId(id);
              }}
            />
          ))}
        </View>


        <PreferenceRow
          icon="navigation"
          title="Keep the map north-up"
          // The consequence, not the mechanism: what changes for the user is
          // that the twist they may do by accident no longer turns the map.
          subtitle="Two-finger twists no longer turn the map."
          value={northUp}
          ready
          onToggle={() => {
            const next = !northUp;
            if (!stored(writeNorthUpLocked(next))) return;
            setNorthUp(next);
          }}
        />
        {/* Directly above the bearings choice it governs: switched off, that
            choice has nothing to apply to and greys out with it. */}
        <PreferenceRow
          icon="compass"
          title="Compass"
          value={compassEnabled}
          ready
          onToggle={() => void toggleCompass()}
        />

        <PreferenceRow
          icon="minus"
          title="Scale bar"
          value={scaleBar}
          ready
          onToggle={() => {
            const next = !scaleBar;
            if (!stored(writeScaleBarEnabled(next))) return;
            setScaleBar(next);
          }}
        />

        <ChoiceGroup
          label="Compass bearings from"
          options={[
            { value: "true", label: "True north" },
            { value: "magnetic", label: "Magnetic north" },
          ]}
          value={northReference}
          hint={NORTH_REFERENCE_HINTS[northReference]}
          disabledReason={compassEnabled ? undefined : "Needs the compass"}
          onChange={(next) => {
            const reference = next as NorthReference;
            if (!stored(writeNorthReference(reference))) return;
            setNorthReference(reference);
          }}
        />

        <ChoiceGroup
          label="Press and hold the map to"
          options={(Object.keys(LONG_PRESS_LABELS) as LongPressAction[]).map((action) => ({
            value: action,
            label: LONG_PRESS_LABELS[action],
          }))}
          value={longPress}
          onChange={(next) => {
            const action = next as LongPressAction;
            if (!stored(writeLongPressAction(action))) return;
            setLongPress(action);
          }}
        />

        <ChoiceGroup
          label="Keep the screen on"
          options={(Object.keys(KEEP_AWAKE_LABELS) as KeepAwakeMode[]).map((mode) => ({
            value: mode,
            label: KEEP_AWAKE_LABELS[mode],
          }))}
          value={keepAwake}
          onChange={(next) => {
            const mode = next as KeepAwakeMode;
            if (!stored(writeKeepAwakeMode(mode))) return;
            setKeepAwake(mode);
          }}
        />

        {/* ── Recording ─────────────────────────────────────────────────── */}
        <ChoiceGroup
          label="Track detail"
          options={(Object.keys(FIX_RATE_LABELS) as FixRate[]).map((rate) => ({
            value: rate,
            label: FIX_RATE_LABELS[rate],
          }))}
          value={fixRate}
          hint={FIX_RATE_HINTS[fixRate]}
          onChange={(next) => {
            const rate = next as FixRate;
            if (!stored(writeFixRate(rate))) return;
            setFixRate(rate);
          }}
        />

        <ChoiceGroup
          label="Discard track positions less accurate than"
          options={ACCURACY_LIMITS.map((limit) => ({
            value: String(limit),
            label: accuracyLabel(limit),
          }))}
          value={String(accuracyLimit)}
          onChange={(next) => {
            const limit = Number(next) as AccuracyLimitM;
            if (!stored(writeAccuracyLimitM(limit))) return;
            setAccuracyLimit(limit);
          }}
        />
        <Hint text="Applies to your next recording." />
      </ScreenScroll>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </>
  );
}

/**
 * One marker colour. A filled circle of the colour itself, because the choice is
 * entirely visual — the same reasoning as the theme swatches, and the same
 * hairline for the same reason (white on a light card would otherwise vanish).
 */
function ColorSwatch({
  colorId,
  selected,
  onPress,
}: {
  colorId: MarkerColorId;
  selected: boolean;
  onPress: () => void;
}) {
  const color = MARKER_COLORS[colorId];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={colorId}
      onPress={onPress}
      style={({ pressed }) => [
        styles.swatchTarget,
        selected && styles.swatchSelected,
        pressed && styles.swatchPressed,
      ]}
    >
      <View style={[styles.swatch, { backgroundColor: color }]}>
        {selected ? <Feather name="check" size={18} color="#1A1A1A" /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  swatchTarget: {
    padding: spacing(0.5),
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchSelected: { borderColor: theme.accent },
  swatchPressed: { backgroundColor: surface.cardPressed },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: withAlpha(theme.textPrimary, 0.2),
  },
});
