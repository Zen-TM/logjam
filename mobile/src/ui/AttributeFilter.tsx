import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import {
  attributeFilterShape,
  formatRange,
  formatThreshold,
  isFullRange,
  coerceFieldInput,
  fieldInputText,
  isLengthField,
  stopLabel,
  withLengthUnit,
  THRESHOLD_OPERATOR_LABELS as OPERATOR_LABEL,
  THRESHOLD_OPERATORS as OPERATORS,
  type AttributeFilterShape,
  type CustomFieldFilter,
  type NumberRange,
  type PlaceThresholdFilter,
  type ScopedCustomFieldDef,
  displayUnits,
} from "@logjam/shared";

import { formRhythm, spacing, makeStyles } from "../theme";
import { Chip } from "./Chip";
import { DateRangeFilter } from "./DateRangeFilter";
import { RangePills } from "./RangePills";
import { TextField } from "./TextField";

type Props = {
  def: ScopedCustomFieldDef;
  value: CustomFieldFilter | null;
  onChange: (next: CustomFieldFilter | null) => void;
  /**
   * Open the owning sheet's date picker on one bound of this attribute. A
   * sheet that passes none draws no row for a date attribute.
   */
  onPickDate?: (bound: 0 | 1) => void;
};

/**
 * One control per shape (`attributeFilterShape` in `@logjam/shared`, the rule
 * Logjam Web's `AttributeFilter` follows too). Exhaustive by type, so a shape
 * the rule adds cannot go undrawn here.
 */
const SHAPES: Record<AttributeFilterShape, (props: Props) => ReactNode> = {
  pills: ({ def, value, onChange }) => (
    <RangePills
      label={def.label}
      bounds={[def.min as number, def.max as number]}
      value={value?.kind === "numberRange" ? value.range : null}
      word={(stop) => stopLabel(def.key, stop)}
      onChange={(next) =>
        onChange(next == null ? null : { kind: "numberRange", range: next })
      }
    />
  ),

  minMax: ({ def, value, onChange }) => (
    <MinMaxFilter
      label={def.label}
      bounds={[def.min as number, def.max as number]}
      value={value?.kind === "numberRange" ? value.range : null}
      onChange={onChange}
    />
  ),

  threshold: ({ def, value, onChange }) => (
    <ThresholdFilter
      label={withLengthUnit(def.key, def.label)}
      fieldKey={def.key}
      value={value?.kind === "number" ? [value.op, value.value] : null}
      onChange={(next) =>
        onChange(
          next == null || next[0] === "Any"
            ? null
            : { kind: "number", op: next[0], value: next[1] },
        )
      }
    />
  ),

  boolean: (props) => <BooleanFilter {...props} />,

  text: ({ def, value, onChange }) => (
    <TextField
      label={def.label}
      value={value?.kind === "text" ? value.value : ""}
      onChangeText={(next) =>
        onChange(next.trim() === "" ? null : { kind: "text", value: next })
      }
      autoCapitalize="none"
    />
  ),

  date: ({ def, value, onChange, onPickDate }) =>
    onPickDate ? (
      <DateRangeFilter
        label={def.label}
        value={value?.kind === "date" ? value.range : null}
        onPick={onPickDate}
        onClear={() => onChange(null)}
      />
    ) : null,
};

/**
 * One attribute with the control its definition's SHAPE deserves — the phone's
 * half of the pair whose web half is `frontend/src/ui/AttributeFilter.tsx`.
 *
 * It is in the kit, not in a screen, because the Places sheet and the Logs
 * sheet ask the same question of the same definitions: a place's attributes and
 * a trip's are the same kind of thing, filtered by the same shared predicate
 * (`passesCustomFieldFilters`).
 *
 * Nothing here may key off a field's NAME. A canyon's grades are ordinary
 * attributes, so a bespoke control for one type is exactly what this replaces.
 */
export function AttributeFilter(props: Props) {
  return SHAPES[attributeFilterShape(props.def)](props);
}

