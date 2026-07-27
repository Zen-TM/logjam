import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  CANYON_RANGE_BOUNDS,
  type CanyonFilters,
  type CanyonSortKey,
  type CanyonThresholdFilter,
} from "@logjam/shared";

import { fontSize, fontWeight, spacing, theme } from "../theme";
import {
  BottomSheet,
  Button,
  Chip,
  DatePicker,
  RangePills,
  Row,
  SectionHeader,
  TextField,
  Toggle,
  type NumberRange,
} from "../ui";
import { formatDateKey } from "../logs/logbook";

/**
 * Sort and filter for the Canyons screen — everything that isn't the rail.
 *
 * Coverage against the web panel is deliberate, not accidental:
 *
 * - Completion and ownership are NOT here. They are the rail's four buckets,
 *   which is a better home: one tap, always visible, with live tallies. A second
 *   copy in this sheet would let the two disagree.
 * - Grades are pills rather than sliders (DESIGN.md §9).
 * - The three thresholds keep the web's full operator control, but lead with the
 *   presets people actually pick. "Custom" is one tap away and covers the rest.
 * - Dates, RopeWiki link and "shared by me" are straight ports.
 * - Custom-FIELD filters are the one real gap. The web builds a control per
 *   field type; on a phone that is a screenful of inputs for a rarely-used axis.
 *   Values still show on canyon detail.
 *
 * PRIVACY: filter state is local to the screen. The "show only these on the map"
 * option passes canyon IDS to the map through an in-memory store — never a bbox,
 * never anything persisted (see canyonMapFilter.ts).
 */
type Mode =
  | { kind: "main" }
  | { kind: "date"; field: DateField; bound: 0 | 1 };

type DateField = "created_at" | "updated_at";

/** Exported so the screen's active-filter strip can name the order without
 * keeping a second copy of these labels. */
export function sortLabel(sort: CanyonSortKey): string {
  return SORTS.find((option) => option.key === sort)?.label ?? "Name";
}

const SORTS: { key: CanyonSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "recent", label: "Recently added" },
  { key: "grade", label: "Easiest first" },
  { key: "quality", label: "Best rated" },
];

const ROPEWIKI: { value: CanyonFilters["ropewiki"]; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "linked", label: "From RopeWiki" },
  { value: "unlinked", label: "Mine alone" },
];

/** Presets are the shortcut, not the ceiling — "Custom" reaches everything else. */
const THRESHOLDS: {
  key: "pitches" | "longest_pitch" | "hours";
  label: string;
  unit: string;
  presets: CanyonThresholdFilter[];
}[] = [
  {
    key: "pitches",
    label: "Abseils",
    unit: "",
    presets: [
      ["Exactly", 0],
      ["Less than", 5],
      ["More than", 10],
    ],
  },
  {
    key: "longest_pitch",
    label: "Longest abseil",
    unit: "m",
    presets: [
      ["Less than", 20],
      ["Less than", 30],
      ["Less than", 45],
      ["Less than", 60],
    ],
  },
  {
    key: "hours",
    label: "Time out",
    unit: "h",
    presets: [
      ["Less than", 4],
      ["Less than", 6],
      ["Less than", 8],
    ],
  },
];

const OPERATORS: CanyonThresholdFilter[0][] = ["Less than", "More than", "Exactly"];

const OPERATOR_LABEL: Record<CanyonThresholdFilter[0], string> = {
  Any: "Any",
  "Less than": "Under",
  "More than": "Over",
  Exactly: "Exactly",
};

