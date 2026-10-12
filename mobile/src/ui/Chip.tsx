import { Pressable, Text, View } from "react-native";

import {
  hitSlop,
  opacity,
  radius,
  spacing,
  withAlpha,
  makeStyles,
  useTheme,
} from "../theme";
import { Icon, type Glyph } from "./Icon";
import { BADGE_SIZE, halfRadius } from "./pill";

// The single source of a chip's height (padding + font + border collapse to
// this one number via `minHeight`) — `ChipRail` re-exports it so a
// scroll rail's height is never guessed at from outside this file.
export const CHIP_HEIGHT = 36;

/** One option of a chip rail or picker — the same shape on Logjam Web. */
export type ChipOption<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
  /** Optional tally rendered as a trailing badge (filter rails). */
  count?: number;
  /** Optional identity hue: fills the chip while it is active. */
  hue?: string;
  /** Optional leading glyph, for a rail whose options have a kind. */
  icon?: Glyph;
};

/**
 * The pill primitive behind every chip surface — filter rails
 * (`ChipRail`) and multi-select vocabularies (`ChipPicker`) both render
 * this, so a chip looks the same wherever it appears.
 *
 * Active fills with `hue` (default accent) and draws its label and glyph in
 * `onFill`; inactive, the glyph is `textMuted` — a hue is only ever a fill,
 * never a glyph on a surface. A `count` rides as a trailing badge, an `icon`
 * leads. `dashed` is the "add one" chip at the end of a vocabulary (the same
 * prop and look as Logjam Web's): no fill, a dashed muted edge, muted words.
 */
export function Chip({
  label,
  active = false,
  disabled = false,
  hue,
  icon,
  count,
  starred = false,
  dashed = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  hue?: string;
  icon?: Glyph;
  count?: number;
  /** Trailing star: this chip is the one that counts (ChipPicker's `primaryValue`). */
  starred?: boolean;
  dashed?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const tint = hue ?? theme.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={starred ? `${label}, starred` : undefined}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={hitSlop}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: tint, borderColor: tint },
        dashed && styles.dashed,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon ? (
        <Icon
          idea={icon}
          size={14}
          color={active ? theme.onFill : theme.textMuted}
        />
      ) : active ? (
        // A SELECTED chip says so with a check as well as a fill, so it is never
        // mistaken for the primary button, which is filled too.
        <Icon idea="done" size={14} color={theme.onFill} />
      ) : null}
      <Text
        style={[
          styles.label,
          active && styles.labelActive,
          dashed && styles.labelMuted,
          disabled && styles.labelMuted,
        ]}
      >
        {label}
      </Text>
      {starred ? (
        <Icon
          idea="favourite"
          size={12}
          color={active ? theme.onFill : theme.textMuted}
        />
      ) : null}
      {count != null ? (
        <View
          // Remounted when the chip flips: RN Android loses the corner radius of
          // a view whose background was swapped after layout (see `halfRadius`),
          // and a fresh view is laid out exactly like the first one was.
          key={active ? "on" : "off"}
          style={[styles.badge, active && styles.badgeActive]}
        >
          <Text style={[styles.badgeText, active && styles.badgeTextActive]}>
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(0.5),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.card,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    minHeight: CHIP_HEIGHT,
    // A pill is never narrower than it is tall: a one-glyph chip is a circle.
    minWidth: CHIP_HEIGHT,
    justifyContent: "center",
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: opacity.disabled },
  label: { ...textRole.control, color: theme.text },
  // `onFill`, not the page colour: on the shared heath fill the old dark page
  // was 3.7:1 (root CLAUDE.md, "Text or a glyph ON a colour fill uses a dark
  // ink").
  labelActive: { color: theme.onFill },
  labelMuted: { color: theme.textMuted },
  // The add chip is not a value of the rail, so it does not wear a value's
  // card: an outline of its own kind, the way Logjam Web draws it.
  dashed: {
    backgroundColor: "transparent",
    borderStyle: "dashed",
    borderColor: theme.textMuted,
  },
  // A fixed box with a radius of exactly half of it, and a background that is
  // always set (`badgeActive` makes it transparent, never absent): see
  // `halfRadius` for why a 999 radius came back square once another chip was
  // selected.
  badge: {
    height: BADGE_SIZE,
    minWidth: BADGE_SIZE,
    paddingHorizontal: spacing(0.5),
    borderRadius: halfRadius(BADGE_SIZE),
    backgroundColor: withAlpha(theme.text, 0.12),
    alignItems: "center",
    justifyContent: "center",
  },
  // No wash on a fill: an ink wash darkened Daylight's accent until the count
  // on it fell under 4.5:1. The count reads as `onFill` on the fill itself.
  badgeActive: { backgroundColor: "transparent" },
  badgeText: { ...textRole.caption, color: theme.textMuted },
  badgeTextActive: { color: theme.onFill },
}));
