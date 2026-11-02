import { useRef, useState } from "react";
import { Text, TextInput, View, type TextInputInstance } from "react-native";

import {
  formRhythm,
  radius,
  spacing,
  makeStyles,
  useTheme,
  controlSize,
  muted,
} from "../theme";
import { Chip, type ChipOption } from "./Chip";
import { Field } from "./Field";
import { FieldError } from "./FieldError";
import { SectionHeader } from "./SectionHeader";

/**
 * Multi-select over a vocabulary that the user can extend — trip types are a
 * seed list unioned with whatever they have typed before, and free text is
 * always allowed (`TRIP_TYPE_SUGGESTIONS` is a seed, not an enum).
 *
 * Chips stay in VOCABULARY order whatever is selected. Moving a chip to the
 * front on selection makes the user re-read the whole layout after every tap,
 * and puts the chip they are reaching for somewhere else. `onAdd` renders a
 * trailing "+ Add" chip that swaps into an inline field; omit it for a closed
 * vocabulary.
 */
export function ChipPicker({
  label,
  options,
  selected,
  onToggle,
  onAdd,
  addPlaceholder = "Add",
  disabledValues,
  primaryValue,
  hint,
  error,
  field = false,
}: {
  label: string;
  options: ChipOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onAdd?: (label: string) => void;
  addPlaceholder?: string;
  /** Values rendered locked — selected and not toggleable. The implied
   *  `canyoning` tag on a place-linked trip is the case (the server force-adds
   *  it, so letting the user "deselect" it would be a lie). */
  disabledValues?: ReadonlySet<string>;
  /** A selected value whose place in the SELECTION means something — a trip's
   *  first type picks its glyph and hue. Starred rather than moved to the
   *  front, since chips keep their positions. */
  primaryValue?: string;
  /** One plain sentence under the chips saying what the choice does. */
  hint?: string;
  /** The problem with this choice (shared/DESIGN.md §11, "Form errors"). */
  error?: string | null;
  /** One question among a form's fields: labelled as a `Field` is, not
   *  headed as a vocabulary of its own (a trip's types). */
  field?: boolean;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInputInstance>(null);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && onAdd) onAdd(trimmed);
    setDraft("");
    setAdding(false);
  };

  const isSelected = new Set(selected);

  const chips = (
    <View style={styles.chips}>
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          active={isSelected.has(option.value)}
          disabled={disabledValues?.has(option.value) ?? false}
          hue={option.hue}
          icon={option.icon}
          starred={option.value === primaryValue}
          onPress={() => onToggle(option.value)}
        />
      ))}
      {onAdd && !adding ? (
        <Chip
          label={addPlaceholder}
          icon="add"
          dashed
          onPress={() => {
            setAdding(true);
            // Focus on the next frame: the input does not exist yet on this one.
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      ) : null}
      {adding ? (
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={commit}
          onBlur={commit}
          accessibilityLabel={addPlaceholder}
          placeholder={addPlaceholder}
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          returnKeyType="done"
        />
      ) : null}
    </View>
  );
  if (field)
    return (
      <Field label={label} hint={hint} error={error}>
        {chips}
      </Field>
    );
  return (
    <View style={styles.wrap}>
      <SectionHeader title={label} />
      {chips}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <FieldError message={error} />
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  wrap: { gap: formRhythm.label },
  hint: { ...muted(theme, textRole.detail) },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  input: {
    minWidth: 120,
    minHeight: controlSize.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: theme.field,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    ...textRole.body,
    color: theme.text,
  },
}));
