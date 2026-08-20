import { useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { fontSize, radius, spacing, surface, theme } from "../theme";
import { Chip } from "./Chip";
import { SectionHeader } from "./SectionHeader";

export type ChipOption = {
  value: string;
  label: string;
  hue?: string;
  icon?: React.ComponentProps<typeof Chip>["icon"];
};

/**
 * Multi-select over a vocabulary that the user can extend — trip types are a
 * seed list unioned with whatever they have typed before, and free text is
 * always allowed (`TRIP_TYPE_SUGGESTIONS` is a seed, not an enum).
 *
 * Selected values are shown first so a long vocabulary can't hide a choice
 * that is already made. `onAdd` renders a trailing "+ Add" chip that swaps
 * into an inline field; omit it for a closed vocabulary.
 */
export function ChipPicker({
  label,
  options,
  selected,
  onToggle,
  onAdd,
  addPlaceholder = "Add",
  disabledValues,
}: {
  label: string;
  options: ChipOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onAdd?: (label: string) => void;
  addPlaceholder?: string;
  /** Values rendered locked — selected and not toggleable. The implied
   *  `canyoning` tag on a canyon-linked trip is the case (the server force-adds
   *  it, so letting the user "deselect" it would be a lie). */
  disabledValues?: ReadonlySet<string>;
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

  // Selected chips lead, in SELECTION order rather than vocabulary order: for
  // trip types the first entry is the primary one (it picks the row's glyph and
  // hue), so the picker has to show which that is.
  const isSelected = new Set(selected);
  const ordered = [
    ...selected
      .map((value) => options.find((option) => option.value === value))
      .filter((option): option is ChipOption => option != null),
    ...options.filter((option) => !isSelected.has(option.value)),
  ];

  return (
    <View style={styles.wrap}>
      <SectionHeader label={label} />
      <View style={styles.chips}>
        {ordered.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={isSelected.has(option.value)}
            disabled={disabledValues?.has(option.value) ?? false}
            hue={option.hue}
            icon={option.icon}
            onPress={() => onToggle(option.value)}
          />
        ))}
        {onAdd && !adding ? (
          <Chip
            label={addPlaceholder}
            icon="plus"
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
    backgroundColor: surface.card,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    color: theme.textPrimary,
    fontSize: fontSize.sm,
  },
});
