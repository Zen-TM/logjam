import { useState } from "react";
import { Check, Scan, SquareDashed } from "lucide-react";
import {
  CANYON_FORM_FIELD_KEYS,
  defsForType,
  formatThreshold,
  PLACE_ROPEWIKI_OPTIONS,
  PLACE_SORT_OPTIONS,
  PLACE_THRESHOLDS,
  regionEdgesKm,
  SYSTEM_FIELD_DEFS,
  THRESHOLD_OPERATOR_LABELS,
  THRESHOLD_OPERATORS,
  type NumberRange,
  type PlaceFilters,
  type PlaceSortKey,
  type PlaceThresholdFilter,
  type ScopedCustomFieldDef,
} from "@logjam/shared";
import { Button, Chip, RangePills, SheetSection, SideSheet, SwitchRow, TextField } from "../../../ui";
import classes from "./PlaceFilterSheet.module.css";

type CustomFilter = PlaceFilters["custom"][string];

/** The widest integer span still drawn as pills; wider spans get min/max boxes. */
const MAX_PILL_SPAN = 12;

function rangeOf(filters: PlaceFilters, key: string): NumberRange | null {
  const filter = filters.custom[key];
  return filter?.kind === "numberRange" ? (filter.range as NumberRange) : null;
}

function thresholdOf(filters: PlaceFilters, key: string): PlaceThresholdFilter | null {
  const filter = filters.custom[key];
  return filter?.kind === "number" ? [filter.op, filter.value] : null;
}

/** An inactive custom filter is ABSENT, never present at its default, so "is it
 *  active" stays `key in custom` for every kind. */
function withCustom(filters: PlaceFilters, key: string, value: CustomFilter | null): PlaceFilters {
  const custom = { ...filters.custom };
  if (value == null) delete custom[key];
  else custom[key] = value;
  return { ...filters, custom };
}

function boundsOf(key: string): [number, number] {
  const def = SYSTEM_FIELD_DEFS.find((candidate) => candidate.key === key);
  return [def?.min ?? 1, def?.max ?? 7];
}

/**
 * Sort and filter for Places — everything that isn't a rail. It opens BESIDE
 * the list, so the list it narrows stays in view and updates as you go.
 *
 * The same sheet as Logjam GPS's, section for section (`@logjam/shared`
 * `placeFilterOptions` holds the shared words and presets). Visited, not visited
 * and shared are NOT here: they are the status rail, and a second copy could
 * disagree with it. Which field axes appear follows the type rail — a campsite
 * is never offered a V grade.
 */
