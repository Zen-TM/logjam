import { useState } from "react";
import {
  dateSummary,
  filterPillStops,
  formatRange,
  formatThreshold,
  isFullRange,
  THRESHOLD_OPERATOR_LABELS,
  THRESHOLD_OPERATORS,
  type CustomFieldFilter,
  type NumberRange,
  type PlaceThresholdFilter,
  type ScopedCustomFieldDef,
} from "@logjam/shared";
import { Chip } from "./Chip";
import { FilterField } from "./FilterField";
import { RangePills } from "./RangePills";
import { TextField } from "./TextField";
import classes from "./AttributeFilter.module.css";

/**
 * One attribute with the control its definition's shape deserves: a small
 * bounded whole-number axis is pills (`filterPillStops`); any other bounded
 * number is from–to; an unbounded one is operator and value; yes/no is two
 * chips, where neither is "don't care"; text is a contains-match; a date is a
 * from–to pair.
 *
 * It lives in the kit because a PLACE and a TRIP are filtered by the same
 * definitions in the same five shapes — the two sheets differ only in which
 * definitions they show and where the filter is stored (operator, 2026-09-17).
 * Nothing here knows which entity it is filtering, and nothing here may key off
 * a field's NAME: a canyon's grades are ordinary attributes, so the control is
 * chosen by shape or a type gets bespoke UI again (DESIGN.md §2).
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
  onChange: (next: CustomFieldFilter | null) => void;
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
