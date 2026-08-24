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
import {
  currentDeclinationDeg,
  isDeclinationLearned,
  lastCompassDiagnostics,
} from "../../map/heading";
import { ensureForegroundLocationPermission } from "../../map/locationPermission";
import {
  MARKER_COLORS,
  MARKER_COLOR_ORDER,
  isNorthUpLocked,
  isScaleBarEnabled,
  isSpeedElevationEnabled,
  writeSpeedElevationEnabled,
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
import {
  readSensorLoggingEnabled,
  sensorCapabilities,
  sensorLogStatus,
  writeSensorLoggingEnabled,
} from "../../tracks/sensorLog";
import { applyRecordingOptionsToActiveTrack } from "../../tracks/trackRecorder";
import { radius, spacing, surface, theme, withAlpha } from "../../theme";
import { ScreenScroll, SectionHeader, Toast, type ToastMessage } from "../../ui";
import { ChoiceGroup, PreferenceRow } from "./settingsKit";

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

/**
 * The declination in force, spelled out under the control it explains.
 *
 * It is the whole of the difference between the two options above, so this is
 * where it belongs — not in a row of its own, where it would read as a setting
 * rather than as a fact about where the user is standing. Deliberately at the
 * bottom of the hint and in plain words: nobody needs it, and the one person
 * who does is transferring a bearing onto a paper topo and wants the number.
 *
 * It also says whether the value is REAL or the fallback, which is otherwise
 * unobservable — the app derives the true declination from a location fix
 * (heading.ts, `learnDeclination`) and quietly uses a single NSW constant until
 * it gets one. "Which of those am I on" was a question nothing on the device
 * could answer.
 */
/**
 * What the compass itself is reporting, under the control that depends on it.
 *
 * Provisional in the sense that every threshold above it was set from very
 * little data — this line is how that gets fixed. It is also the only place a
 * user can find out whether the app thinks their compass is healthy, which for
 * a navigation app should not have been missing.
 */
function compassHint(): string {
  return `Compass: ${lastCompassDiagnostics()}`;
}

function declinationHint(): string {
  const degrees = Math.abs(currentDeclinationDeg()).toFixed(1);
  const side = currentDeclinationDeg() >= 0 ? "east" : "west";
  return isDeclinationLearned()
    ? `Magnetic north is ${degrees}° ${side} of true north where you are.`
    : `Assuming ${degrees}° ${side} for NSW — the map has not had a location fix to work it out from yet.`;
}

const KEEP_AWAKE_LABELS: Record<KeepAwakeMode, string> = {
  off: "Never",
  recording: "While recording",
  map: "On the map",
};

const FIX_RATE_LABELS: Record<FixRate, string> = {
  finest: "Finest",
  detailed: "Detailed",
  balanced: "Balanced",
  batterySaver: "Battery saver",
};

/**
 * The actual rate: two words the labels can only gesture at.
 *
 * It describes the RECORDED LINE, not the marker on the map — the map keeps its
 * own faster watcher for the marker while it is on screen (see MapScreen's
 * position effect), so the saving these presets buy is the one that accrues for
 * the rest of the trip, with the phone in a pack. Saying otherwise on this
 * screen would be a promise the map breaks the moment the user looks at it.
 */
const FIX_RATE_HINTS: Record<FixRate, string> = {
  finest: "A recorded position every 3 seconds. Shortest battery life.",
  detailed: "A recorded position every 10 seconds.",
  balanced: "A recorded position every 30 seconds. The default.",
  batterySaver:
    "A recorded position every 2 minutes. Longest battery life, roughest line.",
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
  const [speedElevation, setSpeedElevation] = useState(isSpeedElevationEnabled);
  const [accuracyLimit, setAccuracyLimit] = useState<AccuracyLimitM>(readAccuracyLimitM);
  const [sensorLogging, setSensorLogging] = useState(readSensorLoggingEnabled);
  // Read once: the answer is a property of the handset and cannot change while
  // this screen is open.
  const [sensorCaps] = useState(sensorCapabilities);
  const [fixRate, setFixRate] = useState<FixRate>(readFixRate);

  // Turning the compass ON is where the location permission gets asked for — it
  // needs one, and a switch that goes on and shows nothing is the failure mode
  // worth one prompt to avoid.
  //
  // THE STATE MOVES FIRST, and that is what stops the switch jittering. RN's
  // Switch animates to the new position the moment it is pressed, then snaps
  // back to whatever `value` still says on the next render — so an await
  // between the press and the state, even one that resolves immediately with
  // the permission already granted, drew on → off → on. Moving first and
  // reverting on refusal means the only animation the user sees is the one
  // their thumb asked for.
  const toggleCompass = useCallback(async () => {
    const next = !compassEnabled;
    setCompassEnabledState(next);
    if (next && !(await ensureForegroundLocationPermission())) {
      setCompassEnabledState(!next);
      return;
    }
    if (!stored(setCompassEnabled(next))) setCompassEnabledState(!next);
  }, [compassEnabled, stored]);

  // Same shape as the compass toggle above, and for a stronger reason: this
  // one needs a POSITION, so a switch that went on and showed two dashes
  // forever is exactly what one permission prompt avoids.
  const toggleSpeedElevation = useCallback(async () => {
    const next = !speedElevation;
    setSpeedElevation(next);
    if (next && !(await ensureForegroundLocationPermission())) {
      setSpeedElevation(!next);
      return;
    }
    if (!stored(writeSpeedElevationEnabled(next))) setSpeedElevation(!next);
  }, [speedElevation, stored]);

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
          value={northUp}
          ready
          onToggle={() => {
            const next = !northUp;
            if (!stored(writeNorthUpLocked(next))) return;
            setNorthUp(next);
          }}
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

        {/* The two instruments that keep a sensor running carry the same one-line
            cost, said the same way — a per-row variation would read as a
            difference in kind when the only difference is which sensor. */}
        <PreferenceRow
          icon="compass"
          title="Compass"
          subtitle="Uses more battery while on the map."
          value={compassEnabled}
          ready
          onToggle={() => void toggleCompass()}
        />

        {/* Beneath the two instruments it joins in the same stack. */}
        <PreferenceRow
          icon="trending-up"
          title="Speed and elevation"
          subtitle="Uses more battery while on the map."
          value={speedElevation}
          ready
          onToggle={() => void toggleSpeedElevation()}
        />

        <ChoiceGroup
          label="Compass bearings from"
          options={[
            { value: "true", label: "True north" },
            { value: "magnetic", label: "Magnetic north" },
          ]}
          value={northReference}
          hint={[NORTH_REFERENCE_HINTS[northReference], declinationHint(), compassHint()]
            .filter(Boolean)
            .join(" ")}
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
            // A recording in progress takes the new rate now, rather than at
            // the next one — a user drops to the finest rate FOR a tricky
            // stretch, and getting it on the following trip is no use.
            applyRecordingOptionsToActiveTrack()
              .then((applied) => {
                if (applied) notify("Recording now at the new detail.", "info");
              })
              .catch((error: unknown) => {
                console.error(error);
                notify("Couldn't change the recording in progress.");
              });
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

        {/* ── Research ──────────────────────────────────────────────────────
            Developer-only, default off, and worded as what it is rather than
            as a feature: it costs battery, it produces a file only a laptop
            can read, and nothing in the app gets better while it is on. It is
            here rather than behind a hidden gesture because the person who
            needs it is the person carrying the phone into the canyon, and a
            setting they cannot find is a trip's data lost. */}
        {sensorCaps != null && (
          <PreferenceRow
            icon="activity"
            title="Log raw sensors while recording"
            subtitle={sensorLoggingSubtitle(sensorCaps, sensorLogging)}
            subtitleNumberOfLines={4}
            value={sensorLogging}
            ready
            onToggle={() => {
              const next = !sensorLogging;
              if (!stored(writeSensorLoggingEnabled(next))) return;
              setSensorLogging(next);
              // Takes effect at the NEXT recording, deliberately: starting a
              // logger into a run already in progress would produce a file
              // whose first half is missing, and nothing downstream could tell
              // that from a phone that stopped sampling.
              notify(
                next
                  ? "Raw sensors will be logged from the next recording."
                  : "Sensor logging off from the next recording.",
                "info",
              );
            }}
          />
        )}
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

/**
 * What the toggle actually costs and what it produces, in the two sentences a
 * user needs before turning it on. The capability list matters because the
 * answer is per-handset: a phone with no barometer contributes nothing to the
 * elevation question and should not imply it does.
 */
function sensorLoggingSubtitle(
  caps: NonNullable<ReturnType<typeof sensorCapabilities>>,
  enabled: boolean,
): string {
  const channels = [
    caps.gyroscope && caps.accelerometer ? "motion" : null,
    caps.barometer ? "pressure" : null,
    caps.stepCounter ? "steps" : null,
    "satellites",
  ].filter(Boolean) as string[];
  const cost = caps.imuFifoEvents > 0 ? "a few percent of battery" : "battery";
  const what = `Records ${channels.join(", ")} to a file for later analysis. No positions are written, nothing is uploaded, and the app does not read it back.`;
  if (!enabled) return `${what} Costs ${cost} over a trip.`;
  const status = sensorLogStatus();
  if (status == null || !status.logging) {
    return `${what} On from the next recording.`;
  }
  const mb = (status.bytes / 1_000_000).toFixed(1);
  return `${what} Logging now — ${mb} MB written.`;
}
