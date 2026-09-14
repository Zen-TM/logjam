import { useState } from "react";
import { Check, Scan, SquareDashed } from "lucide-react";
import {
  defsForType,
  filterPillStops,
  formatRange,
  formatThreshold,
  isFullRange,
  PLACE_ROPEWIKI_OPTIONS,
  PLACE_SORT_OPTIONS,
  regionEdgesKm,
  THRESHOLD_OPERATOR_LABELS,
  THRESHOLD_OPERATORS,
  type NumberRange,
  type PlaceFilters,
  type PlaceSortKey,
  type PlaceThresholdFilter,
  type ScopedCustomFieldDef,
} from "@logjam/shared";
import { Button, Chip, FilterField, RangePills, SheetSection, SideSheet, SwitchRow, TextField } from "../../../ui";
import classes from "./PlaceFilterSheet.module.css";

type CustomFilter = PlaceFilters["custom"][string];
type DateRange = readonly [string | null, string | null];

/** An inactive custom filter is ABSENT, never present at its default, so "is it
 *  active" stays `key in custom` for every kind. */
function withCustom(filters: PlaceFilters, key: string, value: CustomFilter | null): PlaceFilters {
  const custom = { ...filters.custom };
  if (value == null) delete custom[key];
  else custom[key] = value;
  return { ...filters, custom };
}

function dateSummary(range: DateRange | null): string {
  if (range == null || (range[0] == null && range[1] == null)) return "Any";
  if (range[0] != null && range[1] != null) return `${range[0]} – ${range[1]}`;
  return range[0] != null ? `From ${range[0]}` : `To ${range[1]}`;
}

/**
 * Sort and filter for Places — everything that isn't a rail. It opens BESIDE
 * the list, so the list it narrows stays in view and updates as you go.
 *
 * Visited, not visited and shared are NOT here: they are the status rail, and a
 * second copy could disagree with it. Which attributes appear follows the type
 * rail, and every one of them is drawn from its definition's SHAPE, never its
 * key: a canyon's grades are ordinary attributes, so they get no section of
 * their own and a user's own "Difficulty, 1-5" is drawn exactly like them.
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
  const fieldDefs =
    filters.placeTypeId == null ? placeCustomFieldDefs : defsForType(placeCustomFieldDefs, filters.placeTypeId);

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

      {fieldDefs.length > 0 && (
        // "Attributes", not "Fields": a field is the box, not the thing it
        // records (mobile ATTRIBUTE_NOUN).
        <SheetSection title="Attributes">
          {fieldDefs.map((def) => (
            <AttributeFilter
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
          <FilterField
            key={field}
            label={field === "created_at" ? "Added" : "Updated"}
            summary={dateSummary(filters[field])}
            active={filters[field] != null}
            onClear={() => patch({ [field]: null })}
          >
            <div className={classes.pair}>
              <TextField
                type="date"
                label="From"
                value={filters[field]?.[0] ?? ""}
                onChange={(event) => setDateBound(field, 0, event.target.value)}
              />
              <TextField
                type="date"
                label="To"
                value={filters[field]?.[1] ?? ""}
                onChange={(event) => setDateBound(field, 1, event.target.value)}
              />
            </div>
          </FilterField>
        ))}
      </SheetSection>

      <SheetSection title="Missing info">
        <SwitchRow
          title="Include places missing this info"
          checked={filters.include_unknowns}
          onChange={(next) => patch({ include_unknowns: next })}
        />
      </SheetSection>
    </SideSheet>
  );
}

/**
 * One attribute with the control its definition's shape deserves: a small
 * bounded whole-number axis is pills (`filterPillStops`); any other bounded
 * number is from–to; an unbounded one is operator and value; yes/no is two
 * chips, where neither is "don't care"; text is a contains-match; a date is a
 * from–to pair.
 */
