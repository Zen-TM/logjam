import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  CANYON_FORM_FIELD_KEYS,
  defsForType,
  SYSTEM_FIELD_DEFS,
  regionEdgesKm,
  type PlaceFilters,
  type PlaceSortKey,
  type PlaceThresholdFilter,
  type ScopedCustomFieldDef,
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
import { useFieldDefs } from "../customFields/useFieldDefs";
import { useMirrorPlaceTypes } from "../sync/useSyncQueries";

/**
 * Sort and filter for the Places screen — everything that isn't the rail.
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
 * - Custom-FIELD filters ARE here now, and they are the same thing as the
 *   grades: every axis below is a definition, and which ones appear is decided
 *   by the type tab. On "All" you get every place field; on Campsite you get
 *   the campsite's, and no V grade. `ponytail:` a DATE definition gets no row —
 *   the date picker is a mode keyed to the two built-in date fields, and a
 *   date on a PLACE (rather than on a trip) is rare enough to leave to the web.
 *   Add one by widening `Mode` to carry a custom key.
 *
 * PRIVACY: filter state is local to the screen and dies with it. The "show only
 * these on the map" option passes place IDS to the map through an in-memory
 * store — never a bbox (see placeMapFilter.ts, whose store carries no region of
 * interest and derives none). The `area` filter is the one coordinate here: a
 * box the user drew on their own map, held in this screen's state, never
 * persisted and never sent. It is summarised by its SIZE and never by its
 * position — the picker is where you see where it is, on a map, deliberately
 * rather than as a coordinate anyone could read over a shoulder.
 */
type Mode =
  | { kind: "main" }
  | { kind: "date"; field: DateField; bound: 0 | 1 };

type DateField = "created_at" | "updated_at";

/** Exported so the screen's active-filter strip can name the order without
 * keeping a second copy of these labels. */
export function sortLabel(sort: PlaceSortKey): string {
  return SORTS.find((option) => option.key === sort)?.label ?? "Name";
}

const SORTS: { key: PlaceSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "recent", label: "Recently added" },
  { key: "grade", label: "Easiest first" },
  { key: "quality", label: "Best rated" },
];

const ROPEWIKI: { value: PlaceFilters["ropewiki"]; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "linked", label: "From RopeWiki" },
  { value: "unlinked", label: "Not from RopeWiki" },
];

/** Presets are the shortcut, not the ceiling — "Custom" reaches everything else. */
// The seven graded axes live in `filters.custom` now, keyed by their reserved
// FIELD keys — they are ordinary custom-field filters, and two of them changed
// name on the way (`pitches` -> `num_abseils`, `longest_pitch` ->
// `longest_abseil`). These four helpers are the whole adaptation: the pills and
// threshold rows below are unchanged, they just read and write one level in.
//
// ponytail: this sheet still shows exactly the seven canyon axes and no other
// field. Rendering a filter row per definition of the selected type is phase 5,
// with the type tabs that decide which definitions are in force.
function rangeOf(filters: PlaceFilters, key: string): NumberRange | null {
  const filter = filters.custom?.[key];
  return filter?.kind === "numberRange" ? (filter.range as NumberRange) : null;
}

function patchRange(key: string, next: NumberRange | null) {
  return (filters: PlaceFilters): Partial<PlaceFilters> => {
    const custom = { ...(filters.custom ?? {}) };
    // An inactive filter is ABSENT rather than present at its full span, which
    // is what lets "is it active" be `key in custom` with nothing needing to
    // know the span.
    if (next == null) delete custom[key];
    else custom[key] = { kind: "numberRange", range: next };
    return { custom };
  };
}

function thresholdOf(
  filters: PlaceFilters,
  key: string,
): PlaceThresholdFilter | null {
  const filter = filters.custom?.[key];
  return filter?.kind === "number" ? [filter.op, filter.value] : null;
}

function patchThreshold(key: string, next: PlaceThresholdFilter | null) {
  return (filters: PlaceFilters): Partial<PlaceFilters> => {
    const custom = { ...(filters.custom ?? {}) };
    if (next == null || next[0] === "Any") delete custom[key];
    else custom[key] = { kind: "number", op: next[0], value: next[1] };
    return { custom };
  };
}

/** A system definition's bounds, for the pill row. They are declared on the
 *  definition and nowhere else. */
function boundsOf(key: string): [number, number] {
  const def = SYSTEM_FIELD_DEFS.find((candidate) => candidate.key === key);
  return [def?.min ?? 1, def?.max ?? 7];
}

