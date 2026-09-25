import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  formatThreshold,
  THRESHOLD_OPERATOR_LABELS as OPERATOR_LABEL,
  THRESHOLD_OPERATORS as OPERATORS,
  type CustomFieldFilter,
  type NumberRange,
  type PlaceThresholdFilter,
  type ScopedCustomFieldDef,
} from "@logjam/shared";

import { fontSize, fontWeight, spacing, theme } from "../theme";
import { Chip } from "./Chip";
import { RangePills } from "./RangePills";
import { TextField } from "./TextField";

/**
 * One attribute with the control its definition's SHAPE deserves — the phone's
 * half of the pair whose web half is `frontend/src/ui/AttributeFilter.tsx`.
 *
 * It is in the kit, not in a screen, because the Places sheet and the Logs
 * sheet ask the same question of the same definitions: a place's attributes and
 * a trip's are the same kind of thing, filtered by the same shared predicate
 * (`passesCustomFieldFilters`). It was module-private inside
 * `places/PlaceFilterSheet.tsx` until Logs needed it (operator, 2026-09-17).
 *
 * Nothing here may key off a field's NAME. A canyon's grades are ordinary
 * attributes, so a bespoke control for one type is exactly what this replaces.
 */
export function AttributeFilter({
  def,
  value,
  onChange,
}: {
  def: ScopedCustomFieldDef;
  value: CustomFieldFilter | null;
  onChange: (next: CustomFieldFilter | null) => void;
}) {
  if (def.type === "integer" || def.type === "float") {
    const range = value?.kind === "numberRange" ? (value.range as NumberRange) : null;
    return def.min != null && def.max != null ? (
      <RangePills
        label={def.label}
        bounds={[def.min, def.max]}
        value={range}
        onChange={(next) => onChange(next == null ? null : { kind: "numberRange", range: next })}
      />
    ) : (
      <ThresholdFilter
        label={def.label}
        unit=""
        // NO PRESETS. The built-in thresholds have them because someone chose
        // the numbers that matter for abseils and hours; a field the user
        // invented has no such numbers, and deriving them from the bounds gave
        // "Under 0 / Over 0 / Exactly 0" on a min-0 field — three taps that all
        // mean nothing. Custom is the whole control here.
        presets={[]}
        value={value?.kind === "number" ? [value.op, value.value] : null}
        onChange={(next) =>
          onChange(
            next == null || next[0] === "Any"
              ? null
              : { kind: "number", op: next[0], value: next[1] },
          )
        }
      />
    );
  }

  if (def.type === "boolean") {
    const current = value?.kind === "boolean" ? value.value : null;
    return (
      <View style={styles.chipRow}>
        <Text style={styles.blockLabel}>{def.label}</Text>
        {[true, false].map((option) => (
          <Chip
            key={String(option)}
            label={option ? "Yes" : "No"}
            active={current === option}
            // Tapping the active chip clears it: "either" is the third state
            // and it needs to be reachable without a Reset.
            onPress={() =>
              onChange(current === option ? null : { kind: "boolean", value: option })
            }
          />
        ))}
      </View>
    );
  }

  if (def.type === "string") {
    return (
      <TextField
        label={def.label}
        value={value?.kind === "text" ? value.value : ""}
        onChangeText={(next) =>
          onChange(next.trim() === "" ? null : { kind: "text", value: next })
        }
        autoCapitalize="none"
      />
    );
  }

  // ponytail: a DATE definition gets no row on the phone. The date picker is a
  // MODE of the sheet keyed to the built-in date fields, and a date attribute
  // is rare enough to leave to Logjam Web, which draws it as two bounds. Adding
  // one means widening the owning sheet's `Mode` to carry a custom key — the
  // web predicate already handles the filter, so this is UI only.
  return null;
}

/**
 * One "how many / how long / how far" axis: preset pills for the common answers,
 * plus a Custom pill that reveals the full operator + number control.
 *
 * The presets are what makes this usable one-handed at a trailhead; Custom is
 * what keeps it from being a downgrade from the desktop panel. Exported because
 * the Places sheet drives its built-in threshold axes through the same control
 * WITH presets, while an attribute passes none.
 */
export function ThresholdFilter({
  label,
  unit,
  presets,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  presets: PlaceThresholdFilter[];
  value: PlaceThresholdFilter | null;
  onChange: (next: PlaceThresholdFilter | null) => void;
}) {
  const matchedPreset = presets.find(
    (preset) => value != null && preset[0] === value[0] && preset[1] === value[1],
  );
  const [customOpen, setCustomOpen] = useState(false);
  // Operator and number are held as a DRAFT while the custom control is open,
  // and only committed once there is a number. Committing on open would apply
  // "under 0" the instant the user taps Custom — which empties the list and
  // reads as the filter being broken.
  const [draftOperator, setDraftOperator] =
    useState<PlaceThresholdFilter[0]>("Less than");
  const [draftText, setDraftText] = useState("");
  const custom = customOpen || (value != null && !matchedPreset);

  const commit = (operator: PlaceThresholdFilter[0], text: string) => {
    const parsed = Number(text.trim());
    onChange(text.trim() === "" || !Number.isFinite(parsed) ? null : [operator, parsed]);
  };

  const openCustom = () => {
    setDraftOperator(value?.[0] ?? "Less than");
    setDraftText(value == null ? "" : String(value[1]));
    setCustomOpen(true);
  };

  const closeCustom = () => {
    setCustomOpen(false);
    setDraftText("");
    onChange(null);
  };

  return (
    <View style={styles.block}>
      <View style={styles.blockHeader}>
        <Text style={styles.blockLabel}>{label}</Text>
        <Text style={[styles.blockValue, value != null && styles.blockValueActive]}>
          {value == null ? "Any" : formatThreshold(value, unit)}
        </Text>
      </View>
      <View style={styles.chipRow}>
        {presets.map((preset) => (
          <Chip
            key={`${preset[0]}-${preset[1]}`}
            label={formatThreshold(preset, unit)}
            active={!custom && matchedPreset === preset}
            onPress={() => {
              setCustomOpen(false);
              onChange(matchedPreset === preset ? null : preset);
            }}
          />
        ))}
        <Chip
          // With no presets beside it, "Custom" is custom relative to nothing.
          label={presets.length === 0 ? "Set a value" : "Custom"}
          active={custom}
          onPress={() => (custom ? closeCustom() : openCustom())}
        />
      </View>
      {custom ? (
        <View style={styles.customRow}>
          <View style={styles.chipRow}>
            {OPERATORS.map((operator) => (
              <Chip
                key={operator}
                label={OPERATOR_LABEL[operator]}
                active={draftOperator === operator}
                onPress={() => {
                  setDraftOperator(operator);
                  commit(operator, draftText);
                }}
              />
            ))}
          </View>
          <View style={styles.customField}>
            <TextField
              label={unit ? `Value (${unit})` : "Value"}
              value={draftText}
              keyboardType="numeric"
              onChangeText={(text) => {
                setDraftText(text);
                commit(draftOperator, text);
              }}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing(0.75) },
  blockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  blockLabel: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  blockValue: { color: theme.textMuted, fontSize: fontSize.sm },
  blockValueActive: { color: theme.accent, fontWeight: fontWeight.medium },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(0.75) },
  customRow: { gap: spacing(0.75) },
  customField: { maxWidth: 200 },
});
