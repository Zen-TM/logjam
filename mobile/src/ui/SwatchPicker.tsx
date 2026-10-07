import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import {
  fontSize,
  fontWeight,
  hitSlop,
  radius,
  scrim,
  spacing,
  theme,
  withAlpha,
} from "../theme";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";

const SWATCH = 32;
const CELL = 48;

/**
 * A colour chosen from a closed palette, as on Logjam Web (`SwatchPicker`): the
 * label at the left, the colour as a filled disc at the right, and only the
 * disc presses. The palette is ALWAYS a floating card over the screen, opened
 * from that disc and closed by a choice, the ×, or a press outside it: never
 * an inline row of swatches pushing the form around it. The one kit component
 * for it; a screen that needs a colour from a palette uses this.
 *
 * The colour's NAME is the disc's accessible name ("Colour: Teal"): the disc
 * shows the colour, so words beside it would say the same thing twice.
 * `hideLabel` keeps the label as the name and draws only the disc, for a bar
 * that already says what the colour is for (the route-drawing toolbar).
 *
 * Words are text-coloured and the tick is the one ink, `onFill`; the palette is
 * light precisely so a mark on top of a swatch stays legible.
 */
export function SwatchPicker({
  label,
  colors,
  value,
  onChange,
  nameOf,
  hideLabel = false,
  disabled = false,
}: {
  label: string;
  colors: readonly string[];
  value: string | undefined;
  onChange: (next: string) => void;
  /** What to CALL each colour, as its accessible name. Without one a swatch
   *  answers to its hex, which is a name but not a helpful one. */
  nameOf?: (color: string) => string;
  hideLabel?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const chosen = value ? (nameOf?.(value) ?? value) : "No colour";
  return (
    <View style={styles.field}>
      {hideLabel ? null : <Text style={styles.label}>{label}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${chosen}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        hitSlop={hitSlop}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        <View
          style={[styles.swatch, { backgroundColor: value ?? "transparent" }]}
        />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          accessibilityLabel="Close"
          style={styles.backdrop}
          onPress={() => setOpen(false)}
        >
          {/* A press on the card itself must not fall through to the backdrop. */}
          <Pressable style={styles.card} onPress={() => undefined}>
            <View style={styles.head}>
              <Text style={styles.title}>{label}</Text>
              <IconButton
                icon="close"
                accessibilityLabel="Close"
                onPress={() => setOpen(false)}
              />
            </View>
            <View style={styles.grid}>
              {colors.map((color) => (
                <Pressable
                  key={color}
                  accessibilityRole="button"
                  accessibilityLabel={nameOf?.(color) ?? color}
                  accessibilityState={{ selected: color === value }}
                  onPress={() => {
                    setOpen(false);
                    onChange(color);
                  }}
                  style={[styles.cell, color === value && styles.cellChosen]}
                >
                  <View style={[styles.swatch, { backgroundColor: color }]}>
                    {color === value ? (
                      <Icon idea="done" size={16} color={theme.onFill} />
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing(1),
    minHeight: CELL,
  },
  label: {
    flex: 1,
    color: theme.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  trigger: {
    width: CELL,
    height: CELL,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: CELL / 2,
  },
  pressed: { backgroundColor: theme.cardPressed },
  disabled: { opacity: 0.4 },
  // The disc's own hairline, so a light swatch does not vanish into a light
  // card (and a dark one into a dark card).
  swatch: {
    width: SWATCH,
    height: SWATCH,
    borderRadius: SWATCH / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: withAlpha(theme.text, 0.2),
  },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: scrim.light,
    padding: spacing(3),
  },
  card: {
    backgroundColor: theme.page,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.line,
    padding: spacing(2),
    gap: spacing(1),
    width: "100%",
    maxWidth: 320,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: theme.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  // Three to a row, as on Logjam Web: a single flat row of ten spends the width
  // showing nine colours nobody picked.
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  cell: {
    width: "33.33%",
    height: CELL + spacing(1),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: "transparent",
  },
  cellChosen: { borderColor: theme.accent },
});
