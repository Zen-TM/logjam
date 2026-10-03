import { useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { fontSize, radius, spacing, theme } from "../theme";
import { Chip, type ChipOption } from "./Chip";
import { FieldError } from "./FieldError";
import { SectionHeader } from "./SectionHeader";

/**
 * Multi-select over a vocabulary that the user can extend — trip types are a
 * seed list unioned with whatever they have typed before, and free text is
 * always allowed (`TRIP_TYPE_SUGGESTIONS` is a seed, not an enum).
 *
 * Chips stay in VOCABULARY order whatever is selected. Moving a chip to the
 * front on selection made the user re-read the whole layout after every tap,
 * and put the chip they were reaching for somewhere else. `onAdd` renders a
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
  error,
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
  /** The problem with this choice (DESIGN.md §8, "Form errors"). */
  error?: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput>(null);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && onAdd) onAdd(trimmed);
    setDraft("");
    setAdding(false);
  };

  const isSelected = new Set(selected);

  return (
    <View style={styles.wrap}>
      <SectionHeader title={label} />
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
      <FieldError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing(0.5) },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  input: {
    minWidth: 120,
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: theme.card,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    color: theme.text,
    fontSize: fontSize.sm,
  },
});