export default function PlaceFilterSheet({
  filters,
  onChangeFilters,
  sort,
  onChangeSort,
  placeCustomFieldDefs,
  onDrawArea,
  onAreaToView,
  onReset,
  onClose,
  activeCount,
  resultCount,
  className,
}: {
  filters: PlaceFilters;
  onChangeFilters: (next: PlaceFilters) => void;
  sort: PlaceSortKey;
  onChangeSort: (next: PlaceSortKey) => void;
  placeCustomFieldDefs: ScopedCustomFieldDef[];
  /** Close the panel and draw the area box on the map. */
  onDrawArea: () => void;
  /** Set the area to whatever the map shows now. */
  onAreaToView: () => void;
  onReset: () => void;
  onClose: () => void;
  /** Filters this sheet owns that are set. */
  activeCount: number;
  resultCount: number;
  className?: string;
}) {
  const typeDefs =
    filters.placeTypeId == null ? placeCustomFieldDefs : defsForType(placeCustomFieldDefs, filters.placeTypeId);
  const hasField = (key: string) => typeDefs.some((def) => def.key === key);
  // WHAT IS ALREADY DRAWN, not what is reserved: the canyon axes get their own
  // controls below and are cut from the generic list only when they are shown,
  // or a campsite's own system fields would vanish (root CLAUDE.md).
  const canyonAxesShown = hasField("v_grade");
  const thresholds = PLACE_THRESHOLDS.filter((spec) => hasField(spec.key));
  const drawnByHand = new Set([
    ...(canyonAxesShown ? CANYON_FORM_FIELD_KEYS : []),
    ...thresholds.map((spec) => spec.key),
  ]);
  const ownFieldDefs = typeDefs.filter((def) => !drawnByHand.has(def.key));

  const patch = (next: Partial<PlaceFilters>) => onChangeFilters({ ...filters, ...next });

  const setDateBound = (field: "created_at" | "updated_at", bound: 0 | 1, value: string) => {
    const current = filters[field] ?? [null, null];
    const next: [string | null, string | null] =
      bound === 0 ? [value || null, current[1]] : [current[0], value || null];
    // A `from` after its `to` matches nothing and empties the list with no
    // explanation — push the other bound along instead.
    if (next[0] != null && next[1] != null && next[0] > next[1]) {
      if (bound === 0) next[1] = next[0];
      else next[0] = next[1];
    }
    patch({ [field]: next[0] == null && next[1] == null ? null : next });
  };

  const area = filters.area ? regionEdgesKm(filters.area) : null;

  return (
    <SideSheet
      title="Sort and filter"
      onClose={onClose}
      className={className}
      footer={
        <>
          <span className={classes.count}>
            {resultCount} {resultCount === 1 ? "place" : "places"}
          </span>
          {activeCount > 0 && (
            <Button compact variant="outline" onClick={onReset}>
              Reset
            </Button>
          )}
          <Button compact variant="filled" icon={Check} onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <p className={classes.hint}>Visited, not visited and shared are the chips above the list.</p>

      <SheetSection title="Sort">
        <div className={classes.chips}>
          {PLACE_SORT_OPTIONS.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              active={sort === option.key}
              aria-pressed={sort === option.key}
              onClick={() => onChangeSort(option.key)}
            />
          ))}
        </div>
      </SheetSection>

      {canyonAxesShown && (
        <SheetSection title="Grade">
          <RangePills
            label="Vertical"
            prefix="V"
            bounds={boundsOf("v_grade")}
            value={rangeOf(filters, "v_grade")}
            onChange={(next) => onChangeFilters(withCustom(filters, "v_grade", next && { kind: "numberRange", range: next }))}
          />
          <RangePills
            label="Aquatic"
            prefix="A"
            bounds={boundsOf("a_grade")}
            value={rangeOf(filters, "a_grade")}
            onChange={(next) => onChangeFilters(withCustom(filters, "a_grade", next && { kind: "numberRange", range: next }))}
          />
          <RangePills
            label="Commitment"
            bounds={boundsOf("commitment")}
            value={rangeOf(filters, "commitment")}
            onChange={(next) =>
              onChangeFilters(withCustom(filters, "commitment", next && { kind: "numberRange", range: next }))
            }
          />
          <RangePills
            label="Quality"
            bounds={boundsOf("quality")}
            value={rangeOf(filters, "quality")}
            onChange={(next) => onChangeFilters(withCustom(filters, "quality", next && { kind: "numberRange", range: next }))}
          />
        </SheetSection>
      )}

      {thresholds.length > 0 && (
        <SheetSection title="Logistics">
          {thresholds.map((spec) => (
            <ThresholdFilter
              key={spec.key}
              label={spec.label}
              unit={spec.unit}
              presets={spec.presets}
              value={thresholdOf(filters, spec.key)}
              onChange={(next) =>
                onChangeFilters(
                  withCustom(filters, spec.key, next && next[0] !== "Any" ? { kind: "number", op: next[0], value: next[1] } : null),
                )
              }
            />
          ))}
        </SheetSection>
      )}

      {ownFieldDefs.length > 0 && (
        <SheetSection title="Fields">
          {ownFieldDefs.map((def) => (
            <CustomFieldFilter
              key={def.key}
              def={def}
              value={filters.custom[def.key] ?? null}
              onChange={(next) => onChangeFilters(withCustom(filters, def.key, next))}
            />
          ))}
        </SheetSection>
      )}

      <SheetSection title="Location">
        <div className={classes.chips}>
          {area ? (
            <>
              <Chip
                label={`${Math.round(area[0])} × ${Math.round(area[1])} km`}
                icon={SquareDashed}
                active
                aria-label={`Area set, ${Math.round(area[0])} by ${Math.round(area[1])} kilometres. Draw it again`}
                onClick={onDrawArea}
              />
              <Chip label="Clear" onClick={() => patch({ area: null })} />
            </>
          ) : (
            <>
              <Chip label="Draw on map" icon={SquareDashed} onClick={onDrawArea} />
              <Chip label="This view" icon={Scan} onClick={onAreaToView} />
            </>
          )}
        </div>
      </SheetSection>

      <SheetSection title="Source">
        <div className={classes.chips}>
          {PLACE_ROPEWIKI_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              active={filters.ropewiki === option.value}
              aria-pressed={filters.ropewiki === option.value}
              onClick={() => patch({ ropewiki: option.value })}
            />
          ))}
        </div>
        <SwitchRow
          title="Shared by me"
          description="Only places you have shared with at least one friend."
          checked={filters.shared_by_me}
          onChange={(next) => patch({ shared_by_me: next })}
        />
      </SheetSection>

      <SheetSection title="Dates">
        {(["created_at", "updated_at"] as const).map((field) => (
          <div key={field} className={classes.dateRow}>
            <TextField
              type="date"
              label={field === "created_at" ? "Added from" : "Updated from"}
              value={filters[field]?.[0] ?? ""}
              onChange={(event) => setDateBound(field, 0, event.target.value)}
            />
            <TextField
              type="date"
              label="to"
              value={filters[field]?.[1] ?? ""}
              onChange={(event) => setDateBound(field, 1, event.target.value)}
            />
          </div>
        ))}
      </SheetSection>

      <SheetSection title="Missing info">
        <SwitchRow
          title="Include places missing this info"
          description="Imported places often lack it, so filters would hide them."
          checked={filters.include_unknowns}
          onChange={(next) => patch({ include_unknowns: next })}
        />
      </SheetSection>
    </SideSheet>
  );
}