function AttributeFilter({
  def,
  value,
  onChange,
}: {
  def: ScopedCustomFieldDef;
  value: CustomFilter | null;
  onChange: (next: CustomFilter | null) => void;
}) {
  const clear = () => onChange(null);

  if (def.type === "integer" || def.type === "float") {
    const range = value?.kind === "numberRange" ? (value.range as NumberRange) : null;
    const stops = filterPillStops(def);
    if (stops) {
      return (
        <RangePills
          label={def.label}
          stops={stops}
          value={range}
          onChange={(next) => onChange(next && { kind: "numberRange", range: next })}
        />
      );
    }
    if (def.min != null && def.max != null) {
      return <MinMaxFilter label={def.label} bounds={[def.min, def.max]} value={range} onChange={onChange} />;
    }
    return (
      <ThresholdFilter
        label={def.label}
        value={value?.kind === "number" ? [value.op, value.value] : null}
        onChange={(next) => onChange(next && next[0] !== "Any" ? { kind: "number", op: next[0], value: next[1] } : null)}
      />
    );
  }

  if (def.type === "boolean") {
    const current = value?.kind === "boolean" ? value.value : null;
    return (
      <FilterField
        label={def.label}
        summary={current == null ? "Any" : current ? "Yes" : "No"}
        active={current != null}
        onClear={clear}
      >
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
      </FilterField>
    );
  }

  if (def.type === "string") {
    const text = value?.kind === "text" ? value.value : "";
    return (
      <FilterField label={def.label} summary={text ? `Contains “${text}”` : "Any"} active={text !== ""} onClear={clear}>
        <TextField
          label="Contains"
          value={text}
          onChange={(event) =>
            onChange(event.target.value.trim() === "" ? null : { kind: "text", value: event.target.value })
          }
        />
      </FilterField>
    );
  }

  const dates = value?.kind === "date" ? value.range : null;
  const setBound = (bound: 0 | 1, next: string) => {
    const range: [string | null, string | null] =
      bound === 0 ? [next || null, dates?.[1] ?? null] : [dates?.[0] ?? null, next || null];
    onChange(range[0] == null && range[1] == null ? null : { kind: "date", range });
  };
  return (
    <FilterField label={def.label} summary={dateSummary(dates)} active={dates != null} onClear={clear}>
      <div className={classes.pair}>
        <TextField type="date" label="From" value={dates?.[0] ?? ""} onChange={(event) => setBound(0, event.target.value)} />
        <TextField type="date" label="To" value={dates?.[1] ?? ""} onChange={(event) => setBound(1, event.target.value)} />
      </div>
    </FilterField>
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
  // Reset and the clear button empty the filter from outside; empty the boxes
  // with it, or they go on showing a filter that is no longer applied.
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    if (value == null) {
      setLow("");
      setHigh("");
    }
  }

  const commit = (nextLow: string, nextHigh: string) => {
    if (nextLow.trim() === "" && nextHigh.trim() === "") return onChange(null);
    const from = nextLow.trim() === "" ? bounds[0] : Number(nextLow);
    const to = nextHigh.trim() === "" ? bounds[1] : Number(nextHigh);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return;
    onChange({ kind: "numberRange", range: [Math.max(bounds[0], from), Math.min(bounds[1], to)] });
  };
  return (
    <FilterField
      label={label}
      summary={formatRange(value, bounds)}
      active={!isFullRange(value, bounds)}
      onClear={() => onChange(null)}
    >
      <div className={classes.pair}>
        <TextField
          type="number"
          label="From"
          placeholder={String(bounds[0])}
          value={low}
          onChange={(event) => {
            setLow(event.target.value);
            commit(event.target.value, high);
          }}
        />
        <TextField
          type="number"
          label="To"
          placeholder={String(bounds[1])}
          value={high}
          onChange={(event) => {
            setHigh(event.target.value);
            commit(low, event.target.value);
          }}
        />
      </div>
    </FilterField>
  );
}

/**
 * An unbounded "how many / how long / how far": an operator and a number. The
 * operator is a DRAFT until there is a number — committing it alone would apply
 * "under 0" and empty the list.
 */
function ThresholdFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PlaceThresholdFilter | null;
  onChange: (next: PlaceThresholdFilter | null) => void;
}) {
  const [operator, setOperator] = useState<PlaceThresholdFilter[0]>(value?.[0] ?? "Less than");
  const [text, setText] = useState(value ? String(value[1]) : "");
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    if (value == null) setText("");
  }

  const commit = (nextOperator: PlaceThresholdFilter[0], nextText: string) => {
    const parsed = Number(nextText.trim());
    onChange(nextText.trim() === "" || !Number.isFinite(parsed) ? null : [nextOperator, parsed]);
  };

  return (
    <FilterField
      label={label}
      summary={value == null ? "Any" : formatThreshold(value, "")}
      active={value != null}
      onClear={() => onChange(null)}
    >
      <div className={classes.stack}>
        <div className={classes.chips}>
          {THRESHOLD_OPERATORS.map((candidate) => (
            <Chip
              key={candidate}
              label={THRESHOLD_OPERATOR_LABELS[candidate]}
              active={operator === candidate}
              aria-pressed={operator === candidate}
              onClick={() => {
                setOperator(candidate);
                commit(candidate, text);
              }}
            />
          ))}
        </div>
        <TextField
          type="number"
          label={label}
          hideLabel
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            commit(operator, event.target.value);
          }}
        />
      </div>
    </FilterField>
  );
}