export function CanyonFilterSheet({
  visible,
  onClose,
  filters,
  onChangeFilters,
  sort,
  onChangeSort,
  onReset,
  activeCount,
  showFilteredOnMap,
  onChangeShowFilteredOnMap,
  filteredCount,
  totalCount,
}: {
  visible: boolean;
  onClose: () => void;
  filters: CanyonFilters;
  onChangeFilters: (next: CanyonFilters) => void;
  sort: CanyonSortKey;
  onChangeSort: (next: CanyonSortKey) => void;
  onReset: () => void;
  activeCount: number;
  showFilteredOnMap: boolean;
  onChangeShowFilteredOnMap: (next: boolean) => void;
  filteredCount: number;
  totalCount: number;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "main" });

  const patch = useCallback(
    (next: Partial<CanyonFilters>) => onChangeFilters({ ...filters, ...next }),
    [filters, onChangeFilters],
  );

  const setDateBound = useCallback(
    (field: DateField, bound: 0 | 1, value: string | null) => {
      const current = filters[field] ?? [null, null];
      const next: [string | null, string | null] =
        bound === 0 ? [value, current[1]] : [current[0], value];
      patch({ [field]: next[0] == null && next[1] == null ? null : next });
    },
    [filters, patch],
  );

  const title =
    mode.kind === "date"
      ? `${mode.field === "created_at" ? "Added" : "Updated"} · ${mode.bound === 0 ? "from" : "to"}`
      : "Sort & filter";

  return (
    <BottomSheet
      visible={visible}
      // A date picker backs out to the filter list, not out of the sheet.
      onClose={mode.kind === "main" ? onClose : () => setMode({ kind: "main" })}
      title={title}
      footer={
        mode.kind === "main" ? (
          <Button label="Done" icon="check" onPress={onClose} />
        ) : (
          <Button
            label="Clear this bound"
            variant="outlineAccent"
            onPress={() => {
              setDateBound(mode.field, mode.bound, null);
              setMode({ kind: "main" });
            }}
          />
        )
      }
    >
      {mode.kind === "date" ? (
        <DatePicker
          value={filters[mode.field]?.[mode.bound] ?? null}
          onChange={(key) => {
            setDateBound(mode.field, mode.bound, key);
            setMode({ kind: "main" });
          }}
        />
      ) : (
        <View style={styles.body}>
          {/* Says where the missing axes went, so their absence reads as a
              decision rather than a gap. */}
          <Text style={styles.hint}>
            Done, to do and shared are the chips above this sheet.
          </Text>

          <SectionHeader label="Sort" />
          <View style={styles.chipRow}>
            {SORTS.map((option) => (
              <Chip
                key={option.key}
                label={option.label}
                active={sort === option.key}
                onPress={() => onChangeSort(option.key)}
              />
            ))}
          </View>

          <SectionHeader label="Grade" />
          <RangePills
            label="Vertical"
            prefix="V"
            bounds={CANYON_RANGE_BOUNDS.v_grade}
            value={filters.v_grade as NumberRange | null}
            onChange={(next) => patch({ v_grade: next })}
          />
          <RangePills
            label="Aquatic"
            prefix="A"
            bounds={CANYON_RANGE_BOUNDS.a_grade}
            value={filters.a_grade as NumberRange | null}
            onChange={(next) => patch({ a_grade: next })}
          />
          <RangePills
            label="Commitment"
            bounds={CANYON_RANGE_BOUNDS.commitment}
            value={filters.commitment as NumberRange | null}
            onChange={(next) => patch({ commitment: next })}
          />
          <RangePills
            label="Quality"
            bounds={CANYON_RANGE_BOUNDS.quality}
            value={filters.quality as NumberRange | null}
            onChange={(next) => patch({ quality: next })}
          />

          <SectionHeader label="Logistics" />
          {THRESHOLDS.map((spec) => (
            <ThresholdFilter
              key={spec.key}
              label={spec.label}
              unit={spec.unit}
              presets={spec.presets}
              value={filters[spec.key]}
              onChange={(next) => patch({ [spec.key]: next })}
            />
          ))}

          <SectionHeader label="Source" />
          <View style={styles.chipRow}>
            {ROPEWIKI.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={filters.ropewiki === option.value}
                onPress={() => patch({ ropewiki: option.value })}
              />
            ))}
          </View>
          <Row
            icon="share-2"
            title="Shared by me"
            subtitle="Only canyons you've given a friend access to"
            right={
              <Toggle
                value={filters.shared_by_me}
                accessibilityLabel="Only canyons you have shared"
                onValueChange={(next) => patch({ shared_by_me: next })}
              />
            }
          />

          <SectionHeader label="Dates" />
          <DateRangeFilter
            label="Added"
            value={filters.created_at}
            onPick={(bound) => setMode({ kind: "date", field: "created_at", bound })}
            onClear={() => patch({ created_at: null })}
          />
          <DateRangeFilter
            label="Updated"
            value={filters.updated_at}
            onPick={(bound) => setMode({ kind: "date", field: "updated_at", bound })}
            onClear={() => patch({ updated_at: null })}
          />

          <SectionHeader label="On the map" />
          <Row
            icon="map"
            title="Show only these on the map"
            subtitle={
              showFilteredOnMap
                ? `${filteredCount} of ${totalCount} canyons`
                : "The map shows every canyon"
            }
            right={
              <Toggle
                value={showFilteredOnMap}
                accessibilityLabel="Show only the filtered canyons on the map"
                onValueChange={onChangeShowFilteredOnMap}
              />
            }
          />

          <SectionHeader label="Gaps in the data" />
          <Row
            icon="help-circle"
            title="Include canyons missing this data"
            subtitle="Most imported canyons have no recorded grade"
            right={
              <Toggle
                value={filters.include_unknowns}
                accessibilityLabel="Include canyons missing the filtered data"
                onValueChange={(next) => patch({ include_unknowns: next })}
              />
            }
          />

          {activeCount > 0 ? (
            <Button label="Reset filters" variant="outlineAccent" onPress={onReset} />
          ) : null}
        </View>
      )}
    </BottomSheet>
  );
}

