import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  CANYON_RANGE_BOUNDS,
  validateCanyonPayload,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import { fontSize, spacing, theme } from "../theme";
import type { MirrorCanyon } from "../sync/mirrorStore";
import { createCanyonLocal, updateCanyonLocal } from "../sync/outbox";
import { useAccountState } from "../auth/AccountStateContext";
import { fieldDefsBlockedReason } from "../auth/capabilities";
import { CustomFieldForm, CustomFieldList } from "../customFields/CustomFieldsEditor";
import {
  coerceCustomFields,
  CustomFieldValueInputs,
  fieldValueStrings,
} from "../customFields/CustomFieldValues";
import { useFieldDefs } from "../customFields/useFieldDefs";
import { useConnectivity } from "../map/connectivity";
import {
  BottomSheet,
  Button,
  DatePicker,
  ErrorBanner,
  Row,
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
 * The user's own fields are edited here too, and their definitions are reached
 * through a MODE of this sheet, exactly as on `TripEditSheet` (DESIGN.md §6 —
 * never a second modal). A date-typed field needs the picker, which is the
 * other mode.
 *
 * PRIVACY: a canyon's name and position are the most sensitive pair in the app.
 * They live in component state and leave only through the outbox's authed push;
 * nothing here is logged, and the failure copy is ours rather than the error's.
 */
/** The sheet's sub-screens. Modes, never a second sheet (DESIGN.md §6). */
type Mode = "form" | "date" | "fields" | "fieldForm";

export function CanyonEditSheet({
  visible,
  onClose,
  canyon,
  initialCoords,
  onPickOnMap,
  pickedCoords,
  resuming = false,
  onSaved,
  onFailed,
}: {
  visible: boolean;
  onClose: () => void;
  /** null/undefined = add a new canyon. */
  canyon?: MirrorCanyon | null;
  /** Seeds a new canyon's position from a point picked on the map. */
  initialCoords?: { latitude: number; longitude: number } | null;
  /**
   * Open the full-screen map picker, carrying whatever is in the two coordinate
   * fields right now so it can open there. Absent where there is nowhere to
   * navigate to — this sheet is also mounted on the map itself and on a
   * canyon's detail screen, and only the Canyons list owns the picker route.
   */
  onPickOnMap?: (current: { latitude: number; longitude: number } | null) => void;
  /** A point the picker returned: writes the two fields and nothing else. */
  pickedCoords?: { latitude: number; longitude: number } | null;
  /**
   * True when this sheet is being re-opened after the picker took the screen,
   * rather than opened for a new edit.
   *
   * A sheet is a Modal, so it HAS to close for a full-screen map to be visible
   * — and re-opening otherwise reseeds every field from the canyon, which would
   * throw away the name and grades the user typed before going to look up where
   * the thing is. The component stays mounted throughout, so its state is
   * intact; this flag is only what stops the seed effect from wiping it.
   */
  resuming?: boolean;
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
  const [mode, setMode] = useState<Mode>("form");
  const { accountState } = useAccountState();
  const online = useConnectivity() === "online";
  const { defs: customFieldDefs, setDefs: setCustomFieldDefs } = useFieldDefs("canyon");
  // Values are strings while editing and coerced on save, like every other
  // custom-field form.
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [dateFieldKey, setDateFieldKey] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<TripLogCustomFieldDef | null>(null);
  const fieldsBlocked = fieldDefsBlockedReason(accountState, online);

  // Read through a ref so it is NOT a dependency: `resuming` and `visible` flip
  // in the same commit, and listing it would re-run the seed the moment the
  // parent cleared the flag afterwards — which is the wipe this exists to stop.
  const resumingRef = useRef(resuming);
  resumingRef.current = resuming;

  // Seed each time the sheet opens, so a cancelled edit never leaks into the
  // next one.
  useEffect(() => {
    if (!visible || resumingRef.current) return;
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
    setMode("form");
    setEditingField(null);
    setDateFieldKey(null);
    setFieldValues(fieldValueStrings(canyon?.attributes?.customFields));
  }, [canyon, initialCoords, visible]);

  // A point back from the picker touches the two coordinate fields and nothing
  // else — everything else on this form is what the user was in the middle of
  // typing. Trimmed like any freshly picked point: a map tap carries fifteen
  // meaningless decimals.
  useEffect(() => {
    if (!pickedCoords) return;
    setLatitude(seedCoord(pickedCoords.latitude));
    setLongitude(seedCoord(pickedCoords.longitude));
  }, [pickedCoords]);

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

    const effectiveCustomFields = coerceCustomFields(fieldValues, customFieldDefs);
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
        // `attributes` is replaced wholesale by the server, so the canyon's
        // existing blob is spread through — `sources`, which only the web
        // writes, would otherwise be dropped by an edit made on the phone.
        if (
          JSON.stringify(effectiveCustomFields) !==
          JSON.stringify(canyon.attributes?.customFields ?? {})
        ) {
          changes.attributes = {
            ...canyon.attributes,
            customFields: effectiveCustomFields,
          };
        }
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
          ...(Object.keys(effectiveCustomFields).length > 0 && {
            attributes: { customFields: effectiveCustomFields },
          }),
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
  }, [canyon, customFieldDefs, draft, editing, fieldValues, onClose, onFailed, onSaved]);

  const title =
    mode === "date"
      ? (customFieldDefs.find((def) => def.key === dateFieldKey)?.label ?? "Date")
      : mode === "fields"
        ? "Your canyon fields"
        : mode === "fieldForm"
          ? (editingField ? "Edit field" : "New field")
          : editing
            ? "Edit canyon"
            : "Add a canyon";

  return (
    <BottomSheet
      visible={visible}
      // Inside a sub-mode, a drag or a backdrop tap means "back to the form" —
      // not "throw away everything I just typed".
      onClose={
        mode === "form"
          ? onClose
          : () => setMode(mode === "fieldForm" ? "fields" : "form")
      }
      title={title}
      footer={
        mode === "form" ? (
          <Button
            label={editing ? "Save changes" : "Add canyon"}
            icon="check"
            loading={saving}
            onPress={() => void save()}
          />
        ) : mode === "fieldForm" ? (
          // Its own body carries the save action; this is just the way back.
          <Button label="Cancel" variant="outlineAccent" onPress={() => setMode("fields")} />
        ) : (
          <Button label="Done" icon="check" onPress={() => setMode("form")} />
        )
      }
    >
      {mode === "date" && dateFieldKey ? (
        <View style={styles.modeBody}>
          <DatePicker
            value={fieldValues[dateFieldKey] || null}
            onChange={(key) =>
              setFieldValues((current) => ({ ...current, [dateFieldKey]: key }))
            }
          />
        </View>
      ) : null}

      {mode === "fields" ? (
        <CustomFieldList
          entity="canyon"
          online={online}
          defs={customFieldDefs}
          onAdd={() => {
            setEditingField(null);
            setMode("fieldForm");
          }}
          onEdit={(def) => {
            setEditingField(def);
            setMode("fieldForm");
          }}
        />
      ) : null}

      {mode === "fieldForm" ? (
        <CustomFieldForm
          entity="canyon"
          online={online}
          defs={customFieldDefs}
          editing={editingField}
          onSaved={(next, message) => {
            setCustomFieldDefs(next);
            onSaved(message);
          }}
          onFailed={onFailed}
          onDone={() => setMode("fields")}
        />
      ) : null}

      {mode !== "form" ? null : (
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
        {/* Under the coordinates it fills in, because that is what it does —
            not at the top as a second way to start, which is what the old
            two-option "Add a canyon" sheet made it. Nothing is lost by going:
            the form comes back exactly as it was left. */}
        {onPickOnMap ? (
          <Button
            label="Select on map"
            icon="map-pin"
            variant="outlineAccent"
            onPress={() =>
              onPickOnMap(
                draft.latitude != null && draft.longitude != null
                  ? { latitude: draft.latitude, longitude: draft.longitude }
                  : null,
              )
            }
          />
        ) : null}
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

        <SectionHeader label="Your own fields" />
        <CustomFieldValueInputs
          defs={customFieldDefs}
          values={fieldValues}
          onChange={(key, next) =>
            setFieldValues((current) => ({ ...current, [key]: next }))
          }
          onPickDate={(key) => {
            setDateFieldKey(key);
            setMode("date");
          }}
        />
        {/* A guest's definitions are on this phone, so this door is open with no
            account and no signal. An account's list is shared with the web,
            which is the only case that needs a connection. */}
        <Row
          icon="sliders"
          title="Your canyon fields"
          subtitle={
            fieldsBlocked ??
            (customFieldDefs.length === 0
              ? "Add your own — access notes, permit, anything"
              : `${customFieldDefs.length} field${customFieldDefs.length === 1 ? "" : "s"}`)
          }
          disabled={fieldsBlocked !== undefined}
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
          onPress={() => setMode("fields")}
        />
      </View>
      )}
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
  modeBody: { gap: spacing(2) },
  field: { gap: spacing(0.5) },
  hint: { color: theme.textMuted, fontSize: fontSize.sm, flex: 1 },
  coordRow: { flexDirection: "row", gap: spacing(1) },
  coordField: { flex: 1 },
  fixNote: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
  gradeRow: { gap: spacing(0.5) },
  gradeLabel: { color: theme.textPrimary, fontSize: fontSize.sm },
});