/**
 * One user-defined field with the control its type deserves: a small bounded
 * whole number is pills; any other number is min–max (bounded) or operator and
 * value (unbounded); yes/no is two chips, where neither is "don't care"; text is
 * a contains-match; a date is a from–to pair.
 */
function CustomFieldFilter({
  def,
  value,
  onChange,
}: {
  def: ScopedCustomFieldDef;
  value: CustomFilter | null;
  onChange: (next: CustomFilter | null) => void;
}) {
  if (def.type === "integer" || def.type === "float") {
    if (def.min != null && def.max != null) {
      const range = value?.kind === "numberRange" ? (value.range as NumberRange) : null;
      if (def.type === "integer" && def.max - def.min <= MAX_PILL_SPAN) {
        return (
          <RangePills
            label={def.label}
            bounds={[def.min, def.max]}
            value={range}
            onChange={(next) => onChange(next && { kind: "numberRange", range: next })}
          />
        );
      }
      return <MinMaxFilter label={def.label} bounds={[def.min, def.max]} value={range} onChange={onChange} />;
    }
    return (
      <ThresholdFilter
        label={def.label}
        unit=""
        presets={[]}
        value={value?.kind === "number" ? [value.op, value.value] : null}
        onChange={(next) => onChange(next && next[0] !== "Any" ? { kind: "number", op: next[0], value: next[1] } : null)}
      />
    );
  }

  if (def.type === "boolean") {
    const current = value?.kind === "boolean" ? value.value : null;
    return (
      <div className={classes.block}>
        <span className={classes.blockLabel}>{def.label}</span>
        <div className={classes.chips}>
          {[true, false].map((option) => (
            <Chip
              key={String(option)}
              label={option ? "Yes" : "No"}
              active={current === option}
              aria-pressed={current === option}
              // Pressing the active chip clears it: "either" must be reachable
              // without a Reset.
              onClick={() => onChange(current === option ? null : { kind: "boolean", value: option })}
            />
          ))}
        </div>
      </div>
    );
  }

  if (def.type === "string") {
    return (
      <TextField
        label={`${def.label} contains`}
        value={value?.kind === "text" ? value.value : ""}
        onChange={(event) =>
          onChange(event.target.value.trim() === "" ? null : { kind: "text", value: event.target.value })
        }
      />
    );
  }

  const dates = value?.kind === "date" ? value.range : null;
  const setBound = (bound: 0 | 1, next: string) => {
    const range: [string | null, string | null] = bound === 0 ? [next || null, dates?.[1] ?? null] : [dates?.[0] ?? null, next || null];
    onChange(range[0] == null && range[1] == null ? null : { kind: "date", range });
  };
  return (
    <div className={classes.dateRow}>
      <TextField type="date" label={`${def.label} from`} value={dates?.[0] ?? ""} onChange={(event) => setBound(0, event.target.value)} />
      <TextField type="date" label="to" value={dates?.[1] ?? ""} onChange={(event) => setBound(1, event.target.value)} />
    </div>
  );
}