function Header({
  label,
  summary,
  active,
}: {
  label: string;
  summary: string;
  active: boolean;
}) {
  const styles = useStyles();

  return (
    <View style={styles.blockHeader}>
      <Text style={styles.blockLabel}>{label}</Text>
      <Text style={[styles.blockValue, active && styles.blockValueActive]}>
        {summary}
      </Text>
    </View>
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
  const styles = useStyles();

  const [low, setLow] = useState(value ? String(value[0]) : "");
  const [high, setHigh] = useState(value ? String(value[1]) : "");
  // Reset empties the filter from outside; empty the boxes with it, or they go
  // on showing a filter that is no longer applied.
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
    onChange({
      kind: "numberRange",
      range: [Math.max(bounds[0], from), Math.min(bounds[1], to)],
    });
  };

  return (
    <View style={styles.block}>
      <Header
        label={label}
        summary={formatRange(value, bounds)}
        active={!isFullRange(value, bounds)}
      />
      <View style={styles.pair}>
        <View style={styles.pairField}>
          <TextField
            label="From"
            placeholder={String(bounds[0])}
            value={low}
            keyboardType="numeric"
            onChangeText={(text) => {
              setLow(text);
              commit(text, high);
            }}
          />
        </View>
        <View style={styles.pairField}>
          <TextField
            label="To"
            placeholder={String(bounds[1])}
            value={high}
            keyboardType="numeric"
            onChangeText={(text) => {
              setHigh(text);
              commit(low, text);
            }}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * An unbounded "how many / how long / how far": an operator and a number. The
 * operator is a DRAFT until there is a number: committing it alone would apply
 * "under 0", which empties the list and reads as the filter being broken.
 */
function ThresholdFilter({
  label,
  fieldKey,
  value,
  onChange,
}: {
  label: string;
  /**
   * The field's key: a length's filter holds metres while its field is typed in
   * the display units. Guards: `attributeFilter.test.tsx` ("a length's
   * threshold") on Logjam Web; on Logjam GPS `lengthFieldClients.test.ts`
   * ("every form of a length field converts it").
   */
  fieldKey: string;
  value: PlaceThresholdFilter | null;
  onChange: (next: PlaceThresholdFilter | null) => void;
}) {
  const styles = useStyles();
  const length = isLengthField(fieldKey);

  const [operator, setOperator] = useState<PlaceThresholdFilter[0]>(
    value?.[0] ?? "Less than",
  );
  const seeded = (held: PlaceThresholdFilter | null) =>
    held ? { text: fieldInputText(fieldKey, held[1]), metres: held[1] } : null;
  // What the text was last written from, and the metres it was written from.
  // Text still equal to it is the value the user was shown, so it keeps those
  // metres; `value` is not that, since it follows every keystroke.
  const [seed, setSeed] = useState(() => seeded(value));
  const [text, setText] = useState(seed?.text ?? "");
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    if (value == null) {
      setText("");
      setSeed(null);
    }
  }
  // The text is in the display units, so a change of units writes it again from
  // the metres held (a typed "30" would otherwise commit as 9.144 m). Guard:
  // `attributeFilter.test.tsx` ("a length's threshold") on Logjam Web, and on
  // Logjam GPS `lengthFieldClients.test.ts` ("every form of a length field
  // converts it").
  const units = displayUnits();
  const [shownUnits, setShownUnits] = useState(units);
  if (units !== shownUnits) {
    setShownUnits(units);
    if (length && value) {
      setSeed(seeded(value));
      setText(fieldInputText(fieldKey, value[1]));
    }
  }

  const commit = (nextOperator: PlaceThresholdFilter[0], nextText: string) => {
    const parsed = Number(nextText.trim());
    onChange(
      nextText.trim() === "" || !Number.isFinite(parsed)
        ? null
        : [
            nextOperator,
            coerceFieldInput(
              fieldKey,
              nextText.trim(),
              "float",
              seed && seed.text === nextText.trim() ? seed.metres : undefined,
            ) as number,
          ],
    );
  };

  return (
    <View style={styles.block}>
      <Header
        label={label}
        summary={value == null ? "Any" : formatThreshold(value, length)}
        active={value != null}
      />
      <View style={styles.chipRow}>
        {OPERATORS.map((candidate) => (
          <Chip
            key={candidate}
            label={OPERATOR_LABEL[candidate]}
            active={operator === candidate}
            onPress={() => {
              setOperator(candidate);
              commit(candidate, text);
            }}
          />
        ))}
      </View>
      <View style={styles.valueField}>
        <TextField
          label="Value"
          value={text}
          keyboardType="numeric"
          onChangeText={(next) => {
            setText(next);
            commit(operator, next);
          }}
        />
      </View>
    </View>
  );
}

function BooleanFilter({ def, value, onChange }: Props) {
  const styles = useStyles();
  const current = value?.kind === "boolean" ? value.value : null;
  return (
    <View style={styles.block}>
      <Header
        label={def.label}
        summary={current == null ? "Any" : current ? "Yes" : "No"}
        active={current != null}
      />
      <View style={styles.chipRow}>
        {[true, false].map((option) => (
          <Chip
            key={String(option)}
            label={option ? "Yes" : "No"}
            active={current === option}
            // Tapping the active chip clears it: "either" is the third state
            // and it needs to be reachable without a Reset.
            onPress={() =>
              onChange(
                current === option ? null : { kind: "boolean", value: option },
              )
            }
          />
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  block: { gap: formRhythm.label },
  blockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  blockLabel: { ...textRole.control, color: theme.text },
  blockValue: { ...textRole.detail, color: theme.textMuted },
  // Words are text-coloured; the weight says it is set.
  blockValueActive: { ...textRole.control, color: theme.text },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  pair: { flexDirection: "row", gap: spacing(1) },
  pairField: { flex: 1, maxWidth: 200 },
  // No `flex`: in this column it would mean a height of nothing, and the next
  // row would draw over the field (`kit.test.ts`).
  valueField: { maxWidth: 200 },
}));
