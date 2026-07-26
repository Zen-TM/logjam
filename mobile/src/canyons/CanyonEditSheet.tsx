import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { CANYON_RANGE_BOUNDS, validateCanyonPayload } from "@logjam/shared";

import { fontSize, spacing, theme } from "../theme";
import type { MirrorCanyon } from "../sync/mirrorStore";
import { createCanyonLocal, updateCanyonLocal } from "../sync/outbox";
import {
  BottomSheet,
  Button,
  ErrorBanner,
  SectionHeader,
  SegmentedControl,
  TextField,
  type SegmentOption,
} from "../ui";

/**
 * Add or edit a canyon — one sheet for both (DESIGN.md §7). The fields are
 * identical; only the title, the submit label and whether coordinates arrive
 * pre-filled differ.
 *
 * Both paths queue through the outbox, so adding a canyon standing at its
 * entrance with no signal works exactly like adding one at home.
 *
 * Coordinates are typed, or seeded by the caller from a point pressed on the map
 * (`initialCoords`). They are never captured from GPS *here*: a permission window
 * cannot be raised from an open sheet (DESIGN.md §7 — the bug that made "Take
 * photo" look dead), so any future fix-based entry belongs in the caller too.
 *
 * PRIVACY: a canyon's name and position are the most sensitive pair in the app.
 * They live in component state and leave only through the outbox's authed push;
 * nothing here is logged, and the failure copy is ours rather than the error's.
 */