const THRESHOLDS: {
  key: string;
  label: string;
  unit: string;
  presets: PlaceThresholdFilter[];
}[] = [
  {
    key: "num_abseils",
    label: "Abseils",
    unit: "",
    presets: [
      ["Exactly", 0],
      ["Less than", 5],
      ["More than", 10],
    ],
  },
  {
    key: "longest_abseil",
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

const OPERATORS: PlaceThresholdFilter[0][] = ["Less than", "More than", "Exactly"];

const OPERATOR_LABEL: Record<PlaceThresholdFilter[0], string> = {
  Any: "Any",
  "Less than": "Under",
  "More than": "Over",
  Exactly: "Exactly",
};

export function PlaceFilterSheet({
  visible,
  onClose,
  filters,
  onChangeFilters,
  sort,
  onChangeSort,
  onReset,
  onPickArea,
  activeCount,
  showFilteredOnMap,
  onChangeShowFilteredOnMap,
  filteredCount,
  totalCount,
}: {
  visible: boolean;
  onClose: () => void;
  filters: PlaceFilters;
  onChangeFilters: (next: PlaceFilters) => void;
  sort: PlaceSortKey;
  onChangeSort: (next: PlaceSortKey) => void;
  onReset: () => void;
  /**
   * Open the area picker. A separate SCREEN, so the sheet has to close and
   * re-open around it — a `BottomSheet` is an RN `Modal` in its own window, and
   * a map drawn behind it would be invisible. The screen owns that dance.
   */
  onPickArea: () => void;
  activeCount: number;
  showFilteredOnMap: boolean;
  onChangeShowFilteredOnMap: (next: boolean) => void;
  filteredCount: number;
  totalCount: number;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "main" });
  // WHICH AXES EXIST is a property of the type tab, not of this sheet. On
  // "All" every place field is offered; on a type, only that type's — which is
  // what stops a campsite filter asking for a vertical grade.
  const { defs } = useFieldDefs("place");
  const placeTypes = useMirrorPlaceTypes().data ?? [];
  const typeDefs =
    filters.placeTypeId == null ? defs : defsForType(defs, filters.placeTypeId);
  const hasReserved = (key: string) =>
    typeDefs.some((def) => def.key === key);
  // WHAT IS ALREADY DRAWN, not what is reserved. The canyon axes get bespoke
  // controls below (a grade rail beats a number box) and are cut from the
  // generic list — but only when they are actually rendered. Cutting every
  // RESERVED key instead deleted the campsite's own `capacity` and
  // `is a cave?`: system fields with no control of their own.
  const canyonAxesShown = hasReserved("v_grade");
  const drawnByHand = new Set([
    ...(canyonAxesShown ? CANYON_FORM_FIELD_KEYS : []),
    ...THRESHOLDS.filter((spec) => hasReserved(spec.key)).map((spec) => spec.key),
  ]);
  // A DATE definition gets no control (see the header), so it is cut from the
  // list rather than from the renderer — a section header standing over
  // nothing is worse than an axis you cannot filter on.
  const ownFieldDefs = typeDefs.filter(
    (def) => !drawnByHand.has(def.key) && def.type !== "date",
  );

  /** Named for the TYPE where there is one, the same way the place form names
   *  it: on a Campsite these fields are ours, not the user's. */
  const fieldSectionLabel =
    filters.placeTypeId == null
      ? "Fields"
      : `${placeTypes.find((type) => type.id === filters.placeTypeId)?.name ?? "Place"} fields`;

  const patch = useCallback(
    (next: Partial<PlaceFilters>) => onChangeFilters({ ...filters, ...next }),
    [filters, onChangeFilters],
  );

  const setDateBound = useCallback(
    (field: DateField, bound: 0 | 1, value: string | null) => {
      const current = filters[field] ?? [null, null];
      const next: [string | null, string | null] =
        bound === 0 ? [value, current[1]] : [current[0], value];
      // The bounds are set independently, so `from` can be dragged past `to`
      // — after which the predicate matches nothing and the list is empty
      // with no explanation. Push the other bound along instead.
      if (next[0] != null && next[1] != null && next[0] > next[1]) {
        if (bound === 0) next[1] = next[0];
        else next[0] = next[1];
      }
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
      overlay={
        mode.kind === "date" ? (
          <DatePicker
            value={filters[mode.field]?.[mode.bound] ?? null}
            onChange={(key) => {
              setDateBound(mode.field, mode.bound, key);
              setMode({ kind: "main" });
            }}
          />
        ) : null
      }
      footer={
        mode.kind === "main" ? (
          <Button label="Done" icon="check" onPress={onClose} />
        ) : (
          // Two ways back out of a date, because they mean different things:
          // Cancel keeps whatever bound was already set, Clear removes it.
          <View style={styles.dateActions}>
            <View style={styles.dateAction}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setMode({ kind: "main" })}
              />
            </View>
            <View style={styles.dateAction}>
              <Button
                label="Clear this bound"
                variant="outlineAccent"
                onPress={() => {
                  setDateBound(mode.field, mode.bound, null);
                  setMode({ kind: "main" });
                }}
              />
            </View>
          </View>
        )
      }
    >
      {/* The list stays mounted underneath (see `overlay` on BottomSheet):
          swapping the sheet's CHILDREN for the short picker collapses the
          scroll content, and RN clamps the offset to 0 — so coming back from a
          date threw the user to the top of a long sheet. */}
      <View style={styles.body}>
        {/* Says where the missing axes went, so their absence reads as a
            decision rather than a gap. */}
        <Text style={styles.hint}>
          Visited, not visited and shared are filtered by the tabs above.
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

        {canyonAxesShown ? (
          <>
            <SectionHeader label="Grade" />
            <RangePills
              label="Vertical"
              prefix="V"
              bounds={boundsOf("v_grade")}
              value={rangeOf(filters, "v_grade")}
              onChange={(next) => patch(patchRange("v_grade", next)(filters))}
            />
            <RangePills
              label="Aquatic"
              prefix="A"
              bounds={boundsOf("a_grade")}
              value={rangeOf(filters, "a_grade")}
              onChange={(next) => patch(patchRange("a_grade", next)(filters))}
            />
            <RangePills
              label="Commitment"
              bounds={boundsOf("commitment")}
              value={rangeOf(filters, "commitment")}
              onChange={(next) => patch(patchRange("commitment", next)(filters))}
            />
            <RangePills
              label="Quality"
              bounds={boundsOf("quality")}
              value={rangeOf(filters, "quality")}
              onChange={(next) => patch(patchRange("quality", next)(filters))}
            />
          </>
        ) : null}

        {THRESHOLDS.some((spec) => hasReserved(spec.key)) ? (
          <>
            <SectionHeader label="Logistics" />
            {THRESHOLDS.filter((spec) => hasReserved(spec.key)).map((spec) => (
              <ThresholdFilter
                key={spec.key}
                label={spec.label}
                unit={spec.unit}
                presets={spec.presets}
                value={thresholdOf(filters, spec.key)}
                onChange={(next) => patch(patchThreshold(spec.key, next)(filters))}
              />
            ))}
          </>
        ) : null}

        {/* A ROW PER DEFINITION — the user's own fields, filtered the same way
            the grades are, because they ARE the same thing. */}
        {ownFieldDefs.length > 0 ? (
          <>
            <SectionHeader label={fieldSectionLabel} />
            {ownFieldDefs.map((def) => (
              <CustomFieldFilter
                key={def.key}
                def={def}
                filters={filters}
                onPatch={patch}
              />
            ))}
          </>
        ) : null}

        <SectionHeader label="Location" />
        <AreaFilter
          area={filters.area}
          onPick={onPickArea}
          onClear={() => patch({ area: null })}
        />

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
          right={
            <Toggle
              value={filters.shared_by_me}
              accessibilityLabel="Only places you have shared"
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
          title="Show filtered places on the map"
          subtitle={
            !showFilteredOnMap
              ? "The map shows every place"
              : filteredCount >= totalCount
                ? // Nothing is being narrowed — say so rather than printing a
                  // fraction that reads as "1 place is missing".
                  `All ${totalCount} places`
                : `${filteredCount} of ${totalCount} places`
          }
          right={
            <Toggle
              value={showFilteredOnMap}
              accessibilityLabel="Show only the filtered places on the map"
              onValueChange={onChangeShowFilteredOnMap}
            />
          }
        />

        <SectionHeader label="Missing info" />
        <Row
          icon="help-circle"
          title="Include places missing this info"
          // Two lines: it has to fit beside a Toggle, and the one-line version
          // ellipsised. Also no longer says "grade" — this switch covers every
          // filtered field, not just the grades.
          subtitle="Imported places often lack it, so filters would hide them."
          subtitleNumberOfLines={2}
          right={
            <Toggle
              value={filters.include_unknowns}
              accessibilityLabel="Include places missing the filtered data"
              onValueChange={(next) => patch({ include_unknowns: next })}
            />
          }
        />

        {activeCount > 0 ? (
        <Button label="Reset filters" variant="outlineAccent" onPress={onReset} />
        ) : null}
      </View>
    </BottomSheet>
  );
}

/**
 * ONE user-defined field as a filter row, with the control its type deserves:
 *
 *  - a bounded number is a pill range, the same control the grades get, because
 *    the bounds make every stop nameable;
 *  - an unbounded number is the operator + value control, since there is no
 *    span to lay out;
 *  - a yes/no is two chips, where the third state (neither) is "don't care";
 *  - text is a contains-match — the search box above matches NAMES, so a field
 *    value is otherwise unreachable from the phone.
 *
 * `ponytail:` a DATE definition renders nothing — see this file's header.
 */
function CustomFieldFilter({
  def,
  filters,
  onPatch,
}: {
  def: ScopedCustomFieldDef;
  filters: PlaceFilters;
  onPatch: (next: Partial<PlaceFilters>) => void;
}) {
  const current = filters.custom?.[def.key];
  const patchCustom = (value: PlaceFilters["custom"][string] | null) => {
    const custom = { ...(filters.custom ?? {}) };
    // Absent rather than present-at-its-default, so "is it active" stays
    // `key in custom` for every kind.
    if (value == null) delete custom[def.key];
    else custom[def.key] = value;
    onPatch({ custom });
  };

  if (def.type === "integer" || def.type === "float") {
    return def.min != null && def.max != null ? (
      <RangePills
        label={def.label}
        bounds={[def.min, def.max]}
        value={rangeOf(filters, def.key)}
        onChange={(next) =>
          patchCustom(next == null ? null : { kind: "numberRange", range: next })
        }
      />
    ) : (
      <ThresholdFilter
        label={def.label}
        unit=""
        // NO PRESETS. The three built-in thresholds have them because someone
        // chose the numbers that matter for abseils and hours; a field the user
        // invented has no such numbers, and deriving them from the bounds gave
        // "Under 0 / Over 0 / Exactly 0" on a min-0 field — three taps that all
        // mean nothing. Custom is the whole control here.
        presets={[]}
        value={thresholdOf(filters, def.key)}
        onChange={(next) =>
          patchCustom(
            next == null || next[0] === "Any"
              ? null
              : { kind: "number", op: next[0], value: next[1] },
          )
        }
      />
    );
  }

  if (def.type === "boolean") {
    const value = current?.kind === "boolean" ? current.value : null;
    return (
      <View style={styles.chipRow}>
        <Text style={styles.blockLabel}>{def.label}</Text>
        {[true, false].map((option) => (
          <Chip
            key={String(option)}
            label={option ? "Yes" : "No"}
            active={value === option}
            // Tapping the active chip clears it: "either" is the third state
            // and it needs to be reachable without a Reset.
            onPress={() =>
              patchCustom(
                value === option ? null : { kind: "boolean", value: option },
              )
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
        value={current?.kind === "text" ? current.value : ""}
        onChangeText={(next) =>
          patchCustom(next.trim() === "" ? null : { kind: "text", value: next })
        }
        autoCapitalize="none"
      />
    );
  }

  return null;
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

function formatThreshold(filter: PlaceThresholdFilter, unit: string): string {
  return `${OPERATOR_LABEL[filter[0]]} ${filter[1]}${unit ? ` ${unit}` : ""}`;
}

/** A date range as two tappable bounds — the same two-level shape the Logs
 * screen uses, so the picker is never more than one step away. */
/**
 * The framed area, shown the way the other filters show themselves — except
 * that its value is a place, and a place is not something to print.
 *
 * The chip carries the box's SIZE, not its position: "18 x 11 km" says which of
 * two saved areas this is about as well as a coordinate pair would, without
 * putting a place's location in text on a screen. Where it actually is, is
 * answered by tapping the chip — the picker opens on the box, over the map.
 */
function AreaFilter({
  area,
  onPick,
  onClear,
}: {
  area: PlaceFilters["area"];
  onPick: () => void;
  onClear: () => void;
}) {
  const size = area ? regionEdgesKm(area) : null;
  return (
    <View style={styles.block}>
      <View style={styles.blockHeader}>
        <Text style={styles.blockLabel}>Area</Text>
        <Text style={[styles.blockValue, area != null && styles.blockValueActive]}>
          {area ? "Set" : "Anywhere"}
        </Text>
      </View>
      <View style={styles.chipRow}>
        <Chip
          label={
            size
              ? `${Math.round(size[0])} x ${Math.round(size[1])} km`
              : "Choose on map"
          }
          active={area != null}
          onPress={onPick}
        />
        {area ? <Chip label="Clear" onPress={onClear} /> : null}
      </View>
    </View>
  );
}

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
  dateActions: { flexDirection: "row", gap: spacing(1) },
  dateAction: { flex: 1 },
  customRow: { gap: spacing(0.75) },
  customField: { maxWidth: 200 },
});