/**
 * One "how many / how long / how far" axis: preset pills for the common answers,
 * plus a Custom pill that reveals the web's full operator + number control.
 *
 * The presets are what makes this usable one-handed at a trailhead; Custom is
 * what keeps it from being a downgrade from the desktop panel.
 */
function ThresholdFilter({
  label,
  unit,
  presets,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  presets: CanyonThresholdFilter[];
  value: CanyonThresholdFilter | null;
  onChange: (next: CanyonThresholdFilter | null) => void;
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
    useState<CanyonThresholdFilter[0]>("Less than");
  const [draftText, setDraftText] = useState("");
  const custom = customOpen || (value != null && !matchedPreset);

  const commit = (operator: CanyonThresholdFilter[0], text: string) => {
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
          label="Custom"
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

function formatThreshold(filter: CanyonThresholdFilter, unit: string): string {
  return `${OPERATOR_LABEL[filter[0]]} ${filter[1]}${unit ? ` ${unit}` : ""}`;
}

/** A date range as two tappable bounds — the same two-level shape the Logs
 * screen uses, so the picker is never more than one step away. */
function DateRangeFilter({
  label,
  value,
  onPick,
  onClear,
}: {
  label: string;
  value: [string | null, string | null] | null;
  onPick: (bound: 0 | 1) => void;
  onClear: () => void;
}) {
  const from = value?.[0] ?? null;
  const to = value?.[1] ?? null;
  const active = from != null || to != null;
  return (
    <View style={styles.block}>
      <View style={styles.blockHeader}>
        <Text style={styles.blockLabel}>{label}</Text>
        <Text style={[styles.blockValue, active && styles.blockValueActive]}>
          {active ? "Set" : "Any time"}
        </Text>
      </View>
      <View style={styles.chipRow}>
        <Chip
          label={from ? `From ${shortDate(from)}` : "From: any"}
          active={from != null}
          onPress={() => onPick(0)}
        />
        <Chip
          label={to ? `To ${shortDate(to)}` : "To: today"}
          active={to != null}
          onPress={() => onPick(1)}
        />
        {active ? <Chip label="Clear" onPress={onClear} /> : null}
      </View>
    </View>
  );
}

function shortDate(key: string): string {
  return formatDateKey(`${key}T00:00:00.000Z`);
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  hint: { color: theme.textMuted, fontSize: fontSize.sm },
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