export function CanyonEditSheet({
  visible,
  onClose,
  canyon,
  initialCoords,
  onSaved,
  onFailed,
}: {
  visible: boolean;
  onClose: () => void;
  /** null/undefined = add a new canyon. */
  canyon?: MirrorCanyon | null;
  /** Seeds a new canyon's position from a point picked on the map. */
  initialCoords?: { latitude: number; longitude: number } | null;
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
}) {
  const editing = canyon != null;
  const [name, setName] = useState("");
  const [altNames, setAltNames] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [vGrade, setVGrade] = useState("");
  const [aGrade, setAGrade] = useState("");
  const [commitment, setCommitment] = useState("");
  const [quality, setQuality] = useState("");
  const [numAbseils, setNumAbseils] = useState("");
  const [longestAbseil, setLongestAbseil] = useState("");
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed each time the sheet opens, so a cancelled edit never leaks into the
  // next one.
  useEffect(() => {
    if (!visible) return;
    setInvalid(null);
    setSaving(false);
    setName(canyon?.name ?? "");
    setAltNames((canyon?.altNames ?? []).join(", "));
    // An existing canyon's stored value is shown exactly; a freshly picked point
    // is trimmed, because a map press carries fifteen meaningless decimals.
    setLatitude(canyon ? numberText(canyon.latitude) : seedCoord(initialCoords?.latitude));
    setLongitude(canyon ? numberText(canyon.longitude) : seedCoord(initialCoords?.longitude));
    setVGrade(numberText(canyon?.vGrade));
    setAGrade(numberText(canyon?.aGrade));
    setCommitment(numberText(canyon?.commitment));
    setQuality(numberText(canyon?.quality));
    setNumAbseils(numberText(canyon?.numAbseils));
    setLongestAbseil(numberText(canyon?.longestAbseil));
    setHours(numberText(canyon?.hours));
    setNotes(canyon?.notes ?? "");
  }, [canyon, initialCoords, visible]);

  /** The form in the shape both the validator and the ops speak. */
  const draft = useMemo(
    () => ({
      name: name.trim(),
      altNames: altNames
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
      latitude: parseNumber(latitude),
      longitude: parseNumber(longitude),
      vGrade: parseNumber(vGrade),
      aGrade: parseNumber(aGrade),
      commitment: parseNumber(commitment),
      quality: parseNumber(quality),
      numAbseils: parseNumber(numAbseils),
      longestAbseil: parseNumber(longestAbseil),
      hours: parseNumber(hours),
      notes: notes.trim() || null,
    }),
    [
      aGrade,
      altNames,
      commitment,
      hours,
      latitude,
      longestAbseil,
      longitude,
      name,
      notes,
      numAbseils,
      quality,
      vGrade,
    ],
  );

  const save = useCallback(async () => {
    setInvalid(null);
    if (draft.name === "") {
      setInvalid("A canyon needs a name.");
      return;
    }
    // The same predicate the API applies, run before anything is queued: a
    // rejected op would otherwise sit in the outbox as a dead push whose reason
    // the user never sees.
    const problem = validateCanyonPayload(
      {
        ...definedNumbers(draft),
        ...(draft.latitude != null && { latitude: draft.latitude }),
        ...(draft.longitude != null && { longitude: draft.longitude }),
      },
      { requireCoords: !editing },
    );
    if (problem) {
      setInvalid(problem);
      return;
    }

    setSaving(true);
    try {
      if (canyon) {
        // Field-scoped: push only what changed, so a concurrent edit to another
        // field on another device isn't clobbered (§6 LWW).
        const changes: Record<string, unknown> = {};
        if (draft.name !== canyon.name) changes.name = draft.name;
        if (!sameList(draft.altNames, canyon.altNames)) changes.altNames = draft.altNames;
        if (draft.latitude != null && draft.latitude !== canyon.latitude) {
          changes.latitude = draft.latitude;
        }
        if (draft.longitude != null && draft.longitude !== canyon.longitude) {
          changes.longitude = draft.longitude;
        }
        for (const key of NUMERIC_KEYS) {
          if (draft[key] !== canyon[key]) changes[key] = draft[key];
        }
        if (draft.notes !== canyon.notes) changes.notes = draft.notes;
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        await updateCanyonLocal(canyon.id, changes);
        onSaved("Canyon updated.");
      } else {
        await createCanyonLocal({
          name: draft.name,
          // Non-null by the validation above: requireCoords is on for a create.
          latitude: draft.latitude as number,
          longitude: draft.longitude as number,
          altNames: draft.altNames,
          vGrade: draft.vGrade,
          aGrade: draft.aGrade,
          commitment: draft.commitment,
          quality: draft.quality,
          numAbseils: draft.numAbseils,
          longestAbseil: draft.longestAbseil,
          hours: draft.hours,
          notes: draft.notes,
        });
        onSaved("Canyon added.");
      }
      onClose();
    } catch (err) {
      console.error(err);
      onFailed("Couldn't save this canyon. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [canyon, draft, editing, onClose, onFailed, onSaved]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={editing ? "Edit canyon" : "Add a canyon"}
      footer={
        <Button
          label={editing ? "Save changes" : "Add canyon"}
          icon="check"
          loading={saving}
          onPress={() => void save()}
        />
      }
    >
      <View style={styles.form}>
        {invalid ? <ErrorBanner message={invalid} /> : null}

        <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
        <View style={styles.field}>
          <TextField
            label="Also known as"
            value={altNames}
            onChangeText={setAltNames}
            autoCapitalize="words"
          />
          <Text style={styles.hint}>
            Separate alternative names with commas — they&rsquo;re searchable too.
          </Text>
        </View>

        <SectionHeader label="Position" />
        <View style={styles.coordRow}>
          <View style={styles.coordField}>
            <TextField
              label="Latitude"
              value={latitude}
              onChangeText={setLatitude}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.coordField}>
            <TextField
              label="Longitude"
              value={longitude}
              onChangeText={setLongitude}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>
        {!editing && initialCoords ? (
          <View style={styles.fixNote}>
            <Feather name="map-pin" size={14} color={theme.accent} />
            <Text style={styles.hint}>
              Filled in from the point you pressed — edit it if that&rsquo;s off.
            </Text>
          </View>
        ) : null}

        <SectionHeader label="Grade" />
        <GradePicker label="Vertical (V)" axis="v_grade" value={vGrade} onChange={setVGrade} />
        <GradePicker label="Aquatic (A)" axis="a_grade" value={aGrade} onChange={setAGrade} />
        <GradePicker
          label="Commitment"
          axis="commitment"
          value={commitment}
          onChange={setCommitment}
        />
        <GradePicker label="Quality" axis="quality" value={quality} onChange={setQuality} />

        <SectionHeader label="Logistics" />
        <TextField
          label="Abseils"
          value={numAbseils}
          onChangeText={setNumAbseils}
          keyboardType="number-pad"
        />
        <TextField
          label="Longest abseil (m)"
          value={longestAbseil}
          onChangeText={setLongestAbseil}
          keyboardType="numeric"
        />
        <TextField label="Hours" value={hours} onChangeText={setHours} keyboardType="numeric" />

        <SectionHeader label="Notes" />
        <View style={styles.field}>
          <TextField
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            autoCapitalize="sentences"
          />
          <Text style={styles.hint}>
            Anyone you share this canyon with can read these notes. Per-trip notes stay
            private.
          </Text>
        </View>
      </View>
    </BottomSheet>
  );
}

/**
 * A graded axis as a single-select rail with an explicit "not recorded" stop.
 * Unset has to be reachable: most imported canyons have gaps, and a picker with
 * no way back to blank turns "I don't know" into a wrong answer.
 */
function GradePicker({
  label,
  axis,
  value,
  onChange,
}: {
  label: string;
  axis: keyof typeof CANYON_RANGE_BOUNDS;
  value: string;
  onChange: (next: string) => void;
}) {
  const [min, max] = CANYON_RANGE_BOUNDS[axis];
  const options: SegmentOption<string>[] = [{ value: "", label: "—" }];
  for (let stop = min; stop <= max; stop += 1) {
    options.push({ value: String(stop), label: String(stop) });
  }
  return (
    <View style={styles.gradeRow}>
      <Text style={styles.gradeLabel}>{label}</Text>
      <SegmentedControl scroll options={options} value={value} onChange={onChange} />
    </View>
  );
}

const NUMERIC_KEYS = [
  "vGrade",
  "aGrade",
  "commitment",
  "quality",
  "numAbseils",
  "longestAbseil",
  "hours",
] as const;

/** Only the numeric fields the user actually filled in — the validator must not
 * be handed an explicit null for a field that simply isn't recorded. */
function definedNumbers(draft: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of NUMERIC_KEYS) {
    const value = draft[key];
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

/** "" and an unparseable entry both mean "not recorded", not zero. */
function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function numberText(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

/**
 * A picked coordinate at 6 decimal places — about 10 cm, which is finer than any
 * map press or GPS fix, and readable. Stored values are never re-rounded on the
 * way through the edit form: only a NEW point gets this.
 */
const SEED_COORD_DECIMALS = 6;
function seedCoord(value: number | null | undefined): string {
  return value == null ? "" : String(Number(value.toFixed(SEED_COORD_DECIMALS)));
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

const styles = StyleSheet.create({
  form: { gap: spacing(1.5) },
  field: { gap: spacing(0.5) },
  hint: { color: theme.textMuted, fontSize: fontSize.sm, flex: 1 },
  coordRow: { flexDirection: "row", gap: spacing(1) },
  coordField: { flex: 1 },
  fixNote: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
  gradeRow: { gap: spacing(0.5) },
  gradeLabel: { color: theme.textPrimary, fontSize: fontSize.sm },
});