/** A bounded number too wide or too fine for pills: two boxes, committed only
 *  once the pair is a real range inside the bounds. */
function MinMaxFilter({
  label,
  bounds,
  value,
  onChange,
}: {
  label: string;
  bounds: [number, number];
  value: NumberRange | null;
  onChange: (next: CustomFilter | null) => void;
}) {
  const [low, setLow] = useState(value ? String(value[0]) : "");
  const [high, setHigh] = useState(value ? String(value[1]) : "");
  const commit = (nextLow: string, nextHigh: string) => {
    if (nextLow.trim() === "" && nextHigh.trim() === "") return onChange(null);
    const from = nextLow.trim() === "" ? bounds[0] : Number(nextLow);
    const to = nextHigh.trim() === "" ? bounds[1] : Number(nextHigh);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return;
    onChange({ kind: "numberRange", range: [Math.max(bounds[0], from), Math.min(bounds[1], to)] });
  };
  return (
    <div className={classes.dateRow}>
      <TextField
        type="number"
        label={`${label} from`}
        placeholder={String(bounds[0])}
        value={low}
        onChange={(event) => {
          setLow(event.target.value);
          commit(event.target.value, high);
        }}
      />
      <TextField
        type="number"
        label="to"
        placeholder={String(bounds[1])}
        value={high}
        onChange={(event) => {
          setHigh(event.target.value);
          commit(low, event.target.value);
        }}
      />
    </div>
  );
}

/**
 * A "how many / how long / how far" axis: the presets people actually pick, and
 * Custom for the rest. The operator and number are a DRAFT until there is a
 * number — committing on opening Custom would apply "under 0" and empty the list.
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
  const matchedPreset = presets.find((preset) => value != null && preset[0] === value[0] && preset[1] === value[1]);
  const [customOpen, setCustomOpen] = useState(false);
  const [draftOperator, setDraftOperator] = useState<PlaceThresholdFilter[0]>(value?.[0] ?? "Less than");
  const [draftText, setDraftText] = useState(value && !matchedPreset ? String(value[1]) : "");
  const custom = customOpen || (value != null && !matchedPreset);

  const commit = (operator: PlaceThresholdFilter[0], text: string) => {
    const parsed = Number(text.trim());
    onChange(text.trim() === "" || !Number.isFinite(parsed) ? null : [operator, parsed]);
  };

  return (
    <div className={classes.block}>
      <div className={classes.blockHeader}>
        <span className={classes.blockLabel}>{label}</span>
        <span className={classes.blockValue} data-active={value != null}>
          {value == null ? "Any" : formatThreshold(value, unit)}
        </span>
      </div>
      <div className={classes.chips}>
        {presets.map((preset) => (
          <Chip
            key={`${preset[0]}-${preset[1]}`}
            label={formatThreshold(preset, unit)}
            active={!custom && matchedPreset === preset}
            aria-pressed={!custom && matchedPreset === preset}
            onClick={() => {
              setCustomOpen(false);
              onChange(matchedPreset === preset ? null : preset);
            }}
          />
        ))}
        <Chip
          label={presets.length === 0 ? "Set a value" : "Custom"}
          active={custom}
          aria-expanded={custom}
          onClick={() => {
            if (custom) {
              setCustomOpen(false);
              setDraftText("");
              onChange(null);
            } else {
              setDraftOperator(value?.[0] ?? "Less than");
              setDraftText(value == null ? "" : String(value[1]));
              setCustomOpen(true);
            }
          }}
        />
      </div>
      {custom && (
        <div className={classes.customRow}>
          <div className={classes.chips}>
            {THRESHOLD_OPERATORS.map((operator) => (
              <Chip
                key={operator}
                label={THRESHOLD_OPERATOR_LABELS[operator]}
                active={draftOperator === operator}
                aria-pressed={draftOperator === operator}
                onClick={() => {
                  setDraftOperator(operator);
                  commit(operator, draftText);
                }}
              />
            ))}
          </div>
          <TextField
            type="number"
            label={unit ? `${label} (${unit})` : label}
            value={draftText}
            onChange={(event) => {
              setDraftText(event.target.value);
              commit(draftOperator, event.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
